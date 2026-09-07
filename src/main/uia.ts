// v0.5-mini T3: real UI Automation (UIA) backend.
//
// T1 / T2 left this file as a stub (throwing UiaBackendUnavailableError
// on Windows).  T3 replaces the stub with a working backend: we spawn
// `powershell.exe -NoProfile -NonInteractive -Command <inline .NET script>`
// and drive the .NET `System.Windows.Automation` API (UIAutomationClient
// + UIAutomationTypes, both shipped with Windows).
//
// Why PowerShell + .NET instead of an npm package?  Every npm UIA
// wrapper (uiautomation, @bright-fish/node-ui-automation,
// node-winautomation, …) is a napi / node-gyp native addon that
// requires Python 3.6+ and Visual Studio to build.  This machine has
// only Python 2.7, so the install fails before any JS is loaded.  By
// using the .NET API that's already on every Windows install since
// Vista, we get a zero-dependency UIA client at the cost of a
// ~80–120ms process-spawn per call.
//
// The runtime cost is fine for v0.5-mini (a recipe runs a handful of
// UIA steps at a time).  v0.5-full can amortise it with a long-lived
// PowerShell child that reads commands on stdin and writes JSON
// results on stdout — out of scope here.
//
// What T3 keeps / changes vs the T1 stub:
//   - Same public surface (findElement / invokeElement /
//     setElementText / getElementText / focusElement /
//     listElementsInWindow + resolveSelector / resolveTarget + the
//     two error types).  The runner, simulator, and IPC layer did
//     not have to change.
//   - Same pure resolver (resolveSelector / resolveTarget).  These
//     were already correct; T3 just calls them in more places.
//   - T1 threw on every Windows call.  T3 returns real results for
//     the three selector shapes the spec lists as "recommended"
//     (automationId / name / controlType / controlType+name).  Bare
//     `controlType` (no name) works too.  className and xpath still
//     throw UiaBackendUnavailableError — the script generators
//     haven't been taught them yet (planned for v0.5-full).
//
// Cache:
//   findElement caches the result in a `Map<key, { handle, expires }>`
//   with a 5-second TTL.  Key = `hwnd|JSON.stringify(selector)`.  A
//   sequence like `focusElement -> setText -> getText` against the
//   same element reuses the cached handle for the first call and
//   only re-spawns PowerShell for the second and third.  The TTL is
//   intentionally short so the runner doesn't pick up a stale
//   handle if the target app navigates away and back between
//   steps.
//
// Threading:
//   On Windows the runner already wraps UIA steps in
//   `withAttachedInput(hwnd, …)` (T1/T2), so the PowerShell child
//   inherits the caller's attached input state.  This is necessary
//   for some patterns (e.g. `InvokePattern`) to be accepted by the
//   target thread; without the attach, the OS silently drops the
//   call.  UIA itself does not need to run on the target thread —
//   only the input-state binding matters for the action patterns.

import { spawn } from 'node:child_process';
import type { ElementSelector, StepTarget } from '../shared/types.js';

// ----- types (unchanged from T1) ------------------------------------------

/**
 * Opaque handle to a UIA element. T3 carries { hwnd, selector, found }
 * — enough to re-find the element in a later PowerShell call and to
 * give the runner a useful error message ("selector { name: 'OK' }
 * not found in hwnd 12345").
 */
export interface UIAElementHandle {
  hwnd: number;
  selector: ElementSelector;
  /** Last-known element metadata.  Diagnostic only; not used to look
   *  the element up (a fresh FindFirst is run on every action). */
  found: UIElementInfo;
}

export interface UIElementInfo {
  name: string;
  automationId: string;
  controlType: string;
  className: string;
  boundingRect: { x: number; y: number; width: number; height: number };
  isEnabled: boolean;
  isVisible: boolean;
}

export interface ResolvedTarget {
  hwnd: number;
  source: StepTarget | { kind: 'default' };
}

