// v0.5-mini: tests for the new thread-attachment helpers
// (withAttachedInput / attachInputToWindow / getWindowThreadId).
//
// Re-uses the same hoisted koffi mock shape as tests/window.spec.ts
// so the existing GetWindowThreadProcessId / GetCurrentThreadId /
// AttachThreadInput spies from that mock are available — but we
// re-define a *separate* hoisted koffi mock here so this spec can
// run in isolation (and so the spy arrays aren't shared with
// window.spec.ts's beforeEach reset).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const koffiMock = vi.hoisted(() => {
  // We store the raw argument arrays so tests can read them by
  // position without an extra `args` wrapper. Keeping the same
  // shape as tests/window.spec.ts (positional arrays) is what
  // lets us reason about the mock uniformly across specs.
  const calls = {
    load: [] as string[],
    AttachThreadInput: [] as Array<[number, number, boolean]>,
    GetWindowThreadProcessId: [] as Array<[bigint, number[] | undefined]>,
    GetCurrentThreadId: [] as Array<[]>
  };

  // Behavior is controlled per-test.
  const behavior: {
    myTid: number;
    // hwnd (bigint) → thread id returned by GetWindowThreadProcessId
    hwndToTid: Map<bigint, number>;
    // What AttachThreadInput returns (true = success).
    attachOk: boolean;
  } = {
    myTid: 42,
    hwndToTid: new Map(),
    attachOk: true
  };

  function makeFunc<T extends (...args: any[]) => any>(name: keyof typeof calls, impl: T) {
    return (...args: Parameters<T>) => {
      (calls as any)[name].push(args);
      return impl(...args);
    };
  }

  function reset() {
    calls.load.length = 0;
    calls.AttachThreadInput.length = 0;
    calls.GetWindowThreadProcessId.length = 0;
    calls.GetCurrentThreadId.length = 0;
    behavior.myTid = 42;
    behavior.hwndToTid = new Map();
    behavior.attachOk = true;
  }

  // user32 has all the binds we touch.
  const user32Lib = {
    func: (def: any, ..._rest: any[]) => {
      const name =
        typeof def === 'string'
          ? (def.match(/__stdcall\s+(\w+)/) ?? def.match(/^\s*[\w_*\s]+\s+(\w+)\s*\(/))?.[1] ?? def
          : 'unknown';
      switch (name) {
        case 'GetWindowThreadProcessId':
          return makeFunc(
            'GetWindowThreadProcessId',
            (hwnd: bigint, out: number[] | undefined) => {
              const tid = behavior.hwndToTid.get(hwnd) ?? 0;
              if (Array.isArray(out) && out.length > 0) {
                out[0] = tid;
              }
              return tid;
            }
          );
        case 'AttachThreadInput':
          return makeFunc(
            'AttachThreadInput',
            (_idAttach: number, _idAttachTo: number, _fAttach: boolean) => {
              return behavior.attachOk;
            }
          );
        default:
          // Other user32 funcs are loaded but unused in this spec.
          // Return a no-op so the bind doesn't throw on import.
          return makeFunc(name as any, () => 0);
      }
    }
  };

  // kernel32 binds GetCurrentThreadId.
  const kernel32Lib = {
    func: (def: any, ..._rest: any[]) => {
      const name =
        typeof def === 'string'
          ? (def.match(/__stdcall\s+(\w+)/) ?? def.match(/^\s*[\w_*\s]+\s+(\w+)\s*\(/))?.[1] ?? def
          : 'unknown';
      switch (name) {
        case 'GetCurrentThreadId':
          return makeFunc('GetCurrentThreadId', () => behavior.myTid);
        default:
          return makeFunc(name as any, () => 0);
      }
    }
  };

  const koffi = {
    load: (path: string) => {
      calls.load.push(path);
      if (path.includes('kernel32')) return kernel32Lib;
      return user32Lib;
    },
    proto: () => ({ __proto: 'koffi_proto' }),
    pointer: (ref: unknown) => ({ __ptr: ref }),
    struct: (name: string, def: any) => ({ __struct_name: name, __struct_fields: def }),
    register: () => 1n,
    unregister: () => {}
  };

  return { calls, behavior, koffi, reset };
});

vi.mock('koffi', () => ({ default: koffiMock.koffi, ...koffiMock.koffi }));

import {
  withAttachedInput,
  attachInputToWindow,
  getWindowThreadId
} from '../src/main/window';

beforeEach(() => {
  koffiMock.reset();
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
});

