// Window binding utilities: enumerate and activate foreign windows so
// the simulator can drive a specific app even when SmartKeyboard is
// not focused.
//
// Implemented via koffi (lightweight FFI) calling user32 + kernel32
// + psapi directly. On non-Windows platforms the functions are
// no-ops that return null / [] so unit tests and dev-time imports
// still type-check.

import koffi from 'koffi';
import type { WindowDiagnostics, WindowInfo } from '../shared/types.js';
import {
  type RawWindow,
  basenameFromPath,
  dedupeWindowsByProcess,
  isEffectivelyVisible,
  resolveProcessName
} from './window.helpers.js';

// ----- koffi bindings ----------------------------------------------------
//
// We use the C-style prototype string form. koffi 3.x supports the
// MSDN-style _Out_ and _Inout_ qualifiers for out / inout parameters
// which gives us the cleanest mapping to the Win32 API.

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
let psapi: ReturnType<typeof koffi.load> | null = null;
try {
  psapi = koffi.load('psapi.dll');
} catch (err) {
  // psapi is a standard system DLL on Windows XP+, so failure to
  // load is exceedingly rare. We log and fall back to the pid-N
  // placeholder so the picker still works.
  console.warn('[window] failed to load psapi.dll:', err);
  psapi = null;
}

const GetForegroundWindow = user32.func(
  'void* __stdcall GetForegroundWindow()'
);

const IsWindowVisible = user32.func(
  'bool __stdcall IsWindowVisible(void* hWnd)'
);

const GetWindowTextW = user32.func(
  'int __stdcall GetWindowTextW(void* hWnd, _Out_ char16_t* lpString, int nMaxCount)'
);

const GetClassNameW = user32.func(
  'int __stdcall GetClassNameW(void* hWnd, _Out_ char16_t* lpClassName, int nMaxCount)'
);

const GetWindowThreadProcessId = user32.func(
  'uint32_t __stdcall GetWindowThreadProcessId(void* hWnd, _Out_ uint32_t* lpdwProcessId)'
);

const GetCurrentProcessId = kernel32.func(
  'uint32_t __stdcall GetCurrentProcessId()'
);

const GetCurrentThreadId = kernel32.func(
  'uint32_t __stdcall GetCurrentThreadId()'
);

// AttachThreadInput: "ties" the calling thread's input state to
// the specified thread's input state, so the calling thread can
// set the foreground window even when the OS would otherwise
// refuse (the foreground-lock rule introduced in Vista). This is
// the standard fix for "SetForegroundWindow silently fails when
// our process is not the current foreground process".
//
// v0.4.6: introduced to fix the Foreground-Lock defect reported
// in the v0.4.5 follow-up (see deliverable.md). The lifecycle
// is attach -> SetForegroundWindow -> sleep(50) -> detach.
const AttachThreadInput = user32.func(
  'bool __stdcall AttachThreadInput(uint32_t idAttach, uint32_t idAttachTo, bool fAttach)'
);

// AllowSetForegroundWindow: lets the calling process set the
// foreground window even if it is not currently the foreground
// process. ASFW_ANY (0xFFFFFFFF) is the documented "any process"
// value; some apps (especially games) set this to a specific PID
// instead. We use ASFW_ANY because we don't know the target's
// parent process identity in advance.
const AllowSetForegroundWindow = user32.func(
  'bool __stdcall AllowSetForegroundWindow(uint32_t dwProcessId)'
);

const ShowWindow = user32.func(
  'bool __stdcall ShowWindow(void* hWnd, int nCmdShow)'
);

const SetForegroundWindow = user32.func(
  'bool __stdcall SetForegroundWindow(void* hWnd)'
);

// OpenProcess: returns a process handle or null (for PPL / system
// processes we don't have access to). We only need the image name,
// so PROCESS_QUERY_LIMITED_INFORMATION (0x1000) is the minimum.
const OpenProcess = kernel32.func(
  'void* __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)'
);
const CloseHandle = kernel32.func(
  'bool __stdcall CloseHandle(void* hObject)'
);
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