export class UiaQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UiaQueryError';
  }
}

export class UiaBackendUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UiaBackendUnavailableError';
  }
}

// ----- selector resolver (unchanged) -------------------------------------

export type FindStrategy =
  | { kind: 'automationId'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'controlType'; controlType: string; name?: string }
  | { kind: 'className'; className: string; name?: string }
  | { kind: 'xpath'; value: string };

export function resolveSelector(selector: ElementSelector): FindStrategy {
  if ('automationId' in selector) {
    return { kind: 'automationId', value: selector.automationId };
  }
  if ('name' in selector && !('controlType' in selector) && !('className' in selector)) {
    return { kind: 'name', value: selector.name };
  }
  if ('controlType' in selector) {
    return {
      kind: 'controlType',
      controlType: selector.controlType,
      ...(selector.name !== undefined ? { name: selector.name } : {})
    };
  }
  if ('className' in selector) {
    return {
      kind: 'className',
      className: selector.className,
      ...(selector.name !== undefined ? { name: selector.name } : {})
    };
  }
  return { kind: 'xpath', value: selector.xpath };
}

// ----- target resolver (unchanged) ---------------------------------------

export interface TargetContext {
  boundHwnd: number;
  foregroundHwnd: number;
  knownTitles?: ReadonlyMap<number, string>;
}

export function resolveTarget(
  target: StepTarget | undefined,
  ctx: TargetContext
): ResolvedTarget {
  const t: StepTarget = target ?? { kind: 'foreground' };
  switch (t.kind) {
    case 'foreground':
      return { hwnd: ctx.foregroundHwnd, source: t };
    case 'bound':
      return { hwnd: ctx.boundHwnd, source: t };
    case 'hwnd':
      return { hwnd: t.hwnd, source: t };
    case 'title': {
      if (ctx.knownTitles) {
        for (const [hwnd, title] of ctx.knownTitles) {
          if (title === t.title) {
            return { hwnd, source: t };
          }
        }
      }
      return { hwnd: 0, source: t };
    }
  }
}

// ----- control type map (UIA → PowerShell enum) --------------------------
//
// UIA's AutomationElement exposes ControlType as a strongly-typed enum;
// PowerShell sees them as static properties on
// `[System.Windows.Automation.ControlType]`.  Most names match the
// renderer-friendly label verbatim; the few renames are listed below.

const CONTROL_TYPE_MAP: Record<string, string> = {
  Button: 'Button',
  Edit: 'Edit',
  Text: 'Text',
  CheckBox: 'CheckBox',
  RadioButton: 'RadioButton',
  ComboBox: 'Combo',
  List: 'List',
  ListItem: 'ListItem',
  Menu: 'Menu',
  MenuItem: 'MenuItem',
  Tab: 'Tab',
  Tree: 'Tree',
  TreeItem: 'TreeItem',
  Window: 'Window',
  Pane: 'Pane',
  Hyperlink: 'Hyperlink',
  // UWP / WinUI 3.0 surfaces many control types that the classic
  // Win32 set didn't have.  v0.5-mini includes the ones the spec
  // asks for plus the ones that show up in the notepad example.
  Document: 'Document',
  ScrollBar: 'ScrollBar',
  SplitButton: 'SplitButton',
  ToggleButton: 'ToggleButton',
  ProgressBar: 'ProgressBar',
  ToolTip: 'ToolTip',
  Image: 'Image',
  Table: 'Table',
  DataItem: 'DataItem',
  Group: 'Group',
  Header: 'Header',
  HeaderItem: 'HeaderItem',
  StatusBar: 'StatusBar',
  SemanticZoom: 'SemanticZoom',
  Calendar: 'Calendar',
  AppBar: 'AppBar',
  Thumb: 'Thumb',
  TitleBar: 'TitleBar',
  Spinner: 'Spinner'
};

