import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted koffi mock: configurable koffi.load returns a fake
// user32 / kernel32 / psapi with the symbols we need. We capture
// calls so tests can assert behaviour without touching real DLLs.
const koffiMock = vi.hoisted(() => {
  const calls = {
    load: [] as string[],
    register: [] as Array<{ cb: unknown; type: unknown; __handle: bigint }>,
    unregister: [] as bigint[],
    GetForegroundWindow: [] as unknown[],
    IsWindowVisible: [] as Array<{ hwnd: unknown; result: boolean }>,
    GetWindowTextW: [] as Array<{ hwnd: unknown; result: number }>,
    GetClassNameW: [] as Array<{ hwnd: unknown; result: number }>,
    GetWindowThreadProcessId: [] as Array<{ hwnd: unknown; pid: number }>,
    GetCurrentProcessId: [] as unknown[],
    GetCurrentThreadId: [] as unknown[],
    ShowWindow: [] as Array<{ hwnd: unknown; cmd: number }>,
    SetForegroundWindow: [] as Array<{ hwnd: unknown; ok: boolean }>,
    AttachThreadInput: [] as Array<{ idAttach: number; idAttachTo: number; fAttach: boolean; ok: boolean }>,
    AllowSetForegroundWindow: [] as Array<{ pid: number; ok: boolean }>,
    EnumWindows: [] as Array<{ ok: boolean }>,
    GetModuleFileNameExW: [] as Array<{ pid: number; result: number }>,
    OpenProcess: [] as Array<{ pid: number; ok: boolean }>,
    CloseHandle: [] as Array<{ h: unknown; ok: boolean }>,
    GetWindowRect: [] as Array<{ hwnd: unknown; result: boolean }>
  };

  // Behaviour is controlled per-test via the helpers below.
  const behavior: {
    myPid: number;
    myTid: number;
    foregroundHwnd: bigint | null;
    foregroundPid: number;
    foregroundTitle: string;
    foregroundClass: string;
    visibleWindows: Array<{
      hwnd: bigint;
      pid: number;
      title: string;
      visible: boolean;
      className?: string;
      size?: { left: number; top: number; right: number; bottom: number };
    }>;
    setForegroundResult: boolean;
    processNames: Record<number, string>;
    // PIDs that OpenProcess should refuse (mimics PPL / protected
    // processes like Edge sub-processes).
    protectedPids: Set<number>;
  } = {
    myPid: 9999,
    myTid: 1,
    foregroundHwnd: null,
    foregroundPid: 1234,
    foregroundTitle: 'Notepad',
    foregroundClass: 'Notepad',
    visibleWindows: [],
    setForegroundResult: true,
    processNames: {},
    protectedPids: new Set()
  };

  // handle -> pid map for the psapi mocks. The real koffi passes
  // a kernel handle here; in the mock we just use a BigInt per
  // process so we can correlate back to a pid.
  const handleToPid = new Map<bigint, number>();
  let nextHandle: bigint = 1n;

  function makeFunc<T extends (...args: any[]) => any>(name: keyof typeof calls, impl: T) {
    return (...args: Parameters<T>) => {
      (calls as any)[name].push(args);
      return impl(...args);
    };
  }

  function reset() {
    for (const k of Object.keys(calls)) {
      (calls as any)[k] = [];
    }
    behavior.myPid = 9999;
    behavior.myTid = 1;
    behavior.foregroundHwnd = null;
    behavior.foregroundPid = 1234;
    behavior.foregroundTitle = 'Notepad';
    behavior.foregroundClass = 'Notepad';
    behavior.visibleWindows = [];
    behavior.setForegroundResult = true;
    behavior.processNames = {};
    behavior.protectedPids = new Set();
    handleToPid.clear();
    nextHandle = 1n;
  }

  function getRect(hwnd: bigint): { left: number; top: number; right: number; bottom: number } {
    if (behavior.foregroundHwnd === hwnd) {
      return { left: 100, top: 100, right: 1000, bottom: 700 };
    }
    const w = behavior.visibleWindows.find((x) => x.hwnd === hwnd);
    if (w && w.size) return w.size;
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }

  const user32Lib = {
    func: (def: any, ...rest: any[]) => {
      let name: string;
      if (typeof def === 'string') {
        const m = def.match(/__stdcall\s+(\w+)/) || def.match(/^\s*[\w_*\s]+\s+(\w+)\s*\(/);
        name = m ? m[1] : def;
      } else {
        name = rest[0];
      }
      switch (name) {
        case 'GetForegroundWindow':
          return makeFunc('GetForegroundWindow', () => behavior.foregroundHwnd);
        case 'IsWindowVisible':
          return makeFunc('IsWindowVisible', (hwnd: bigint) => {
            if (behavior.foregroundHwnd === hwnd) return true;
            const w = behavior.visibleWindows.find((x) => x.hwnd === hwnd);
            return w ? w.visible : false;
          });
        case 'GetWindowTextW':
          return makeFunc('GetWindowTextW', (hwnd: bigint, buf: any, n: number) => {
            let title = '';
            if (behavior.foregroundHwnd === hwnd) title = behavior.foregroundTitle;
            const w = behavior.visibleWindows.find((x) => x.hwnd === hwnd);
            if (w) title = w.title;
            if (title.length > n) title = title.slice(0, n);
            if (buf && typeof buf.write === 'function') {
              const bytes = Buffer.from(title, 'utf16le');
              bytes.copy(buf);
            }
            return title.length;
          });
        case 'GetClassNameW':
          return makeFunc('GetClassNameW', (hwnd: bigint, buf: any, n: number) => {
            let cls = '';
            if (behavior.foregroundHwnd === hwnd) cls = behavior.foregroundClass;
            const w = behavior.visibleWindows.find((x) => x.hwnd === hwnd);
            if (w) cls = w.className || '';
            if (cls.length > n) cls = cls.slice(0, n);
            if (buf && typeof buf.write === 'function') {
              const bytes = Buffer.from(cls, 'utf16le');
              bytes.copy(buf);
            }
            return cls.length;
          });
        case 'GetWindowThreadProcessId':
          return makeFunc('GetWindowThreadProcessId', (hwnd: bigint, out: number[] | undefined) => {
            let pid = 0;
            if (behavior.foregroundHwnd === hwnd) pid = behavior.foregroundPid;
            const w = behavior.visibleWindows.find((x) => x.hwnd === hwnd);
            if (w) pid = w.pid;
            if (Array.isArray(out) && out.length > 0) {
              out[0] = pid;
            }
            return pid + 1000;
          });
        case 'ShowWindow':
          return makeFunc('ShowWindow', (_hwnd: unknown, cmd: number) => true);
        case 'SetForegroundWindow':
          return makeFunc('SetForegroundWindow', (_hwnd: unknown) => behavior.setForegroundResult);
        case 'AttachThreadInput':
          return makeFunc('AttachThreadInput', (idAttach: number, idAttachTo: number, fAttach: boolean) => {
            // v0.4.6: spoof the attach. In a real OS this would
            // tie the two threads' input state together; the
            // mock just records the call and reports success.
            return true;
          });
        case 'AllowSetForegroundWindow':
          return makeFunc('AllowSetForegroundWindow', (_pid: number) => true);
        case 'EnumWindows':
          return makeFunc('EnumWindows', (cbHandle: bigint, _lparam: unknown) => {
            const reg = calls.register.find((r) => r && (r as any).__handle === cbHandle);
            const cb = (reg as any)?.cb;
            if (typeof cb === 'function') {
              for (const w of behavior.visibleWindows) {
                cb(w.hwnd);
              }
            }
            return true;
          });
        case 'GetWindowRect':
          return makeFunc('GetWindowRect', (hwnd: bigint, out: any) => {
            const r = getRect(hwnd);
            if (out && typeof out === 'object') {
              out.left = r.left;
              out.top = r.top;
              out.right = r.right;
              out.bottom = r.bottom;
            }
            return true;
          });
        default:
          throw new Error(`unexpected user32 func: ${name}`);
      }
    }
  };

  const kernel32Lib = {
    func: (def: any, ...rest: any[]) => {
      let name: string;
      if (typeof def === 'string') {
        const m = def.match(/__stdcall\s+(\w+)/) || def.match(/^\s*[\w_*\s]+\s+(\w+)\s*\(/);
        name = m ? m[1] : def;
      } else {
        name = rest[0];
      }
      switch (name) {
        case 'GetCurrentProcessId':
          return makeFunc('GetCurrentProcessId', () => behavior.myPid);
        case 'GetCurrentThreadId':
          return makeFunc('GetCurrentThreadId', () => behavior.myTid);
        case 'OpenProcess':
          return makeFunc('OpenProcess', (_access: number, _inherit: boolean, pid: number) => {
            if (behavior.protectedPids.has(pid)) return null;
            const h = BigInt(0x10000) + nextHandle;
            nextHandle += 1n;
            handleToPid.set(h, pid);
            return h;
          });
        case 'CloseHandle':
          return makeFunc('CloseHandle', (h: bigint) => {
            handleToPid.delete(h);
            return true;
          });
        default:
          throw new Error(`unexpected kernel32 func: ${name}`);
      }
    }
  };

  const psapiLib = {
    func: (def: any, ...rest: any[]) => {
      let name: string;
      if (typeof def === 'string') {
        const m = def.match(/__stdcall\s+(\w+)/) || def.match(/^\s*[\w_*\s]+\s+(\w+)\s*\(/);
        name = m ? m[1] : def;
      } else {
        name = rest[0];
      }
      switch (name) {
        case 'GetModuleFileNameExW':
          return makeFunc('GetModuleFileNameExW', (h: bigint, _m: unknown, buf: any, _n: number) => {
            const pid = handleToPid.get(h);
            if (pid === undefined) return 0;
            const basename = behavior.processNames[pid];
            if (!basename) return 0;
            const path = `C:\\Program Files\\${basename}`;
            if (buf && typeof buf.write === 'function') {
              const bytes = Buffer.from(path, 'utf16le');
              bytes.copy(buf);
            }
            return path.length;
          });
        default:
          throw new Error(`unexpected psapi func: ${name}`);
      }
    }
  };

  const koffi = {
    load: (path: string) => {
      calls.load.push(path);
      if (path.includes('kernel32')) return kernel32Lib;
      if (path.includes('psapi')) return psapiLib;
      return user32Lib;
    },
    proto: (..._args: unknown[]) => ({ __proto: 'koffi_proto' }),
    // v0.4.1 HOTFIX: the production code now wraps the proto with
    // `koffi.pointer(EnumWindowsCallback)` before calling register.
    // The mock needs to accept the same call shape.
    pointer: (ref: unknown) => ({ __ptr: ref }),
    struct: (name: string, def: any) => ({ __struct_name: name, __struct_fields: def }),
    register: (cb: unknown, type: unknown) => {
      const handle = BigInt(calls.register.length + 1);
      calls.register.push({ cb, type, __handle: handle } as any);
      return handle;
    },
    unregister: (handle: bigint) => {
      calls.unregister.push(handle);
    },
    out: (type: unknown) => ({ __out: type })
  };

  return { calls, behavior, koffi, reset };
});

vi.mock('koffi', () => ({ default: koffiMock.koffi, ...koffiMock.koffi }));

import {
  getForegroundWindow,
  enumVisibleWindows,
  activateWindow,
  diagnoseWindows
} from '../src/main/window';

beforeEach(() => {
  koffiMock.reset();
  // Pretend we're on Windows for the duration of these tests.
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
});

describe('window: getForegroundWindow', () => {
  it('returns null when there is no foreground window', async () => {
    koffiMock.behavior.foregroundHwnd = null;
    const info = await getForegroundWindow();
    expect(info).toBeNull();
  });

  it('returns WindowInfo for a foreign foreground window', async () => {
    koffiMock.behavior.foregroundHwnd = BigInt(0x1234);
    koffiMock.behavior.foregroundPid = 7777;
    koffiMock.behavior.foregroundTitle = 'My Game';
    koffiMock.behavior.foregroundClass = 'YYGameMaker';
    koffiMock.behavior.processNames[7777] = 'QQXXHG.exe';
    koffiMock.behavior.myPid = 9999;
    const info = await getForegroundWindow();
    expect(info).not.toBeNull();
    expect(info?.hwnd).toBe(0x1234);
    expect(info?.pid).toBe(7777);
    expect(info?.title).toBe('My Game');
    expect(info?.processName).toBe('QQXXHG.exe');
  });

  it('returns null when the foreground window is our own process', async () => {
    koffiMock.behavior.foregroundHwnd = BigInt(0xabcd);
    koffiMock.behavior.foregroundPid = 9999;
    koffiMock.behavior.myPid = 9999;
    const info = await getForegroundWindow();
    expect(info).toBeNull();
  });
});

describe('window: enumVisibleWindows (v0.4)', () => {
  it('keeps visible windows AND hidden-with-size windows (DirectX 9 games)', async () => {
    koffiMock.behavior.myPid = 9999;
    koffiMock.behavior.processNames = {
      100: 'app-a.exe',
      200: 'QQXXHG.exe',
      400: 'app-b.exe'
    };
    koffiMock.behavior.visibleWindows = [
      // classic visible window
      { hwnd: BigInt(1), pid: 100, title: 'App A', visible: true, size: { left: 0, top: 0, right: 800, bottom: 600 } },
      // self pid: filtered
      { hwnd: BigInt(2), pid: 9999, title: 'Self!', visible: true, size: { left: 0, top: 0, right: 100, bottom: 100 } },
      // DirectX 9 fullscreen game: not "visible" by IsWindowVisible but has size
      { hwnd: BigInt(3), pid: 200, title: 'QQ自由幻想', visible: false, size: { left: 0, top: 0, right: 1920, bottom: 1080 } },
      // truly hidden: IsWindowVisible=false AND size=0
      { hwnd: BigInt(4), pid: 300, title: 'Hidden', visible: false, size: { left: 0, top: 0, right: 0, bottom: 0 } },
      // empty title but visible: should now be KEPT
      { hwnd: BigInt(5), pid: 400, title: '', visible: true, size: { left: 0, top: 0, right: 500, bottom: 300 } }
    ];
    const list = await enumVisibleWindows();
    const hwnds = list.map((w) => w.hwnd).sort();
    expect(hwnds).toEqual([1, 3, 5]);
    // The QQ game should have its real process name (psapi path basename).
    const qq = list.find((w) => w.hwnd === 3);
    expect(qq?.processName).toBe('QQXXHG.exe');
  });

  it('deduplicates by PID, keeping the visible+largest window per process', async () => {
    koffiMock.behavior.myPid = 9999;
    koffiMock.behavior.processNames[555] = 'chrome.exe';
    // Chrome pattern: one small invisible (extension popup) and one
    // large visible (the main browser shell). Both share a pid.
    koffiMock.behavior.visibleWindows = [
      { hwnd: BigInt(10), pid: 555, title: 'Popup', visible: false, size: { left: 0, top: 0, right: 200, bottom: 100 } },
      { hwnd: BigInt(11), pid: 555, title: 'Bing — Google Chrome', visible: true, size: { left: 0, top: 0, right: 1280, bottom: 800 } }
    ];
    const list = await enumVisibleWindows();
    expect(list.length).toBe(1);
    expect(list[0].hwnd).toBe(11);
    expect(list[0].title).toBe('Bing — Google Chrome');
  });

  it('falls back to pid-{N} placeholder when OpenProcess refuses (PPL / system)', async () => {
    koffiMock.behavior.myPid = 9999;
    koffiMock.behavior.protectedPids.add(666);
    koffiMock.behavior.visibleWindows = [
      { hwnd: BigInt(20), pid: 666, title: 'Edge Helper', visible: true, size: { left: 0, top: 0, right: 100, bottom: 100 } }
    ];
    const list = await enumVisibleWindows();
    expect(list.length).toBe(1);
    expect(list[0].processName).toBe('pid-666');
  });

  it('returns an empty array when there are no visible windows', async () => {
    koffiMock.behavior.visibleWindows = [];
    const list = await enumVisibleWindows();
    expect(list).toEqual([]);
  });

  it('returns an empty array on non-Windows platforms', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    koffiMock.behavior.visibleWindows = [
      { hwnd: BigInt(1), pid: 100, title: 'X', visible: true, size: { left: 0, top: 0, right: 100, bottom: 100 } }
    ];
    const list = await enumVisibleWindows();
    expect(list).toEqual([]);
  });
});

describe('window: diagnoseWindows (v0.4)', () => {
  it('returns raw per-window diagnostics including className and rect', async () => {
    koffiMock.behavior.myPid = 9999;
    koffiMock.behavior.processNames = { 100: 'msedge.exe' };
    koffiMock.behavior.visibleWindows = [
      { hwnd: BigInt(1), pid: 100, title: 'Edge', visible: true, className: 'Chrome_WidgetWin_1', size: { left: 0, top: 0, right: 1280, bottom: 800 } },
      { hwnd: BigInt(2), pid: 200, title: 'QQ游戏', visible: false, className: 'TWINCONTROL', size: { left: 0, top: 0, right: 1920, bottom: 1080 } }
    ];
    const list = await diagnoseWindows();
    expect(list.length).toBe(2);
    const edge = list.find((d) => d.hwnd === 1);
    expect(edge?.isEffectivelyVisible).toBe(true);
    expect(edge?.className).toBe('Chrome_WidgetWin_1');
    expect(edge?.width).toBe(1280);
    expect(edge?.height).toBe(800);
    const qq = list.find((d) => d.hwnd === 2);
    expect(qq?.isEffectivelyVisible).toBe(true);
    expect(qq?.isVisible).toBe(false);
    expect(qq?.className).toBe('TWINCONTROL');
  });
});

describe('window: activateWindow', () => {
  it('calls ShowWindow + SetForegroundWindow and returns true on success', async () => {
    koffiMock.behavior.setForegroundResult = true;
    const ok = await activateWindow(0x1111);
    expect(ok).toBe(true);
    expect(koffiMock.calls.ShowWindow.length).toBeGreaterThanOrEqual(1);
    expect(koffiMock.calls.SetForegroundWindow.length).toBe(1);
  });

  it('returns false when SetForegroundWindow fails', async () => {
    koffiMock.behavior.setForegroundResult = false;
    const ok = await activateWindow(0x2222);
    expect(ok).toBe(false);
  });

  it('returns false for invalid hwnd (0 or negative)', async () => {
    expect(await activateWindow(0)).toBe(false);
    expect(await activateWindow(-1)).toBe(false);
  });

  // v0.4.6: when SetForegroundWindow fails, the slow path
  // should call AttachThreadInput(targetTid, currentTid) and
  // AllowSetForegroundWindow(ASFW_ANY), then retry
  // SetForegroundWindow. The test exercises this by setting
  // setForegroundResult to false (so the first call fails) and
  // verifying the side effects.
  it('falls back to AttachThreadInput path when first SetForegroundWindow is refused', async () => {
    koffiMock.behavior.setForegroundResult = false;
    // Make the target window have a tid (5000) different from
    // the mock's current thread tid (1) so AttachThreadInput
    // is called.
    koffiMock.behavior.foregroundHwnd = 0x3333n;
    koffiMock.behavior.foregroundPid = 1234;
    const ok = await activateWindow(0x3333);
    // The fallback SetForegroundWindow also returns false
    // (because setForegroundResult is false), so the function
    // returns false — but the AttachThreadInput path WAS taken.
    expect(ok).toBe(false);
    expect(koffiMock.calls.AllowSetForegroundWindow.length).toBeGreaterThanOrEqual(1);
    expect(koffiMock.calls.AttachThreadInput.length).toBeGreaterThanOrEqual(2); // attach + detach
    // First attach: fAttach=true; last attach: fAttach=false
    const a = koffiMock.calls.AttachThreadInput as unknown as Array<[number, number, boolean]>;
    expect(a[0][2]).toBe(true);
    expect(a[a.length - 1][2]).toBe(false);
  });

  // v0.4.6: when the fast path succeeds (setForegroundResult=true),
  // we do NOT enter the AttachThreadInput path. The first
  // SetForegroundWindow already won, so we shouldn't be paying
  // for the cross-thread attach.
  it('does not call AttachThreadInput when the fast path succeeds', async () => {
    koffiMock.behavior.setForegroundResult = true;
    koffiMock.behavior.foregroundHwnd = 0x4444n;
    koffiMock.behavior.foregroundPid = 1234;
    const ok = await activateWindow(0x4444);
    expect(ok).toBe(true);
    expect(koffiMock.calls.AttachThreadInput.length).toBe(0);
  });
});

describe('window: v0.4.1 hotfix koffi.register', () => {
  it('passes koffi.pointer(proto) to koffi.register (not a raw proto)', async () => {
    // Make sure the cb is actually invoked once so the register
    // path is exercised.
    koffiMock.behavior.myPid = 9999;
    koffiMock.behavior.visibleWindows = [
      { hwnd: BigInt(1), pid: 100, title: 'X', visible: true, size: { left: 0, top: 0, right: 200, bottom: 100 } }
    ];
    await enumVisibleWindows();
    // The last register call should have a `__ptr` wrapper, which
    // mirrors `koffi.pointer(EnumWindowsCallback)` in production.
    // (Without this, koffi 3.x throws "expected <callback> * type".)
    const last = koffiMock.calls.register[koffiMock.calls.register.length - 1];
    expect(last).toBeDefined();
    expect(last?.type).toEqual({ __ptr: { __proto: 'koffi_proto' } });
  });
});