describe('withAttachedInput (v0.5-mini)', () => {
  it('runs fn when hwnd is 0 (no attach, no detach)', async () => {
    const r = await withAttachedInput(0, async () => 'ok');
    expect(r).toBe('ok');
    expect(koffiMock.calls.AttachThreadInput.length).toBe(0);
  });

  it('runs fn when hwnd is negative (no attach, no detach)', async () => {
    const r = await withAttachedInput(-1, () => 'ok');
    expect(r).toBe('ok');
    expect(koffiMock.calls.AttachThreadInput.length).toBe(0);
  });

  it('runs fn when not on Windows (no attach, no detach)', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const r = await withAttachedInput(0x1234, async () => 'ok');
      expect(r).toBe('ok');
    } finally {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    }
    expect(koffiMock.calls.AttachThreadInput.length).toBe(0);
  });

  it('skips attach when target thread id equals our own (same thread)', async () => {
    // myTid is 42. Pretend the target window is on the same thread.
    koffiMock.behavior.hwndToTid.set(BigInt(0xdead), 42);
    const r = await withAttachedInput(0xdead, () => 'same-thread');
    expect(r).toBe('same-thread');
    expect(koffiMock.calls.AttachThreadInput.length).toBe(0);
  });

  it('attaches before fn runs and detaches after fn returns', async () => {
    koffiMock.behavior.hwndToTid.set(BigInt(0xbeef), 99);
    koffiMock.behavior.myTid = 42;
    koffiMock.behavior.attachOk = true;

    const events: string[] = [];
    const r = await withAttachedInput(0xbeef, async () => {
      events.push('inside');
      // Inside fn: exactly one attach call should have happened.
      expect(koffiMock.calls.AttachThreadInput.length).toBe(1);
      const call = koffiMock.calls.AttachThreadInput[0];
      expect(call[0]).toBe(42);   // idAttach
      expect(call[1]).toBe(99);   // idAttachTo
      expect(call[2]).toBe(true); // fAttach
      return 'ok';
    });
    expect(r).toBe('ok');
    // After fn: the detach should be on the call log.
    expect(koffiMock.calls.AttachThreadInput.length).toBe(2);
    const detach = koffiMock.calls.AttachThreadInput[1];
    expect(detach[0]).toBe(42);
    expect(detach[1]).toBe(99);
    expect(detach[2]).toBe(false);
  });

  it('still releases attach when fn throws (finally semantics)', async () => {
    koffiMock.behavior.hwndToTid.set(BigInt(0xcafe), 100);
    koffiMock.behavior.myTid = 42;
    koffiMock.behavior.attachOk = true;

    await expect(
      withAttachedInput(0xcafe, () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    // Even on throw: one attach + one detach.
    expect(koffiMock.calls.AttachThreadInput.length).toBe(2);
    expect(koffiMock.calls.AttachThreadInput[0][2]).toBe(true);
    expect(koffiMock.calls.AttachThreadInput[1][2]).toBe(false);
  });

  it('still releases attach when fn rejects (async error)', async () => {
    koffiMock.behavior.hwndToTid.set(BigInt(0xfeed), 200);
    koffiMock.behavior.myTid = 42;

    await expect(
      withAttachedInput(0xfeed, async () => {
        throw new Error('async-boom');
      })
    ).rejects.toThrow('async-boom');
    expect(koffiMock.calls.AttachThreadInput.length).toBe(2);
  });

  it('runs fn even when AttachThreadInput returns false (degrades gracefully)', async () => {
    koffiMock.behavior.hwndToTid.set(BigInt(0xfeed), 200);
    koffiMock.behavior.myTid = 42;
    koffiMock.behavior.attachOk = false;

    const r = await withAttachedInput(0xfeed, () => 'still-ok');
    expect(r).toBe('still-ok');
    // One attach call, no detach (the attach was refused so there's
    // nothing to release).
    expect(koffiMock.calls.AttachThreadInput.length).toBe(1);
  });
});

describe('attachInputToWindow (v0.5-mini)', () => {
  it('returns a noop handle on non-Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const handle = attachInputToWindow(0x1234);
      handle.release();
      handle.release(); // idempotent
    } finally {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    }
    expect(koffiMock.calls.AttachThreadInput.length).toBe(0);
  });

  it('returns a noop handle for hwnd=0', () => {
    const handle = attachInputToWindow(0);
    handle.release();
    expect(koffiMock.calls.AttachThreadInput.length).toBe(0);
  });

  it('returned release is idempotent (double-call safe)', () => {
    koffiMock.behavior.hwndToTid.set(BigInt(0xbeef), 99);
    koffiMock.behavior.attachOk = true;
    const handle = attachInputToWindow(0xbeef);
    handle.release();
    handle.release();
    handle.release();
    // Exactly one attach + one detach, regardless of how many
    // times release was called.
    expect(koffiMock.calls.AttachThreadInput.length).toBe(2);
  });
});

describe('getWindowThreadId (v0.5-mini)', () => {
  it('returns 0 on non-Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const tid = getWindowThreadId(0x1234);
      expect(tid).toBe(0);
    } finally {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    }
  });

  it('returns 0 for hwnd=0', () => {
    expect(getWindowThreadId(0)).toBe(0);
  });

  it('returns 0 for negative hwnd', () => {
    expect(getWindowThreadId(-1)).toBe(0);
  });

  it('returns the thread id of the window', () => {
    koffiMock.behavior.hwndToTid.set(BigInt(0x1111), 7777);
    expect(getWindowThreadId(0x1111)).toBe(7777);
  });

  it('returns 0 for an unknown hwnd', () => {
    // No entry in hwndToTid → mock returns 0.
    expect(getWindowThreadId(0x9999)).toBe(0);
  });
});