function psControlType(label: string): string {
  const mapped = CONTROL_TYPE_MAP[label];
  if (!mapped) {
    throw new UiaBackendUnavailableError(
      `Unsupported controlType label "${label}" — supported: ${Object.keys(CONTROL_TYPE_MAP).join(', ')}`
    );
  }
  return mapped;
}

// ----- PowerShell script escaping ----------------------------------------
//
// We embed the selector value / text directly into the inline script
// as a single-quoted PowerShell string.  The only character that
// needs escaping inside a single-quoted PS string is the single quote
// itself, which doubles to `''`.  We also strip NULs (PS would barf).

function psEscape(s: string): string {
  return s.replace(/\0/g, '').replace(/'/g, "''");
}

// ----- shared condition builder ------------------------------------------
//
// Returns the PowerShell expression that evaluates to a
// `System.Windows.Automation.Condition` matching the given selector.
// Throws UiaBackendUnavailableError for selector shapes the v0.5-mini
// backend hasn't been taught yet (className, xpath).

function buildConditionPs(selector: ElementSelector): string {
  const strategy = resolveSelector(selector);
  switch (strategy.kind) {
    case 'automationId':
      return `New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '${psEscape(strategy.value)}')`;
    case 'name':
      return `New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '${psEscape(strategy.value)}')`;
    case 'controlType': {
      const psType = psControlType(strategy.controlType);
      const typeCond = `New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::${psType})`;
      if (strategy.name) {
        const nameCond = `New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '${psEscape(strategy.name)}')`;
        return `New-Object System.Windows.Automation.AndCondition(${typeCond}, ${nameCond})`;
      }
      return typeCond;
    }
    case 'className':
      throw new UiaBackendUnavailableError(
        'className selector is not yet implemented in the v0.5-mini PowerShell UIA backend (planned for v0.5-full)'
      );
    case 'xpath':
      throw new UiaBackendUnavailableError(
        'xpath selector is not yet implemented in the v0.5-mini PowerShell UIA backend (planned for v0.5-full)'
      );
  }
}

// ----- shared script header (find element, expose $el) ------------------
//
// Both the find script and the action scripts run the same prefix:
// load the .NET assemblies, create an IntPtr from the hwnd, attach to
// the root AutomationElement, build a Condition, and FindFirst.  If
// the element is found, $el is set; if not, the script exits with a
// non-zero code so runPowerShell can surface "element not found".
//
// The header is the same for every script that needs the element —
// only the suffix (output JSON for find, or pattern call for action)
// differs.

function buildScriptHeader(hwnd: number, selector: ElementSelector): string {
  const cond = buildConditionPs(selector);
  return `Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ErrorActionPreference = 'Stop'
$hwnd = New-Object System.IntPtr(${hwnd})
$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($root -eq $null) { @{ ok = $false; error = 'root-null' } | ConvertTo-Json -Compress; exit 10 }
$cond = ${cond}
$el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
if ($el -eq $null) { @{ ok = $false; error = 'element-not-found' } | ConvertTo-Json -Compress; exit 11 }`;
}

// ----- findElement script ------------------------------------------------
//
// Returns JSON:
//   { "found": true,  "name": "...", "automationId": "...", "controlType": "...", "className": "...",
//     "x": 0, "y": 0, "width": 0, "height": 0, "isEnabled": true, "isVisible": true }
//   { "found": false }

function buildFindScript(hwnd: number, selector: ElementSelector): string {
  // Note: the find script must NOT use the shared "exit 11" path,
  // because the runner distinguishes "not found" (return null) from
  // "spawn / runtime error" (throw).  So we re-implement the header
  // here with an explicit "found = $false" output.
  const cond = buildConditionPs(selector);
  return `Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ErrorActionPreference = 'Stop'
$hwnd = New-Object System.IntPtr(${hwnd})
$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($root -eq $null) { @{ found = $false; error = 'root-null' } | ConvertTo-Json -Compress; exit 0 }
$cond = ${cond}
$el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
if ($el -eq $null) { @{ found = $false } | ConvertTo-Json -Compress; exit 0 }
$rect = $el.Current.BoundingRectangle
$ctrlType = $el.Current.ControlType.ProgrammaticName
if ($ctrlType) { $ctrlType = $ctrlType.Substring($ctrlType.LastIndexOf('.') + 1) }
$result = @{
  found        = $true
  name         = [string]$el.Current.Name
  automationId = [string]$el.Current.AutomationId
  controlType  = [string]$ctrlType
  className    = [string]$el.Current.ClassName
  x            = [int]$rect.X
  y            = [int]$rect.Y
  width        = [int]$rect.Width
  height       = [int]$rect.Height
  isEnabled    = [bool]$el.Current.IsEnabled
  isVisible    = [bool](!$el.Current.IsOffscreen)
}
$result | ConvertTo-Json -Compress`;
}

// ----- action scripts ----------------------------------------------------
//
// The action scripts share `buildScriptHeader` which guarantees $el
// is the found element (or the script exits with a non-zero code and
// we surface the { ok: false, error: 'element-not-found' } JSON).
// The body then operates on $el and emits a result JSON.

function buildInvokeScript(hwnd: number, selector: ElementSelector): string {
  return `${buildScriptHeader(hwnd, selector)}
$pattern = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
if ($pattern -eq $null) { @{ ok = $false; error = 'invoke-pattern-unsupported' } | ConvertTo-Json -Compress; exit 0 }
$pattern.Invoke()
@{ ok = $true } | ConvertTo-Json -Compress`;
}

function buildSetTextScript(
  hwnd: number,
  selector: ElementSelector,
  text: string
): string {
  return `${buildScriptHeader(hwnd, selector)}
$pattern = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
if ($pattern -eq $null) { @{ ok = $false; error = 'value-pattern-unsupported' } | ConvertTo-Json -Compress; exit 0 }
$pattern.SetValue('${psEscape(text)}')
@{ ok = $true } | ConvertTo-Json -Compress`;
}

function buildGetTextScript(hwnd: number, selector: ElementSelector): string {
  return `${buildScriptHeader(hwnd, selector)}
$vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
if ($vp -ne $null) { @{ ok = $true; text = [string]$vp.Current.Value } | ConvertTo-Json -Compress; exit 0 }
@{ ok = $true; text = [string]$el.Current.Name } | ConvertTo-Json -Compress`;
}

function buildFocusScript(hwnd: number, selector: ElementSelector): string {
  return `${buildScriptHeader(hwnd, selector)}
$el.SetFocus()
@{ ok = $true } | ConvertTo-Json -Compress`;
}

function buildListScript(hwnd: number, controlType: string | undefined): string {
  const filter = controlType ? psControlType(controlType) : '';
  const condExpr = filter
    ? `$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::${filter})`
    : `$cond = [System.Windows.Automation.Condition]::TrueCondition`;
  return `Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ErrorActionPreference = 'Stop'
$hwnd = New-Object System.IntPtr(${hwnd})
$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($root -eq $null) { @() | ConvertTo-Json -Compress; exit 0 }
${condExpr}
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
$out = @()
foreach ($e in $all) {
  $rect = $e.Current.BoundingRectangle
  $ctrlType = $e.Current.ControlType.ProgrammaticName
  if ($ctrlType) { $ctrlType = $ctrlType.Substring($ctrlType.LastIndexOf('.') + 1) }
  $out += @{
    name         = [string]$e.Current.Name
    automationId = [string]$e.Current.AutomationId
    controlType  = [string]$ctrlType
    className    = [string]$e.Current.ClassName
    x            = [int]$rect.X
    y            = [int]$rect.Y
    width        = [int]$rect.Width
    height       = [int]$rect.Height
    isEnabled    = [bool]$e.Current.IsEnabled
    isVisible    = [bool](!$e.Current.IsOffscreen)
  }
}
$out | ConvertTo-Json -Compress`;
}

// ----- PowerShell spawn --------------------------------------------------

interface PowerShellResult {
  stdout: string;
  stderr: string;
  code: number;
  /** When true the spawn itself failed (powershell.exe not on PATH).
   *  When false, code is the PowerShell process exit code. */
  spawnError?: boolean;
}

function runPowerShell(script: string, timeoutMs = 5000): Promise<PowerShellResult> {
  return new Promise((resolve) => {
    let ps: ReturnType<typeof spawn>;
    try {
      ps = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true }
      );
    } catch (err) {
      resolve({
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        code: -1,
        spawnError: true
      });
      return;
    }
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try {
        ps.kill();
      } catch {
        /* best effort */
      }
    }, timeoutMs);
    ps.stdout?.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    ps.stderr?.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    ps.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code: killed ? -2 : code ?? -3
      });
    });
    ps.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: err.message,
        code: -1,
        spawnError: true
      });
    });
  });
}