// GetModuleFileNameExW is the supported API for getting a process'
// image path. The buffer is a wide string; the return value is the
// number of wchars written (or 0 on error). Note: this only exists
// on psapi.dll on Windows 7+. On XP you'd need GetModuleFileName
// from kernel32 with a process handle.
let GetModuleFileNameExW: ReturnType<NonNullable<typeof psapi>['func']> | null = null;
if (psapi) {
  try {
    GetModuleFileNameExW = psapi.func(
      'uint32_t __stdcall GetModuleFileNameExW(void* hProcess, void* hModule, _Out_ char16_t* lpFilename, uint32_t nSize)'
    );
  } catch (err) {
    console.warn('[window] failed to bind GetModuleFileNameExW:', err);
    GetModuleFileNameExW = null;
  }
}

// RECT struct for GetWindowRect.
const RECT = koffi.struct('RECT', {
  left: 'int32_t',
  top: 'int32_t',
  right: 'int32_t',
  bottom: 'int32_t'
});
const GetWindowRect = user32.func(
  'bool __stdcall GetWindowRect(void* hWnd, _Out_ RECT* lpRect)'
);

// ShowWindow commands we need
const SW_RESTORE = 9;
const SW_SHOW = 5;

// EnumWindows callback: returns bool, takes an HWND.
//
// v0.4.1 HOTFIX: koffi 3.2.1's `koffi.register()` rejects a raw
// `koffi.proto(...)` (which is a Prototype, not a Callback) with
// "Unexpected <Name> type, expected <callback> * type". The fix is
// to pass a *pointer* to the prototype — either via
// `koffi.pointer(EnumWindowsCallback)` (typed) or via the string
// form `'EnumWindowsCallback *'`. We use the typed `koffi.pointer`
// form so the function signature below can also reuse the same
// `koffi.pointer(EnumWindowsCallback)` type.
//
// The previous code (v0.2 → v0.4) silently swallowed the thrown
// TypeError in the try/catch, so `enumVisibleWindows()` always
// returned `[]`. This is the root cause of the v0.4.1 hotfix.
const EnumWindowsCallback = koffi.proto('bool __stdcall EnumWindowsCallback(void* hWnd)');
const EnumWindowsCallbackPtr = koffi.pointer(EnumWindowsCallback);
const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsCallback* lpEnumFunc, void* lParam)');

// ----- helpers -----------------------------------------------------------

function readWindowTitle(hwnd: bigint): string {
  // 512 wchars is plenty for any reasonable title.
  const buf = Buffer.alloc(1024);
  const written = GetWindowTextW(hwnd, buf, 512);
  if (written <= 0) return '';
  // Buffer was filled as utf-16le. Decode `written` code units.
  return buf.toString('utf16le', 0, written * 2);
}

function readClassName(hwnd: bigint): string {
  const buf = Buffer.alloc(512);
  const written = GetClassNameW(hwnd, buf, 256);
  if (written <= 0) return '';
  return buf.toString('utf16le', 0, written * 2);
}

function readPid(hwnd: bigint): number {
  // koffi 3.x: _Out_ primitive pointer ⇒ pass a single-element array.
  const out: number[] = [0];
  GetWindowThreadProcessId(hwnd, out);
  return out[0] ?? 0;
}

/**
 * v0.5-mini: return the thread id of the thread that owns the given
 * window's message queue (i.e. the thread that called CreateWindow
 * for the window). Returns 0 on failure or non-Windows.
 *
 * The thread id is what `AttachThreadInput` expects as the
 * idAttachTo argument. Without this, a runner can't reliably tie
 * its input state to the target window's input state (a requirement
 * for sending input that doesn't get filtered by the Foreground
 * Lock).
 */
