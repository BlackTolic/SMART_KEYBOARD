import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mouseMock, keyboardMock, ButtonMock, PointMock } = vi.hoisted(() => {
  const mouseMock = {
    setPosition: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    doubleClick: vi.fn().mockResolvedValue(undefined),
    scrollUp: vi.fn().mockResolvedValue(undefined),
    scrollDown: vi.fn().mockResolvedValue(undefined),
    scrollLeft: vi.fn().mockResolvedValue(undefined),
    scrollRight: vi.fn().mockResolvedValue(undefined)
  };
  const keyboardMock = {
    pressKey: vi.fn().mockResolvedValue(undefined),
    releaseKey: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined)
  };
  const ButtonMock = { LEFT: 'left', RIGHT: 'right', MIDDLE: 'middle' };
  function PointMock(x: number, y: number) {
    return { x, y };
  }
  return { mouseMock, keyboardMock, ButtonMock, PointMock };
});

vi.mock('@nut-tree/nut-js', () => ({
  mouse: mouseMock,
  keyboard: keyboardMock,
  Button: ButtonMock,
  Point: PointMock
}));

// Mock the window helper so we can spy on activateWindow without
// touching koffi / Win32 APIs.
vi.mock('../src/main/window.js', () => ({
  activateWindow: vi.fn().mockResolvedValue(true),
  getForegroundWindow: vi.fn().mockResolvedValue(null),
  // v0.4.5: runner now calls getCurrentForegroundHwnd before each
  // step to verify focus didn't drift. Default mock returns the
  // targetHwnd so the runner's re-activation branch is NOT taken
  // (matches the existing v0.4.4 test expectations).
  getCurrentForegroundHwnd: vi.fn().mockReturnValue(0),
  enumVisibleWindows: vi.fn().mockResolvedValue([]),
  // v0.5-mini T2: simulator's executeInputStep wraps nut-js calls
  // in withAttachedInput(). Default mock just runs the inner fn
  // so legacy tests don't see any behavior change.
  withAttachedInput: vi.fn(async <T>(_hwnd: number, fn: () => Promise<T> | T) => fn()),
  attachInputToWindow: vi.fn().mockReturnValue({ release: () => {} }),
  getWindowThreadId: vi.fn().mockReturnValue(0)
}));

import { startRun, cancelRun, getActiveRun, awaitRun } from '../src/main/runner';
import { activateWindow } from '../src/main/window';
import type { Step, ProgressEvent } from '../src/shared/types';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SKIP_REAL_EXECUTION;
});

function makeSteps(): Step[] {
  return [
    { id: 's1', type: 'move', x: 10, y: 20 },
    { id: 's2', type: 'click', button: 'left' },
    { id: 's3', type: 'type', text: 'hi' }
  ];
}

describe('runner: startRun', () => {
  it('emits running/done progress for each step in order', async () => {
    const events: ProgressEvent[] = [];
    const ctx = startRun('r1', makeSteps(), (e) => events.push(e));
    await ctx.promise;

    const statusByStep = events
      .filter((e) => e.status === 'running' || e.status === 'done')
      .map((e) => [e.stepId, e.status]);

    expect(statusByStep).toEqual([
      ['s1', 'running'],
      ['s1', 'done'],
      ['s2', 'running'],
      ['s2', 'done'],
      ['s3', 'running'],
      ['s3', 'done']
    ]);
  });

  it('includes index/total in progress events', async () => {
    const events: ProgressEvent[] = [];
    const ctx = startRun('r2', makeSteps(), (e) => events.push(e));
    await ctx.promise;
    const first = events[0];
    expect(first).toMatchObject({ index: 0, total: 3, status: 'running' });
  });

  it('removes the active run entry after completion', async () => {
    const ctx = startRun('r3', makeSteps(), () => {});
    await ctx.promise;
    expect(getActiveRun('r3')).toBeUndefined();
  });
});

describe('runner: cancelRun', () => {
  it('cancels a running run via AbortController', async () => {
    // Use a delay step (which respects AbortSignal) so the cancel
    // has a chance to interrupt in-flight work.
    const slowSteps: Step[] = [
      { id: 's1', type: 'move', x: 10, y: 20 },
      { id: 's2', type: 'delay', ms: 500 },
      { id: 's3', type: 'click', button: 'left' }
    ];
    const events: ProgressEvent[] = [];
    const ctx = startRun('r4', slowSteps, (e) => events.push(e));

    // Wait until the first step finishes and the delay step starts.
    await new Promise((r) => setTimeout(r, 20));
    const ok = cancelRun('r4');
    expect(ok).toBe(true);
    await ctx.promise.catch(() => {});

    const errEvent = events.find((e) => e.status === 'error');
    expect(errEvent).toBeDefined();
    expect(errEvent?.message).toBe('cancelled');
    // the click after the delay should not have been invoked
    expect(mouseMock.click).not.toHaveBeenCalled();
  });

  it('returns false when runId is not active', () => {
    expect(cancelRun('does-not-exist')).toBe(false);
  });
});