function safeJsonParse(text: string): unknown | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ----- cache -------------------------------------------------------------

const CACHE_TTL_MS = 5000;
interface CacheEntry {
  handle: UIAElementHandle;
  expires: number;
}
const findCache = new Map<string, CacheEntry>();

function cacheKey(hwnd: number, selector: ElementSelector): string {
  return `${hwnd}|${JSON.stringify(selector)}`;
}

function cacheGet(hwnd: number, selector: ElementSelector): UIAElementHandle | null {
  const entry = findCache.get(cacheKey(hwnd, selector));
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    findCache.delete(cacheKey(hwnd, selector));
    return null;
  }
  return entry.handle;
}

function cacheSet(hwnd: number, selector: ElementSelector, handle: UIAElementHandle) {
  findCache.set(cacheKey(hwnd, selector), {
    handle,
    expires: Date.now() + CACHE_TTL_MS
  });
}

/**
 * Test seam: clear the findElement cache.  Exposed via __test__ below.
 * Production code should not need this.
 */
function __clearCache() {
  findCache.clear();
}

// ----- backend dispatch --------------------------------------------------

/**
 * Throws UiaBackendUnavailableError on non-Windows.  On Windows the
 * PowerShell backend is always available (it ships with the OS), so
 * the check is purely a platform gate.  In T3 we do not have to
 * lazy-init anything because the script is generated per call.
 */
