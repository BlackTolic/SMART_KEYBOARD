import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks must be hoisted before any import statement that loads
// @nut-tree/nut-js. vi.hoisted() guarantees the variable
// initialization runs first, even though vi.mock() factory is
// also hoisted.
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

// Now we can import the simulator safely.
import { executeStep, executeSteps } from '../src/main/simulator';
import type { Step } from '../src/shared/types';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SKIP_REAL_EXECUTION;
});

describe('simulator: executeStep', () => {
  it('moves the mouse to x,y', async () => {
    const step: Step = { id: '1', type: 'move', x: 100, y: 200 };
    await executeStep(step);
    expect(mouseMock.setPosition).toHaveBeenCalledTimes(1);
    const arg = mouseMock.setPosition.mock.calls[0][0];
    expect(arg).toMatchObject({ x: 100, y: 200 });
  });

  it('clicks the left button', async () => {
    const step: Step = { id: '1', type: 'click', button: 'left' };
    await executeStep(step);
    expect(mouseMock.click).toHaveBeenCalledWith('left');
  });

  it('clicks the right button', async () => {
    const step: Step = { id: '1', type: 'click', button: 'right' };
    await executeStep(step);
    expect(mouseMock.click).toHaveBeenCalledWith('right');
  });

  it('clicks the middle button', async () => {
    const step: Step = { id: '1', type: 'click', button: 'middle' };
    await executeStep(step);
    expect(mouseMock.click).toHaveBeenCalledWith('middle');
  });

  it('double-clicks the left button', async () => {
    const step: Step = { id: '1', type: 'doubleClick' };
    await executeStep(step);
    expect(mouseMock.doubleClick).toHaveBeenCalledWith('left');
  });

  it('scrolls negative dy → down, positive dx → right', async () => {
    const step: Step = { id: '1', type: 'scroll', dx: 2, dy: -3 };
    await executeStep(step);
    expect(mouseMock.scrollDown).toHaveBeenCalledWith(3);
    expect(mouseMock.scrollUp).toHaveBeenCalledTimes(0);
    expect(mouseMock.scrollRight).toHaveBeenCalledWith(2);
  });

  it('scrolls positive dy', async () => {
    const step: Step = { id: '1', type: 'scroll', dx: 0, dy: 5 };
    await executeStep(step);
    expect(mouseMock.scrollUp).toHaveBeenCalledWith(5);
    expect(mouseMock.scrollDown).not.toHaveBeenCalled();
  });

  it('keyTap with no modifiers', async () => {
    const step: Step = { id: '1', type: 'keyTap', key: 'Enter' };
    await executeStep(step);
    expect(keyboardMock.pressKey).toHaveBeenCalledWith(expect.objectContaining({}));
    // confirm at least one call was made with the key (any value)
    const calls = keyboardMock.pressKey.mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0].length).toBe(1);
    // v0.2: bug fix — always release, even with default holdMs
    expect(keyboardMock.releaseKey).toHaveBeenCalledTimes(1);
  });

  it('keyTap with ctrl+shift', async () => {
    const step: Step = {
      id: '1',
      type: 'keyTap',
      key: 'a',
      modifiers: ['ctrl', 'shift']
    };
    await executeStep(step);
    expect(keyboardMock.pressKey).toHaveBeenCalledTimes(1);
    // 2 modifiers + 1 key = 3 arguments
    expect(keyboardMock.pressKey.mock.calls[0].length).toBe(3);
    // v0.2: bug fix — release main + 2 modifiers = 3 calls
    expect(keyboardMock.releaseKey).toHaveBeenCalledTimes(3);
  });

  it('type with holdMs=0 sends text to keyboard.type', async () => {
    // v0.2: holdMs defaults to 50 (per-char), so to use the fast
    // bulk-type path you must set holdMs: 0 explicitly.
    const step: Step = { id: '1', type: 'type', text: 'hello world', holdMs: 0 };
    await executeStep(step);
    expect(keyboardMock.type).toHaveBeenCalledWith('hello world');
  });

  it('delay resolves', async () => {
    const step: Step = { id: '1', type: 'delay', ms: 5 };
    await executeStep(step);
    expect(true).toBe(true);
  });

  it('post-step delayMs waits via timer', async () => {
    vi.useFakeTimers();
    const step: Step = { id: '1', type: 'click', button: 'left', delayMs: 1000 };
    const p = executeStep(step);
    await vi.runAllTimersAsync();
    await p;
    expect(mouseMock.click).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('throws on unknown step type', async () => {
    const fake = { id: '1', type: 'mystery' } as unknown as Step;
    await expect(executeStep(fake)).rejects.toThrow(/unknown step type/);
  });

  it('throws cancelled when signal is already aborted', async () => {
    const step: Step = { id: '1', type: 'click', button: 'left' };
    const ac = new AbortController();
    ac.abort();
    await expect(executeStep(step, ac.signal)).rejects.toThrow('cancelled');
    expect(mouseMock.click).not.toHaveBeenCalled();
  });
});

