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
 * Bring a window to the foreground. Returns true on success.
 * Uses ShowWindow(SW_RESTORE) + SetForegroundWindow. No attempt is
 * made to detach the input thread (AttachThreadInput); that's a v0.3
 * concern.
 */
export async function activateWindow(hwnd: number): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  if (!hwnd || hwnd <= 0) return false;
  try {
    const h = BigInt(hwnd);
    ShowWindow(h, SW_RESTORE);
    ShowWindow(h, SW_SHOW);
    return !!SetForegroundWindow(h);
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
  RECT
};