describe('runner: error handling', () => {
  it('emits error progress and rethrows when a step throws', async () => {
    mouseMock.click.mockRejectedValueOnce(new Error('boom'));
    const events: ProgressEvent[] = [];
    const ctx = startRun('r5', makeSteps(), (e) => events.push(e));
    await ctx.promise.catch(() => {});

    const errEvent = events.find((e) => e.status === 'error');
    expect(errEvent).toBeDefined();
    expect(errEvent?.stepId).toBe('s2');
    expect(errEvent?.message).toBe('boom');
  });

  it('does not run later steps after an error', async () => {
    mouseMock.click.mockRejectedValueOnce(new Error('boom'));
    const ctx = startRun('r6', makeSteps(), () => {});
    await ctx.promise.catch(() => {});
    // type should never have been called because click failed
    expect(keyboardMock.type).not.toHaveBeenCalled();
  });
});

describe('runner: awaitRun', () => {
  it('resolves when the run finishes', async () => {
    startRun('r7', makeSteps(), () => {});
    await expect(awaitRun('r7')).resolves.toBeUndefined();
  });
});

describe('runner: targetHwnd', () => {
  it('calls activateWindow before executing steps when targetHwnd is set', async () => {
    (activateWindow as unknown as ReturnType<typeof vi.fn>).mockClear();
    const events: ProgressEvent[] = [];
    const ctx = startRun(
      'r8',
      [{ id: 's1', type: 'move', x: 1, y: 2 }],
      (e) => events.push(e),
      { targetHwnd: 12345, activateSettleMs: 0 }
    );
    await ctx.promise;
    expect(activateWindow).toHaveBeenCalledWith(12345);
    // the run should have completed normally
    expect(events.find((e) => e.status === 'done')).toBeDefined();
  });

  it('skips activateWindow when targetHwnd is not set', async () => {
    (activateWindow as unknown as ReturnType<typeof vi.fn>).mockClear();
    const ctx = startRun('r9', makeSteps(), () => {});
    await ctx.promise;
    expect(activateWindow).not.toHaveBeenCalled();
  });
});

describe('runner: looping step progress', () => {
  it('emits looping progress events with loopCount and is cancellable', async () => {
    const events: ProgressEvent[] = [];
    const steps: Step[] = [
      {
        id: 's1',
        type: 'keyTap',
        key: 'a',
        holdMs: 0,
        intervalMs: 1
      }
    ];
    const ctx = startRun('r10', steps, (e) => events.push(e), { activateSettleMs: 0 });
    // Schedule cancel after a short real-time window. We assert at
    // least 1 looping event was emitted (the initial cycle-1 tick)
    // and that cancellation fires.
    setTimeout(() => cancelRun('r10'), 25);
    await ctx.promise;
    const loopingEvents = events.filter((e) => e.status === 'looping');
    expect(loopingEvents.length).toBeGreaterThanOrEqual(1);
    // every looping event has a numeric loopCount
    for (const e of loopingEvents) {
      expect(typeof e.loopCount).toBe('number');
      expect(e.loopCount).toBeGreaterThan(0);
    }
    // and ultimately a cancelled error
    const err = events.find((e) => e.status === 'error');
    expect(err).toBeDefined();
  });

  it('cancels a looping run via cancelRun', async () => {
    const events: ProgressEvent[] = [];
    const steps: Step[] = [
      {
        id: 's1',
        type: 'keyTap',
        key: 'a',
        holdMs: 0,
        intervalMs: 5
      }
    ];
    const ctx = startRun('r11', steps, (e) => events.push(e), { activateSettleMs: 0 });
    // cancel after a short delay — the loop should still be running
    setTimeout(() => cancelRun('r11'), 8);
    await ctx.promise;
    // we should have at least one looping event
    const loopingEvents = events.filter((e) => e.status === 'looping');
    expect(loopingEvents.length).toBeGreaterThanOrEqual(1);
    // and ultimately a cancelled error
    const err = events.find((e) => e.status === 'error');
    expect(err).toBeDefined();
  });
});