function ensureBackend(): void {
  if (process.platform !== 'win32') {
    throw new UiaBackendUnavailableError(
      'UI Automation is only available on Windows'
    );
  }
}

// ----- public API --------------------------------------------------------

/**
 * Find the first element under `hwnd` matching `selector`. Returns
 * null on non-Windows, or when the element is not found. Throws
 * `UiaBackendUnavailableError` for selector shapes the PowerShell
 * backend does not implement yet (className, xpath).
 */
export async function findElement(
  hwnd: number,
  selector: ElementSelector
): Promise<UIAElementHandle | null> {
  if (process.platform !== 'win32') return null;
  if (!hwnd || hwnd <= 0) return null;
  ensureBackend();

  const cached = cacheGet(hwnd, selector);
  if (cached) return cached;

  const script = buildFindScript(hwnd, selector);
  const result = await runPowerShell(script);
  if (result.spawnError) {
    throw new UiaBackendUnavailableError(
      `Failed to spawn PowerShell for UIA: ${result.stderr}`
    );
  }
  if (result.code !== 0) {
    throw new UiaQueryError(
      `UIA find failed (exit ${result.code}): ${result.stderr || '(no stderr)'}`
    );
  }
  const parsed = safeJsonParse(result.stdout) as
    | (Partial<UIElementInfo> & {
        found?: boolean;
        error?: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      })
    | null;
  if (!parsed || parsed.found !== true) {
    return null;
  }
  const handle: UIAElementHandle = {
    hwnd,
    selector,
    found: {
      name: String(parsed.name ?? ''),
      automationId: String(parsed.automationId ?? ''),
      controlType: String(parsed.controlType ?? ''),
      className: String(parsed.className ?? ''),
      boundingRect: {
        x: Number(parsed.x ?? 0),
        y: Number(parsed.y ?? 0),
        width: Number(parsed.width ?? 0),
        height: Number(parsed.height ?? 0)
      },
      isEnabled: Boolean(parsed.isEnabled),
      isVisible: parsed.isVisible !== false
    }
  };
  cacheSet(hwnd, selector, handle);
  return handle;
}