export function getWindowThreadId(hwnd: number): number {
  if (process.platform !== 'win32') return 0;
  if (!hwnd || hwnd <= 0) return 0;
  try {
    const out: number[] = [0];
    // The koffi binding returns the thread id directly, but the MSDN
    // signature is the same as the call we use here. We use the
    // bind's return value rather than the out-parameter to avoid
    // depending on the order in which koffi fills them.
    const tid = Number(GetWindowThreadProcessId(BigInt(hwnd), out));
    return Number.isFinite(tid) && tid > 0 ? tid : 0;
  } catch (err) {
    console.error(`[window] getWindowThreadId(${hwnd}) failed:`, err);
    return 0;
  }
}

/**
 * v0.5-mini: lower-level AttachThreadInput control. Most callers should
 * prefer `withAttachedInput`. This variant lets the caller split the
 * attach → work → release sequence, e.g. when a single "attached" scope
 * spans multiple discrete input events.
 *
 * The returned object's `release` is idempotent (calling it more than
 * once is safe; subsequent calls are no-ops) so a caller that uses it
 * inside a try/finally doesn't have to track whether they've already
 * detached on the error path.
 */
export interface AttachedInput {
  release: () => void;
}

export function attachInputToWindow(hwnd: number): AttachedInput {
  const noop: AttachedInput = { release: () => {} };
  if (process.platform !== 'win32') return noop;
  if (!hwnd || hwnd <= 0) return noop;

  const targetTid = getWindowThreadId(hwnd);
  const myTid = GetCurrentThreadId();
  if (!targetTid || targetTid === myTid) return noop;

  const ok = !!AttachThreadInput(myTid, targetTid, true);
  if (!ok) {
    // Mirror the message in the original activateWindow slow path
    // so that the user can spot the cause from the main-process
    // console. This is rare in practice; the only documented
    // failure mode is when the target thread is terminating.
    console.warn(
      `[window] AttachThreadInput(my=${myTid}, target=${targetTid}) refused; continuing without attachment`
    );
    return noop;
  }
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      try {
        AttachThreadInput(myTid, targetTid, false);
      } catch (err) {
        console.error('[window] AttachThreadInput(detach) failed:', err);
      }
    }
  };
}

/**
 * v0.5-mini: run `fn` with the calling thread's input state attached
 * to the thread that owns `hwnd`. On Windows, the OS treats our
 * SendInput as if it came from the target process for the duration
 * of the call — which is the cure for "the runner's clicks don't
 * reach the bound window because the OS thinks the user didn't
 * initiate the input" (Foreground Lock / cross-process focus rules).
 *
 * - On non-Windows: just runs `fn`, no-op.
 * - For invalid hwnd (0/negative): just runs `fn`, no-op.
 * - If the target thread id is 0 or equal to ours: just runs `fn`.
 * - If `AttachThreadInput` is refused: logs a warning, runs `fn`
 *   anyway. We never want to abort the user's recipe because of an
 *   OS-level refusal.
 * - The detach happens in `finally`, including when `fn` throws.
 *
 * The runner (T2) wraps each UIA step in a `withAttachedInput` call
 * so that the UIA call lands in the target window's input state
 * even after the user has Alt-Tab'd away mid-run.
 */
export async function withAttachedInput<T>(
  hwnd: number,
  fn: () => Promise<T> | T
): Promise<T> {
  const attached = attachInputToWindow(hwnd);
  try {
    return await fn();
  } finally {
    attached.release();
  }
}

function readWindowRect(hwnd: bigint): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
  // Plain object works as the destination for an _Out_ struct pointer
  // under koffi 3.x. We initialise the keys defensively so the rest
  // of the code can read them even if koffi declines to fill the
  // object on a given platform.
  const rect: { left: number; top: number; right: number; bottom: number } = {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0
  };
  try {
    GetWindowRect(hwnd, rect);
  } catch (err) {
    // Some windows (e.g. those of other sessions) refuse. Treat as
    // zero-sized so isEffectivelyVisible filters them out.
    return { ...rect, width: 0, height: 0 };
  }
  const width = Math.max(0, rect.right - rect.left);
  const height = Math.max(0, rect.bottom - rect.top);
  return { ...rect, width, height };
}