describe('simulator: keyTap with holdMs', () => {
  it('keyTap without holdMs uses default 50ms and explicitly releases', async () => {
    // Force real-execution path; otherwise holdMs is logged but not
    // applied. We verify behavior via the mock counter.
    delete process.env.SKIP_REAL_EXECUTION;
    const step: Step = { id: '1', type: 'keyTap', key: 'a' };
    await executeStep(step);
    expect(keyboardMock.pressKey).toHaveBeenCalledTimes(1);
    // v0.2: always release, even with default holdMs
    expect(keyboardMock.releaseKey).toHaveBeenCalledTimes(1);
  });

  it('keyTap with holdMs=0 still releases (no-hold tap)', async () => {
    const step: Step = { id: '1', type: 'keyTap', key: 'Enter', holdMs: 0 };
    await executeStep(step);
    expect(keyboardMock.pressKey).toHaveBeenCalledTimes(1);
    expect(keyboardMock.releaseKey).toHaveBeenCalledTimes(1);
  });

  it('keyTap with holdMs=20 calls press → sleep → release in that order', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    keyboardMock.pressKey.mockImplementation(async () => {
      order.push('press');
    });
    // The sleep is the timer inside simulator; we resolve it on demand.
    keyboardMock.releaseKey.mockImplementation(async () => {
      order.push('release');
    });
    const step: Step = { id: '1', type: 'keyTap', key: 'b', holdMs: 20 };
    const p = executeStep(step);
    // Let press complete
    await Promise.resolve();
    await Promise.resolve();
    // Advance the hold timer
    await vi.advanceTimersByTimeAsync(20);
    await p;
    expect(order[0]).toBe('press');
    expect(order[order.length - 1]).toBe('release');
    expect(keyboardMock.releaseKey).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('keyTap with holdMs and ctrl modifier releases the modifier too', async () => {
    const step: Step = {
      id: '1',
      type: 'keyTap',
      key: 'a',
      modifiers: ['ctrl'],
      holdMs: 10
    };
    vi.useFakeTimers();
    const p = executeStep(step);
    await vi.advanceTimersByTimeAsync(10);
    await p;
    expect(keyboardMock.pressKey).toHaveBeenCalledTimes(1);
    // 1 release for the main key + 1 for ctrl = 2
    expect(keyboardMock.releaseKey).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('simulator: keyTap looping (intervalMs > 0)', () => {
  it('loops press+release until AbortSignal is fired', async () => {
    let pressCount = 0;
    keyboardMock.pressKey.mockImplementation(async () => {
      pressCount += 1;
    });
    const ac = new AbortController();
    const step: Step = {
      id: 'loop1',
      type: 'keyTap',
      key: 'Space',
      holdMs: 5,
      intervalMs: 5
    };
    // start the loop, then abort after 3 cycles
    const p = executeStep(step, ac.signal, (count) => {
      if (count >= 3) ac.abort();
    });
    await p.catch(() => {});
    expect(pressCount).toBeGreaterThanOrEqual(3);
    // aborted → throws
    await expect(executeStep(step, ac.signal)).rejects.toThrow('cancelled');
  });

  it('invokes onLoopTick on every completed cycle', async () => {
    const counts: number[] = [];
    const ac = new AbortController();
    const step: Step = {
      id: 'loop2',
      type: 'keyTap',
      key: 'a',
      holdMs: 0,
      intervalMs: 1
    };
    const p = executeStep(step, ac.signal, (c) => {
      counts.push(c);
      if (c >= 5) ac.abort();
    });
    await p.catch(() => {});
    expect(counts).toContain(5);
    // monotonic increasing
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1]!);
    }
  });
});

describe('simulator: type with intervalMs loops the full text', () => {
  it('invokes keyboard.type repeatedly until aborted', async () => {
    const ac = new AbortController();
    let calls = 0;
    keyboardMock.type.mockImplementation(async () => {
      calls += 1;
    });
    const step: Step = {
      id: 'typeLoop',
      type: 'type',
      text: 'abc',
      holdMs: 0,
      intervalMs: 1
    };
    const p = executeStep(step, ac.signal, (c) => {
      if (c >= 4) ac.abort();
    });
    await p.catch(() => {});
    expect(calls).toBeGreaterThanOrEqual(4);
  });
});

describe('simulator: executeSteps', () => {
  it('runs steps in order', async () => {
    const order: string[] = [];
    mouseMock.setPosition.mockImplementation(async () => {
      order.push('move');
    });
    mouseMock.click.mockImplementation(async () => {
      order.push('click');
    });
    keyboardMock.type.mockImplementation(async () => {
      order.push('type');
    });

    const steps: Step[] = [
      { id: '1', type: 'move', x: 1, y: 1 },
      { id: '2', type: 'click', button: 'left' },
      { id: '3', type: 'type', text: 'x', holdMs: 0 }
    ];
    await executeSteps(steps);
    expect(order).toEqual(['move', 'click', 'type']);
  });

  it('throws cancelled when aborted before next step', async () => {
    const ac = new AbortController();
    const order: string[] = [];
    mouseMock.setPosition.mockImplementation(async () => {
      order.push('move');
    });
    mouseMock.click.mockImplementation(async () => {
      order.push('click');
    });
    const steps: Step[] = [
      { id: '1', type: 'move', x: 1, y: 1 },
      { id: '2', type: 'click', button: 'left' }
    ];
    ac.abort();
    await expect(executeSteps(steps, ac.signal)).rejects.toThrow('cancelled');
    // first step should be skipped because we check at the top of the loop
    expect(order).toEqual([]);
  });
});