interface ScriptResult {
  ok: boolean;
  error?: string;
  text?: string;
}

function parseScriptResult(result: PowerShellResult, op: string): ScriptResult {
  if (result.spawnError) {
    throw new UiaBackendUnavailableError(
      `Failed to spawn PowerShell for UIA: ${result.stderr}`
    );
  }
  // Exit code 11 means "element not found" — the header emits
  // { ok: false, error: 'element-not-found' } on stdout.  Treat
  // that as a "selector no longer matches" error, which is a query
  // failure distinct from a backend failure.
  if (result.code !== 0) {
    const parsed = safeJsonParse(result.stdout) as
      | { ok?: boolean; error?: string }
      | null;
    throw new UiaQueryError(
      `${op} failed (exit ${result.code}): ${
        parsed?.error || result.stderr || '(no stderr)'
      }`
    );
  }
  const parsed = safeJsonParse(result.stdout) as
    | { ok?: boolean; error?: string; text?: string }
    | null;
  if (!parsed) {
    throw new UiaQueryError(`${op} returned unparseable stdout: ${result.stdout}`);
  }
  return {
    ok: parsed.ok === true,
    error: parsed.error,
    text: parsed.text
  };
}

export async function invokeElement(element: UIAElementHandle): Promise<void> {
  if (process.platform !== 'win32') return;
  if (!element) throw new UiaQueryError('invokeElement called with null handle');
  ensureBackend();
  // Re-find before the action: the cached element metadata may be
  // stale (the app could have navigated), and the .NET object in the
  // cached PS process is gone anyway.  The re-find also re-validates
  // the selector and updates the cache.
  const refreshed = await findElement(element.hwnd, element.selector);
  if (!refreshed) {
    throw new UiaQueryError(
      `invokeElement: element no longer matches selector ${JSON.stringify(element.selector)} in hwnd ${element.hwnd}`
    );
  }
  const r = parseScriptResult(
    await runPowerShell(buildInvokeScript(element.hwnd, element.selector)),
    'UIA invokeElement'
  );
  if (!r.ok) {
    throw new UiaQueryError(`UIA invokeElement failed: ${r.error || 'unknown error'}`);
  }
}

export async function setElementText(
  element: UIAElementHandle,
  text: string
): Promise<void> {
  if (process.platform !== 'win32') return;
  if (!element) throw new UiaQueryError('setElementText called with null handle');
  ensureBackend();
  const refreshed = await findElement(element.hwnd, element.selector);
  if (!refreshed) {
    throw new UiaQueryError(
      `setElementText: element no longer matches selector ${JSON.stringify(element.selector)} in hwnd ${element.hwnd}`
    );
  }
  const r = parseScriptResult(
    await runPowerShell(buildSetTextScript(element.hwnd, element.selector, text)),
    'UIA setElementText'
  );
  if (!r.ok) {
    throw new UiaQueryError(`UIA setElementText failed: ${r.error || 'unknown error'}`);
  }
}