/**
 * Resolve a PID to the basename of its image (e.g. "msedge.exe").
 * Returns "pid-{pid}" if psapi is unavailable, the process is a
 * protected process (Edge sub-processes, some games), or any
 * other error occurs. The caller always gets a non-empty string
 * when pid > 0, so the picker UI never has to special-case it.
 */
function getProcessNameFromPid(pid: number): string {
  if (!pid || pid <= 0) return '';
  if (!GetModuleFileNameExW) return `pid-${pid}`;
  try {
    const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!h) return `pid-${pid}`; // PPL / access denied
    try {
      // 1024 wchars = 2048 bytes is plenty for any realistic path.
      const buf = Buffer.alloc(2048);
      const written = GetModuleFileNameExW(h, null, buf, 1024);
      if (written <= 0) return `pid-${pid}`;
      const path = buf.toString('utf16le', 0, written * 2);
      return resolveProcessName(pid, basenameFromPath(path));
    } finally {
      try {
        CloseHandle(h);
      } catch {
        /* best effort */
      }
    }
  } catch (err) {
    console.error('[window] getProcessNameFromPid failed:', err);
    return `pid-${pid}`;
  }
}

function buildWindowInfo(
  hwnd: bigint,
  isVisible: boolean,
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }
): WindowInfo | null {
  const hwndNum = Number(hwnd);
  if (!Number.isFinite(hwndNum) || hwndNum === 0) return null;
  const title = readWindowTitle(hwnd);
  const pid = readPid(hwnd);
  const processName = pid > 0 ? getProcessNameFromPid(pid) : '';
  return {
    hwnd: hwndNum,
    title,
    processName,
    pid
  };
}

function buildRawWindow(
  hwnd: bigint,
  isVisible: boolean,
  rect: { width: number; height: number }
): RawWindow | null {
  const hwndNum = Number(hwnd);
  if (!Number.isFinite(hwndNum) || hwndNum === 0) return null;
  const title = readWindowTitle(hwnd);
  const pid = readPid(hwnd);
  const processName = pid > 0 ? getProcessNameFromPid(pid) : '';
  return {
    hwnd: hwndNum,
    pid,
    title,
    processName,
    isVisible,
    width: rect.width,
    height: rect.height,
    className: readClassName(hwnd)
  };
}

function isEffectivelyRawWindow(w: RawWindow): boolean {
  return isEffectivelyVisible(w.isVisible, w.width, w.height);
}

// ----- public API --------------------------------------------------------

/**
 * Return the currently focused top-level window, or null if the
 * foreground window is owned by our own process.
 */
export async function getForegroundWindow(): Promise<WindowInfo | null> {
  if (process.platform !== 'win32') return null;
  try {
    const hwnd = GetForegroundWindow();
    if (!hwnd) return null;
    // For the foreground window we don't need to gate on size; if
    // it's the foreground window it's by definition user-visible.
    const info = buildWindowInfo(hwnd, true, { left: 0, top: 0, right: 0, bottom: 0, width: 1, height: 1 });
    if (!info) return null;
    const myPid = GetCurrentProcessId();
    if (info.pid === myPid) return null;
    return info;
  } catch (err) {
    console.error('[window] getForegroundWindow failed:', err);
    return null;
  }
}

/**
 * Enumerate all visible top-level windows, excluding windows owned
 * by the current process. Returns at most one window per PID —
 * preferring visible+large over hidden+tiny.
 *
 * v0.4 changes:
 *   - Real process name via psapi.dll::GetModuleFileNameExW.
 *   - Hidden windows with non-zero size are kept (DirectX 9
 *     fullscreen games, Chromium sub-windows).
 *   - Empty-title windows are kept (some game splash / Chromium
 *     helper windows; the UI shows "(untitled)" as a fallback).
 *   - One row per PID, best candidate wins.
 *
 * v0.4.1 HOTFIX: the inner try/catch no longer swallows the
 * koffi.register TypeError. Errors are logged AND rethrown so the
 * IPC handler / renderer can surface "enumVisibleWindows failed:
 * ..." instead of silently returning [].
 */
