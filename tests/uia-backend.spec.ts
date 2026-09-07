// v0.5-mini T3: tests for the PowerShell + .NET UIA backend.
//
// This is the "Windows half" of the UIA contract.  We mock
// `node:child_process#spawn` so the tests don't actually launch
// powershell.exe, then:
//
//   1. Assert the inline PS script embeds the right UIA
//      PropertyCondition / AndCondition / ControlType for each
//      selector shape.
//   2. Assert user-supplied strings (selector values, text) are
//      single-quote-escaped in the generated script (PS injection
//      protection).
//   3. Assert the JSON output of a mocked PowerShell call is
//      parsed and routed into the public API correctly (find →
//      handle, invoke / setText / getText / focus → exit-code +
//      JSON-status, element-not-found → null / UiaQueryError).
//   4. Assert the findElement cache reuses a handle within the
//      5-second TTL and misses after the TTL expires.
//
// All tests run on a mocked `process.platform === 'win32'`.  The
// non-Windows path is covered in tests/uia-stub.spec.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:child_process so we can capture the inline script that
// uia.ts would have sent to powershell.exe and supply a canned
// stdout instead.
vi.mock('node:child_process', () => ({
  spawn: vi.fn()
}));

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  findElement,
  invokeElement,
  setElementText,
  getElementText,
  focusElement,
  listElementsInWindow,
  UiaBackendUnavailableError,
  UiaQueryError,
  __test__
} from '../src/main/uia';
import type { UIAElementHandle, UIElementInfo } from '../src/main/uia';
import type { ElementSelector } from '../src/shared/types';

type SpawnReturn = ReturnType<typeof spawn>;
type MockedSpawn = ReturnType<typeof vi.fn> & {
  mock: { calls: Array<[string, string[]]>; results: Array<{ value: unknown }> };
};

const mockedSpawn = spawn as unknown as MockedSpawn;