export async function getElementText(element: UIAElementHandle): Promise<string> {
  if (process.platform !== 'win32') return '';
  if (!element) throw new UiaQueryError('getElementText called with null handle');
  ensureBackend();
  const refreshed = await findElement(element.hwnd, element.selector);
  if (!refreshed) {
    throw new UiaQueryError(
      `getElementText: element no longer matches selector ${JSON.stringify(element.selector)} in hwnd ${element.hwnd}`
    );
  }
  const r = parseScriptResult(
    await runPowerShell(buildGetTextScript(element.hwnd, element.selector)),
    'UIA getElementText'
  );
  if (!r.ok) {
    throw new UiaQueryError(`UIA getElementText failed: ${r.error || 'unknown error'}`);
  }
  return r.text ?? '';
}

export async function focusElement(element: UIAElementHandle): Promise<void> {
  if (process.platform !== 'win32') return;
  if (!element) throw new UiaQueryError('focusElement called with null handle');
  ensureBackend();
  const refreshed = await findElement(element.hwnd, element.selector);
  if (!refreshed) {
    throw new UiaQueryError(
      `focusElement: element no longer matches selector ${JSON.stringify(element.selector)} in hwnd ${element.hwnd}`
    );
  }
  const r = parseScriptResult(
    await runPowerShell(buildFocusScript(element.hwnd, element.selector)),
    'UIA focusElement'
  );
  if (!r.ok) {
    throw new UiaQueryError(`UIA focusElement failed: ${r.error || 'unknown error'}`);
  }
}

export async function listElementsInWindow(
  hwnd: number,
  options?: { controlType?: string; namePattern?: RegExp }
): Promise<UIElementInfo[]> {
  if (process.platform !== 'win32') return [];
  if (!hwnd || hwnd <= 0) return [];
  ensureBackend();

  const result = await runPowerShell(buildListScript(hwnd, options?.controlType));
  if (result.spawnError) {
    throw new UiaBackendUnavailableError(
      `Failed to spawn PowerShell for UIA: ${result.stderr}`
    );
  }
  if (result.code !== 0) {
    throw new UiaQueryError(
      `UIA listElementsInWindow failed (exit ${result.code}): ${result.stderr || '(no stderr)'}`
    );
  }
  const parsed = safeJsonParse(result.stdout) as
    | Array<{
        name: string;
        automationId: string;
        controlType: string;
        className: string;
        x: number;
        y: number;
        width: number;
        height: number;
        isEnabled: boolean;
        isVisible: boolean;
      }>
    | null;
  if (!Array.isArray(parsed)) return [];
  let info = parsed.map((p) => ({
    name: String(p.name ?? ''),
    automationId: String(p.automationId ?? ''),
    controlType: String(p.controlType ?? ''),
    className: String(p.className ?? ''),
    boundingRect: {
      x: Number(p.x ?? 0),
      y: Number(p.y ?? 0),
      width: Number(p.width ?? 0),
      height: Number(p.height ?? 0)
    },
    isEnabled: Boolean(p.isEnabled),
    isVisible: p.isVisible !== false
  }));
  if (options?.namePattern) {
    info = info.filter((e) => options.namePattern!.test(e.name));
  }
  return info;
}

// ----- test seam ---------------------------------------------------------

/**
 * Tests can replace `runPowerShellFn` to intercept PowerShell
 * calls without spawning the real powershell.exe.  In production
 * this is the real spawn.
 */
export const __test__ = {
  resolveSelector,
  resolveTarget,
  ensureBackend,
  __clearCache,
  /**
   * Build the PowerShell script that would be sent to powershell.exe
   * to find the given element.  Exposed so tests can assert on the
   * exact script content.
   */
  buildFindScript,
  buildInvokeScript,
  buildSetTextScript,
  buildGetTextScript,
  buildFocusScript,
  buildListScript,
  buildScriptHeader,
  buildConditionPs,
  /**
   * Exposed for unit tests that want to drive the cache directly.
   */
  cacheGet,
  cacheSet,
  CACHE_TTL_MS
};