export async function enumVisibleWindows(): Promise<WindowInfo[]> {
  if (process.platform !== 'win32') return [];
  try {
    const myPid = GetCurrentProcessId();
    const raw = collectRawWindows(myPid);
    const deduped = dedupeWindowsByProcess(raw);
    return deduped.map(toWindowInfo);
  } catch (err) {
    console.error('[window] enumVisibleWindows failed:', err);
    throw new Error(
      `enumVisibleWindows failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Return per-window diagnostics: same as enumVisibleWindows, plus
 * the extra fields that help a user figure out why a window does
 * or does not show up in the picker. Used by the AboutPage
 * diagnostic panel.
 *
 * v0.4.1 HOTFIX: rethrows the inner error so the AboutPage
 * diagnostic panel can show the real cause (e.g. the v0.4
 * koffi.register TypeError) instead of misleading "0 windows".
 */
export async function diagnoseWindows(): Promise<WindowDiagnostics[]> {
  if (process.platform !== 'win32') return [];
  try {
    const myPid = GetCurrentProcessId();
    const raw = collectRawWindows(myPid);
    return raw.map((w) => ({
      hwnd: w.hwnd,
      pid: w.pid,
      title: w.title,
      processName: w.processName,
      isVisible: w.isVisible,
      isEffectivelyVisible: isEffectivelyRawWindow(w),
      width: w.width,
      height: w.height,
      className: w.className
    }));
  } catch (err) {
    console.error('[window] diagnoseWindows failed:', err);
    throw new Error(
      `diagnoseWindows failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function collectRawWindows(myPid: number): RawWindow[] {
  const out: RawWindow[] = [];
  const cb = (hwnd: any) => {
    try {
      const visible = !!IsWindowVisible(hwnd);
      const rect = readWindowRect(hwnd);
      if (!isEffectivelyVisible(visible, rect.width, rect.height)) return true;
      const raw = buildRawWindow(hwnd, visible, rect);
      if (!raw) return true;
      if (raw.pid === myPid) return true;
      out.push(raw);
    } catch {
      // ignore per-window errors
    }
    return true;
  };
  // v0.4.1 HOTFIX: must pass a *pointer* to the proto type, not the
  // raw proto. See the comment at EnumWindowsCallback above.
  const handle = koffi.register(cb, EnumWindowsCallbackPtr);
  try {
    const ok = EnumWindows(handle, null);
    if (!ok) {
      // nothing useful to surface
    }
  } finally {
    koffi.unregister(handle);
  }
  return out;
}

function toWindowInfo(w: RawWindow): WindowInfo {
  return {
    hwnd: w.hwnd,
    pid: w.pid,
    title: w.title,
    processName: w.processName
  };
}

/**
 * v0.4.5: return the raw HWND currently in the foreground as a plain
 * number (0 if no foreground / non-Windows). Used by the runner to
 * verify focus didn't drift to SmartKeyboard between steps.
 */
export function getCurrentForegroundHwnd(): number {
  if (process.platform !== 'win32') return 0;
  try {
    const h = GetForegroundWindow();
    return Number(h) || 0;
  } catch {
    return 0;
  }
}

/**
 * Bring a window to the foreground. Returns true on success.
 * Uses ShowWindow(SW_RESTORE) + SetForegroundWindow. No attempt is
 * made to detach the input thread (AttachThreadInput); that's a v0.3
 * concern.
 *
 * v0.4.5: if the first SetForegroundWindow fails (Windows sometimes
 * refuses if the calling thread isn't the foreground thread), we
 * retry once after a short sleep. This makes activation more reliable
 * when the runner is called from the IPC handler.
 *
 * v0.4.6: when the simple path fails (Windows Foreground Lock
 * from a non-foreground process), the function now uses
 * `AttachThreadInput` to spoof the runner's input identity,
 * which bypasses the lock entirely. This is the fix for the
 * Foreground-Lock defect reported in the v0.4.5 follow-up
 * (user bound a window, switched to a browser mid-run, the
 * browser received subsequent SendInput events because the
 * runner could not re-acquire foreground on the bound window).
 * Also calls `AllowSetForegroundWindow(ASFW_ANY)` to grant
 * our process the right to set foreground when called.
 */
export async function activateWindow(hwnd: number): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  if (!hwnd || hwnd <= 0) return false;
  try {
    const h = BigInt(hwnd);
    ShowWindow(h, SW_RESTORE);
    ShowWindow(h, SW_SHOW);
    // Fast path: try the plain call. If we're still in the
    // foreground grace period (5s after our process was
    // foreground, OR the user just clicked our Run button),
    // this succeeds without the AttachThreadInput overhead.
    if (SetForegroundWindow(h)) return true;
    // v0.4.5: first attempt failed. We don't know whether the
    // user is still in the "foreground grace period" (5s after
    // our process was foreground) or whether the lock has been
    // consumed by another process. Log it so the user can tell
    // which is which from the main-process console.
    console.warn(`[window] SetForegroundWindow(${hwnd}) refused (likely foreground lock; will try AttachThreadInput path)`);

    // v0.4.6: slow path. We did not have foreground privilege,
    // so we go through AttachThreadInput. This is the standard
    // cure for Foreground Lock when the caller is not the
    // current foreground process.
    const tidBuf: number[] = [0];
    GetWindowThreadProcessId(h, tidBuf);
    const targetTid = tidBuf[0] ?? 0;
    const currentTid = GetCurrentThreadId();
    if (targetTid && targetTid !== currentTid) {
      // Belt-and-suspenders: explicitly grant our process
      // the right to set foreground. ASFW_ANY = 0xFFFFFFFF.
      AllowSetForegroundWindow(0xffffffff);
      // Attach our input thread to the target's input thread.
      // While attached, the OS treats our SetForegroundWindow
      // call as if it came from the target process, so the
      // foreground-lock check is satisfied.
      AttachThreadInput(currentTid, targetTid, true);
      try {
        ShowWindow(h, SW_RESTORE);
        ShowWindow(h, SW_SHOW);
        const ok = !!SetForegroundWindow(h);
        // Give the OS a beat to commit the focus switch before
        // we detach. Without this, the subsequent SendInput
        // can land on the wrong window (the OS hasn't yet
        // committed the foreground change).
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        if (!ok) {
          console.warn(`[window] SetForegroundWindow(${hwnd}) refused even after AttachThreadInput`);
        }
        return ok;
      } finally {
        // Detach immediately. We never want to leave the
        // threads attached for longer than necessary, because
        // an attached thread inherits the target's input state
        // including hooks / focus / capture.
        AttachThreadInput(currentTid, targetTid, false);
      }
    }
    // targetTid was 0 or equal to currentTid; nothing more we
    // can do.
    return false;
  } catch (err) {
    console.error('[window] activateWindow failed:', err);
    return false;
  }
}

// ----- test seam ---------------------------------------------------------
//
// The vitest mock for koffi doesn't implement `koffi.struct` or
// `koffi.load('psapi.dll')` exactly the way the real one does.
// Exposing the bound functions as a namespace lets the test inject
// custom behaviour without going through the module-level koffi
// registration. In production this object is read-only; tests
// replace it before importing window.ts.

export const __test__ = {
  GetModuleFileNameExW,
  OpenProcess,
  CloseHandle,
  GetClassNameW,
  GetWindowRect,
  RECT,
  // v0.5-mini: the new thread-attachment helpers depend on these
  // three koffi binds. Tests can swap the implementation to drive
  // specific attach/detach sequences without going through the
  // real Win32 path.
  GetWindowThreadProcessId,
  GetCurrentThreadId,
  AttachThreadInput
};