beforeEach(() => {
  // Default platform for the test file: Windows, so the platform
  // gate inside ensureBackend() doesn't short-circuit.
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  mockedSpawn.mockReset();
  __test__.__clearCache();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ----- helpers ------------------------------------------------------------

/**
 * Drive the next `spawn` call to resolve with a canned stdout /
 * exit code.  The mocked `spawn` returns a fake child process; we
 * hook it up to a fresh EventEmitter and emit 'close' on the next
 * microtask so the Promise resolve fires after we return.
 *
 * We use a microtask (Promise.resolve().then) instead of
 * setImmediate / setTimeout so the test isn't sensitive to
 * `vi.useFakeTimers` — fake timers replace both, but microtasks
 * always run before the macrotask scheduler advances.
 */
function queueSpawnResponse(opts: {
  stdout?: string;
  stderr?: string;
  code?: number;
  spawnError?: boolean;
  errorMessage?: string;
}) {
  const {
    stdout = '',
    stderr = '',
    code = 0,
    spawnError = false,
    errorMessage
  } = opts;
  mockedSpawn.mockImplementationOnce(() => {
    const ee = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    ee.stdout = new EventEmitter();
    ee.stderr = new EventEmitter();
    ee.kill = () => {
      /* noop */
    };
    Promise.resolve().then(() => {
      if (spawnError) {
        ee.emit('error', new Error(errorMessage ?? 'spawn failed'));
        return;
      }
      if (stdout) ee.stdout.emit('data', Buffer.from(stdout, 'utf8'));
      if (stderr) ee.stderr.emit('data', Buffer.from(stderr, 'utf8'));
      ee.emit('close', code);
    });
    return ee as unknown as SpawnReturn;
  });
}

/**
 * Read the most-recent spawn call's `-Command` argument (the inline
 * script).  Throws if `spawn` wasn't called.
 */
function lastScript(): string {
  const calls = mockedSpawn.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const args = calls[calls.length - 1]?.[1] as string[];
  expect(args[0]).toBe('-NoProfile');
  expect(args[1]).toBe('-NonInteractive');
  expect(args[2]).toBe('-Command');
  return args[3];
}

// ----- script generator contract -----------------------------------------

describe('UIA PowerShell script generators (T3)', () => {
  it('find script embeds AutomationIdProperty + value for { automationId }', () => {
    const s = __test__.buildFindScript(0x1234, { automationId: 'btnSubmit' });
    expect(s).toContain('AutomationIdProperty');
    expect(s).toContain("'btnSubmit'");
    expect(s).toContain('System.IntPtr(4660)');
  });

  it('find script embeds NameProperty + value for { name }', () => {
    const s = __test__.buildFindScript(0x1234, { name: '确定' });
    expect(s).toContain('NameProperty');
    expect(s).toContain("'\u786E\u5B9A'");
  });

  it('find script embeds ControlTypeProperty + ControlType enum for { controlType }', () => {
    const s = __test__.buildFindScript(0x1234, { controlType: 'Button' });
    expect(s).toContain('ControlTypeProperty');
    expect(s).toContain('ControlType]::Button');
    expect(s).not.toContain('AndCondition');
  });

  it('find script embeds AndCondition for { controlType, name }', () => {
    const s = __test__.buildFindScript(0x1234, { controlType: 'Edit', name: 'Search' });
    expect(s).toContain('AndCondition');
    expect(s).toContain('ControlType]::Edit');
    expect(s).toContain("'Search'");
  });

  it('single quotes in selector values are doubled (PS injection guard)', () => {
    const s = __test__.buildFindScript(0x1234, { name: "O'Brien" });
    // PowerShell single-quoted string escapes a single quote by
    // doubling it: ' -> ''
    expect(s).toContain("'O''Brien'");
  });

  it('invoke script uses InvokePattern', () => {
    const s = __test__.buildInvokeScript(0x1234, { name: 'OK' });
    expect(s).toContain('InvokePattern');
    expect(s).toContain('Invoke()');
  });

  it('setText script uses ValuePattern.SetValue + escapes text', () => {
    const s = __test__.buildSetTextScript(0x1234, { name: 'q' }, "it's a test");
    expect(s).toContain('ValuePattern');
    expect(s).toContain('SetValue');
    expect(s).toContain("'it''s a test'");
  });

  it('getText script prefers ValuePattern.Value, falls back to Name', () => {
    const s = __test__.buildGetTextScript(0x1234, { controlType: 'Edit' });
    expect(s).toContain('ValuePattern');
    expect(s).toContain('Current.Value');
    expect(s).toContain('Current.Name');
  });

  it('focus script calls SetFocus on $el', () => {
    const s = __test__.buildFocusScript(0x1234, { name: 'OK' });
    expect(s).toContain('SetFocus()');
    // The shared header that finds the element is present
    expect(s).toContain('FromHandle');
  });

  it('list script builds a ControlType condition when controlType is given', () => {
    const s = __test__.buildListScript(0x1234, 'Button');
    expect(s).toContain('ControlTypeProperty');
    expect(s).toContain('ControlType]::Button');
    expect(s).toContain('FindAll');
  });

  it('list script uses TrueCondition when no controlType filter is given', () => {
    const s = __test__.buildListScript(0x1234, undefined);
    expect(s).toContain('TrueCondition');
    expect(s).not.toContain('ControlTypeProperty');
  });

  it('buildConditionPs throws on className selector (planned v0.5-full)', () => {
    expect(() => __test__.buildConditionPs({ className: 'X' })).toThrow(
      UiaBackendUnavailableError
    );
  });

  it('buildConditionPs throws on xpath selector (planned v0.5-full)', () => {
    expect(() => __test__.buildConditionPs({ xpath: '/X' })).toThrow(
      UiaBackendUnavailableError
    );
  });

  it('script header uses the given hwnd and exits 11 on element-not-found', () => {
    const s = __test__.buildScriptHeader(0xbeef, { name: 'q' });
    expect(s).toContain('IntPtr(48879)');
    expect(s).toContain('exit 11');
    expect(s).toContain('element-not-found');
  });
});

// ----- mocked-spawn end-to-end --------------------------------------------

describe('findElement via PowerShell (T3)', () => {
  it('returns a handle when PowerShell emits { found: true, ... }', async () => {
    queueSpawnResponse({
      stdout: JSON.stringify({
        found: true,
        name: 'OK',
        automationId: 'btnOK',
        controlType: 'Button',
        className: 'Button',
        x: 10,
        y: 20,
        width: 80,
        height: 30,
        isEnabled: true,
        isVisible: true
      })
    });
    const handle = await findElement(0xabcd, { name: 'OK' });
    expect(handle).not.toBeNull();
    expect(handle?.hwnd).toBe(0xabcd);
    expect(handle?.selector).toEqual({ name: 'OK' });
    expect(handle?.found.name).toBe('OK');
    expect(handle?.found.controlType).toBe('Button');
    expect(handle?.found.boundingRect).toEqual({ x: 10, y: 20, width: 80, height: 30 });
  });

  it('returns null when PowerShell emits { found: false }', async () => {
    queueSpawnResponse({ stdout: JSON.stringify({ found: false }) });
    const handle = await findElement(0xabcd, { name: 'Missing' });
    expect(handle).toBeNull();
  });

  it('throws UiaBackendUnavailableError when spawn itself fails', async () => {
    queueSpawnResponse({ spawnError: true, errorMessage: 'ENOENT powershell.exe' });
    await expect(findElement(0xabcd, { name: 'x' })).rejects.toBeInstanceOf(
      UiaBackendUnavailableError
    );
  });

  it('throws UiaQueryError when PowerShell exits non-zero with stderr', async () => {
    queueSpawnResponse({ code: 1, stderr: 'TypeLoadException' });
    await expect(findElement(0xabcd, { name: 'x' })).rejects.toBeInstanceOf(
      UiaQueryError
    );
  });

  it('reuses the cached handle on the second call within TTL', async () => {
    // First call: real spawn
    queueSpawnResponse({
      stdout: JSON.stringify({ found: true, name: 'OK', controlType: 'Button' })
    });
    const a = await findElement(0xabcd, { name: 'OK' });
    expect(a).not.toBeNull();
    expect(mockedSpawn.mock.calls.length).toBe(1);

    // Second call within TTL: no new spawn, same handle
    const b = await findElement(0xabcd, { name: 'OK' });
    expect(b).toBe(a);
    expect(mockedSpawn.mock.calls.length).toBe(1);
  });

  it('re-spawns after the cache TTL expires', async () => {
    vi.useFakeTimers();
    const now = vi.getRealSystemTime();
    // Pin the clock so the test is deterministic.
    let current = now;
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => current);

    try {
      queueSpawnResponse({
        stdout: JSON.stringify({ found: true, name: 'OK', controlType: 'Button' })
      });
      await findElement(0xabcd, { name: 'OK' });
      expect(mockedSpawn.mock.calls.length).toBe(1);

      // Advance past the 5s TTL.
      current += __test__.CACHE_TTL_MS + 1;
      queueSpawnResponse({
        stdout: JSON.stringify({ found: true, name: 'OK', controlType: 'Button' })
      });
      await findElement(0xabcd, { name: 'OK' });
      expect(mockedSpawn.mock.calls.length).toBe(2);
    } finally {
      dateNowSpy.mockRestore();
    }
  });
});

describe('action wrappers via PowerShell (T3)', () => {
  // Shared "re-find" fixtures.  invokeElement / setElementText /
  // focusElement / getElementText all do an internal re-find
  // before the action; we queue TWO spawn responses (find + action)
  // per call.
  const foundJson = JSON.stringify({
    found: true,
    name: 'OK',
    controlType: 'Button',
    className: 'Button'
  });

  it('invokeElement re-finds and calls InvokePattern', async () => {
    queueSpawnResponse({ stdout: foundJson });
    queueSpawnResponse({ stdout: JSON.stringify({ ok: true }) });
    await expect(invokeElement(makeHandle({ name: 'OK' }))).resolves.toBeUndefined();
    expect(mockedSpawn.mock.calls.length).toBe(2);
    // Second call's script embeds InvokePattern
    const secondScript = lastScript();
    expect(secondScript).toContain('InvokePattern');
  });

  it('invokeElement throws UiaQueryError when element is no longer findable', async () => {
    queueSpawnResponse({ stdout: JSON.stringify({ found: false }) });
    await expect(invokeElement(makeHandle({ name: 'OK' }))).rejects.toBeInstanceOf(
      UiaQueryError
    );
    expect(mockedSpawn.mock.calls.length).toBe(1);
  });

  it('setElementText re-finds, calls SetValue, embeds escaped text', async () => {
    queueSpawnResponse({ stdout: foundJson });
    queueSpawnResponse({ stdout: JSON.stringify({ ok: true }) });
    await expect(
      setElementText(makeHandle({ name: 'q' }), "It's a test")
    ).resolves.toBeUndefined();
    const script = lastScript();
    expect(script).toContain('ValuePattern');
    expect(script).toContain('SetValue');
    expect(script).toContain("'It''s a test'");
  });

  it('getElementText returns the Value field', async () => {
    queueSpawnResponse({ stdout: foundJson });
    queueSpawnResponse({ stdout: JSON.stringify({ ok: true, text: 'hello world' }) });
    const r = await getElementText(makeHandle({ controlType: 'Edit' }));
    expect(r).toBe('hello world');
  });

  it('focusElement re-finds and calls SetFocus', async () => {
    queueSpawnResponse({ stdout: foundJson });
    queueSpawnResponse({ stdout: JSON.stringify({ ok: true }) });
    await expect(focusElement(makeHandle({ name: 'OK' }))).resolves.toBeUndefined();
    const script = lastScript();
    expect(script).toContain('SetFocus()');
  });

  it('action throws UiaQueryError when the action script reports ok:false', async () => {
    queueSpawnResponse({ stdout: foundJson });
    queueSpawnResponse({ stdout: JSON.stringify({ ok: false, error: 'value-pattern-unsupported' }) });
    await expect(
      setElementText(makeHandle({ controlType: 'Edit' }), 'x')
    ).rejects.toBeInstanceOf(UiaQueryError);
  });

  it('action throws UiaBackendUnavailableError when spawn itself fails', async () => {
    queueSpawnResponse({ stdout: foundJson });
    queueSpawnResponse({ spawnError: true, errorMessage: 'lost connection' });
    await expect(invokeElement(makeHandle({ name: 'OK' }))).rejects.toBeInstanceOf(
      UiaBackendUnavailableError
    );
  });
});

describe('listElementsInWindow via PowerShell (T3)', () => {
  it('parses an array of element objects', async () => {
    const arr = [
      {
        name: 'OK',
        automationId: 'btnOK',
        controlType: 'Button',
        className: 'Button',
        x: 10,
        y: 20,
        width: 80,
        height: 30,
        isEnabled: true,
        isVisible: true
      },
      {
        name: 'Cancel',
        automationId: 'btnCancel',
        controlType: 'Button',
        className: 'Button',
        x: 100,
        y: 20,
        width: 80,
        height: 30,
        isEnabled: true,
        isVisible: true
      }
    ];
    queueSpawnResponse({ stdout: JSON.stringify(arr) });
    const r = await listElementsInWindow(0xabcd);
    expect(r).toHaveLength(2);
    expect(r[0].name).toBe('OK');
    expect(r[1].name).toBe('Cancel');
  });

  it('returns [] when PowerShell emits []', async () => {
    queueSpawnResponse({ stdout: '[]' });
    const r = await listElementsInWindow(0xabcd, { controlType: 'Edit' });
    expect(r).toEqual([]);
  });

  it('filters by namePattern when supplied', async () => {
    const arr = [
      { name: 'Edit 1', controlType: 'Edit' },
      { name: 'OK Button', controlType: 'Button' },
      { name: 'Edit 2', controlType: 'Edit' }
    ];
    queueSpawnResponse({ stdout: JSON.stringify(arr) });
    const r = await listElementsInWindow(0xabcd, { namePattern: /^Edit/ });
    expect(r).toHaveLength(2);
    expect(r.map((e) => e.name)).toEqual(['Edit 1', 'Edit 2']);
  });
});

function makeHandle(selector: ElementSelector): UIAElementHandle {
  const info: UIElementInfo = {
    name: 'fake',
    automationId: '',
    controlType: 'Button',
    className: '',
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isEnabled: true,
    isVisible: true
  };
  return { hwnd: 0xabcd, selector, found: info };
}
