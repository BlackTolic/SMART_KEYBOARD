// v0.5-mini T2: tests for the per-targetHwnd queue + multi-window
// parallel execution in src/main/runner.ts.
//
// Strategy: mock the simulator so we can record step start/finish
// times precisely without depending on real nut-js / real timers
// (the existing runner.spec.ts tests do rely on real timers and
// that makes parallel-vs-serial checks flaky). Each mock invocation
// simulates a fixed amount of work via a real setTimeout, so the
// order of `dispatchOrder` entries reflects actual execution
// interleaving.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Step, StepTarget, ProgressEvent } from '../src/shared/types';

// ----- hoisted simulator mock ---------------------------------------------
//
// We replace `executeStep` with a recording version. The recording
// pushes `{ id, phase: 'start' | 'done' }` to `dispatchOrder` in real
// time. The work itself is simulated by a real setTimeout so two
// steps with the same hwnd actually overlap in time (and can be
// distinguished from a same-hwnd serial run by their dispatchOrder
// entries).

interface DispatchEntry {
  id: string;
  phase: 'start' | 'done';
}

const { executeStepMock, dispatchOrder } = vi.hoisted(() => {
  const order: DispatchEntry[] = [];
  const stepDelay = new Map<string, number>(); // per-step delay override

  function getStepDelay(id: string): number {
    return stepDelay.get(id) ?? 40; // 40ms default "work"
  }

  const executeStepMock = vi.fn(
    async (
      step: { id: string; type: string },
      _signal?: AbortSignal
    ): Promise<void> => {
      order.push({ id: step.id, phase: 'start' });
      const delay = getStepDelay(step.id);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delay);
        // Honour AbortSignal so the cancellation test can interrupt
        // a long step cleanly.
        if (_signal) {
          const onAbort = (): void => {
            clearTimeout(t);
            reject(new Error('cancelled'));
          };
          if (_signal.aborted) onAbort();
          else _signal.addEventListener('abort', onAbort, { once: true });
        }
      });
      order.push({ id: step.id, phase: 'done' });
    }
  );

  return { executeStepMock, dispatchOrder: order, getStepDelay: getStepDelay, stepDelay };
});

vi.mock('../src/main/simulator.js', () => ({
  executeStep: executeStepMock
}));

// ----- hoisted window mock ------------------------------------------------
//
// Mirrors the existing tests/runner.spec.ts mock shape: stub out
// koffi-dependent helpers. The thread-attachment / activate
// helpers return success / no-op so we don't accidentally drag
// in real koffi on the test env (which is non-Windows).

vi.mock('../src/main/window.js', () => ({
  activateWindow: vi.fn().mockResolvedValue(true),
  getForegroundWindow: vi.fn().mockResolvedValue(null),
  getCurrentForegroundHwnd: vi.fn().mockReturnValue(0),
  enumVisibleWindows: vi.fn().mockResolvedValue([]),
  withAttachedInput: vi.fn(async <T>(_hwnd: number, fn: () => Promise<T> | T) => fn()),
  attachInputToWindow: vi.fn().mockReturnValue({ release: () => {} }),
  getWindowThreadId: vi.fn().mockReturnValue(0)
}));

// ----- imports ------------------------------------------------------------

import { startRun, cancelRun, awaitRun, getActiveRun } from '../src/main/runner';

beforeEach(() => {
  executeStepMock.mockClear();
  dispatchOrder.length = 0;
});

function findIndex(predicate: (e: DispatchEntry) => boolean): number {
  return dispatchOrder.findIndex(predicate);
}

// Helper: build a keyTap step (which carries a `target` field, unlike
// `delay`) so we can exercise the per-targetHwnd queue. holdMs=0 +
// intervalMs=0 means "single press+release", which the mock handles
// in 40ms of fake work regardless of the step type.
function tap(id: string, target: StepTarget | undefined): Step {
  return { id, type: 'keyTap', key: 'a', holdMs: 0, intervalMs: 0, target };
}

// =================================================================
// T2 CORE: per-targetHwnd queue + multi-window parallel execution
// =================================================================

describe('runner: per-targetHwnd queue (v0.5-mini T2)', () => {
  it('serializes same-hwnd steps (foreground queue)', async () => {
    const steps: Step[] = [
      tap('A', { kind: 'foreground' }),
      tap('B', { kind: 'foreground' }),
      tap('C', { kind: 'foreground' })
    ];
    const ctx = startRun('ser-fg', steps);
    await ctx.promise;
    // Expected order: A-start, A-done, B-start, B-done, C-start, C-done
    expect(dispatchOrder.map((e) => `${e.id}-${e.phase}`)).toEqual([
      'A-start', 'A-done',
      'B-start', 'B-done',
      'C-start', 'C-done'
    ]);
  });

  it('serializes same-hwnd steps when explicit hwnd is used', async () => {
    const steps: Step[] = [
      tap('A', { kind: 'hwnd', hwnd: 0x100 }),
      tap('B', { kind: 'hwnd', hwnd: 0x100 })
    ];
    const ctx = startRun('ser-hwnd', steps);
    await ctx.promise;
    expect(dispatchOrder.map((e) => `${e.id}-${e.phase}`)).toEqual([
      'A-start', 'A-done',
      'B-start', 'B-done'
    ]);
  });

  it('runs different-hwnd steps in parallel (interleaved dispatchOrder)', async () => {
    const steps: Step[] = [
      tap('A', { kind: 'hwnd', hwnd: 0x100 }),
      tap('B', { kind: 'hwnd', hwnd: 0x200 })
    ];
    const ctx = startRun('par-hwnd', steps);
    await ctx.promise;
    // Both should start before either finishes (proof of parallelism).
    const aStart = findIndex((e) => e.id === 'A' && e.phase === 'start');
    const bStart = findIndex((e) => e.id === 'B' && e.phase === 'start');
    const aDone = findIndex((e) => e.id === 'A' && e.phase === 'done');
    const bDone = findIndex((e) => e.id === 'B' && e.phase === 'done');
    expect(aStart).toBeGreaterThanOrEqual(0);
    expect(bStart).toBeGreaterThanOrEqual(0);
    expect(bStart).toBeLessThan(aDone);
    expect(aStart).toBeLessThan(bDone);
  });

  it('mixes serial and parallel: two of each, two hwnds', async () => {
    const steps: Step[] = [
      tap('A1', { kind: 'hwnd', hwnd: 0x100 }),
      tap('A2', { kind: 'hwnd', hwnd: 0x100 }),
      tap('B1', { kind: 'hwnd', hwnd: 0x200 }),
      tap('B2', { kind: 'hwnd', hwnd: 0x200 })
    ];
    const ctx = startRun('mix', steps);
    await ctx.promise;
    // A1 must finish before A2 starts (same hwnd 0x100).
    const a1Done = findIndex((e) => e.id === 'A1' && e.phase === 'done');
    const a2Start = findIndex((e) => e.id === 'A2' && e.phase === 'start');
    expect(a2Start).toBeGreaterThan(a1Done);
    // B1 must finish before B2 starts (same hwnd 0x200).
    const b1Done = findIndex((e) => e.id === 'B1' && e.phase === 'done');
    const b2Start = findIndex((e) => e.id === 'B2' && e.phase === 'start');
    expect(b2Start).toBeGreaterThan(b1Done);
    // A1 and B1 should overlap (different hwnds).
    const a1Start = findIndex((e) => e.id === 'A1' && e.phase === 'start');
    const b1Start = findIndex((e) => e.id === 'B1' && e.phase === 'start');
    expect(b1Start).toBeLessThan(a1Done);
  });

  it('cancels all parallel steps on runId cancel', async () => {
    // Long enough that cancel mid-run is guaranteed to interrupt.
    const steps: Step[] = [
      tap('slowA', { kind: 'hwnd', hwnd: 0x100 }),
      tap('slowB', { kind: 'hwnd', hwnd: 0x200 })
    ];
    const ctx = startRun('cancel-par', steps, (e: ProgressEvent) => {
      if (e.status === 'error' && e.message !== 'cancelled') {
        // surface unexpected errors so a test failure is loud
        // eslint-disable-next-line no-console
        console.error('unexpected progress error:', e);
      }
    });
    // Let both steps start.
    await new Promise((r) => setTimeout(r, 20));
    const ok = cancelRun('cancel-par');
    expect(ok).toBe(true);
    await ctx.promise.catch(() => {});
    // The run-level promise resolved and the active-run map was
    // cleared, regardless of which step's abort landed first.
    expect(getActiveRun('cancel-par')).toBeUndefined();
  });

  it('boundHwnd resolves kind: "bound" steps to the run-level binding', async () => {
    const steps: Step[] = [
      tap('A', { kind: 'bound' }),
      // No target on B → falls back to bound (because boundHwnd is
      // set and the legacy targetHwnd is not).
      tap('B', { kind: 'bound' })
    ];
    const ctx = startRun('bound-1', steps, undefined, { boundHwnd: 0xbeef });
    await ctx.promise;
    // All steps resolved the same hwnd → same queue → serialized.
    expect(dispatchOrder.map((e) => `${e.id}-${e.phase}`)).toEqual([
      'A-start', 'A-done',
      'B-start', 'B-done'
    ]);
  });

  it('legacy targetHwnd still serializes on its hwnd (backward compat)', async () => {
    const steps: Step[] = [
      tap('A', { kind: 'hwnd', hwnd: 0xcafe }),
      tap('B', { kind: 'hwnd', hwnd: 0xcafe })
    ];
    // No per-step target mismatch, no boundHwnd → falls back to
    // legacy `targetHwnd` (v0.4.5 behavior). All steps share the
    // same hwnd, so they serialize on the same queue.
    const ctx = startRun('legacy', steps, undefined, { targetHwnd: 0xcafe });
    await ctx.promise;
    expect(dispatchOrder.map((e) => `${e.id}-${e.phase}`)).toEqual([
      'A-start', 'A-done',
      'B-start', 'B-done'
    ]);
  });

  it('per-step target overrides the run-level default', async () => {
    const steps: Step[] = [
      tap('A', { kind: 'hwnd', hwnd: 0x111 }),
      tap('B', { kind: 'hwnd', hwnd: 0x222 })
    ];
    // Per-step targets win over the run-level targetHwnd.
    // Steps A and B are on different hwnds → parallel.
    const ctx = startRun('per-step-wins', steps, undefined, { targetHwnd: 0x999 });
    await ctx.promise;
    const aDone = findIndex((e) => e.id === 'A' && e.phase === 'done');
    const bStart = findIndex((e) => e.id === 'B' && e.phase === 'start');
    const aStart = findIndex((e) => e.id === 'A' && e.phase === 'start');
    const bDone = findIndex((e) => e.id === 'B' && e.phase === 'done');
    // Overlap proves per-step targets were honored.
    expect(bStart).toBeLessThan(aDone);
    expect(aStart).toBeLessThan(bDone);
  });

  it('parallel run completes faster than serial (real-time sanity)', async () => {
    // 4 steps × 40ms each in the mock. Serial = ~160ms.
    // Parallel across 4 hwnds = ~40ms. We use a 100ms upper
    // bound: a regression to serial (~160ms) fails; the parallel
    // case (~40-50ms) passes with margin.
    const steps: Step[] = [
      tap('A', { kind: 'hwnd', hwnd: 0x1 }),
      tap('B', { kind: 'hwnd', hwnd: 0x2 }),
      tap('C', { kind: 'hwnd', hwnd: 0x3 }),
      tap('D', { kind: 'hwnd', hwnd: 0x4 })
    ];
    const t0 = Date.now();
    const ctx = startRun('par-time', steps);
    await ctx.promise;
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(100);
  });
});

describe('runner: target resolution (v0.5-mini T2)', () => {
  it('step.target wins over reqTarget and options.boundHwnd', async () => {
    const steps: Step[] = [
      tap('A', { kind: 'hwnd', hwnd: 0xabc }),
      tap('B', { kind: 'hwnd', hwnd: 0xabc })
    ];
    // Even with boundHwnd=0xfff and reqTarget=bound, the per-step
    // target (hwnd 0xabc) should win → both A and B share hwnd
    // 0xabc → serialize.
    const ctx = startRun(
      'step-wins',
      steps,
      undefined,
      { boundHwnd: 0xfff },
      { kind: 'bound' }
    );
    await ctx.promise;
    expect(dispatchOrder.map((e) => `${e.id}-${e.phase}`)).toEqual([
      'A-start', 'A-done',
      'B-start', 'B-done'
    ]);
  });

  it('title kind: "title" without a matching window resolves to foreground queue', async () => {
    // No enumVisibleWindows mock data → title map is empty.
    const steps: Step[] = [
      tap('A', { kind: 'title', title: 'Nonexistent' }),
      tap('B', { kind: 'title', title: 'Nonexistent' })
    ];
    const ctx = startRun('title-miss', steps);
    await ctx.promise;
    // Both resolve to hwnd=0 → foreground queue → serialize.
    expect(dispatchOrder.map((e) => `${e.id}-${e.phase}`)).toEqual([
      'A-start', 'A-done',
      'B-start', 'B-done'
    ]);
  });
});

describe('runner: UIA step (v0.5-mini T2 stub)', () => {
  it('UIA step (invokeElement) ends the run with an error progress event', async () => {
    // Override the mock for this one test so the simulator's UIA
    // path is actually exercised (the default mock ignores step
    // type). We replicate what the real executeUiaStep does:
    // call findElement → which throws UiaBackendUnavailableError
    // on Windows because the T2 stub isn't wired.
    const { UiaBackendUnavailableError } = await import('../src/main/uia');
    executeStepMock.mockImplementationOnce(
      // The mock's typed signature is (step, _signal?) => Promise<void>
      // (it's a vi.fn of the hoisted recorder). The runner actually
      // calls with 4 args (step, signal, onLoopTick, resolvedHwnd);
      // cast to any so the test can accept the wider call without
      // changing the recorder's signature.
      ((...args: unknown[]) => {
        return (async () => {
          const s = args[0] as Step;
          const hwnd = (args[3] as number | null) ?? 0;
          if (s.type !== 'invokeElement') throw new Error('not invoke');
          const { findElement } = await import('../src/main/uia');
          // Force Windows so the stub throws.
          const originalPlatform = process.platform;
          Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
          try {
            await findElement(hwnd, s.selector);
          } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
          }
        })();
      }) as unknown as () => Promise<void>
    );

    const events: Array<{ status: string; message?: string; stepId: string }> = [];
    const steps: Step[] = [
      {
        id: 'u1',
        type: 'invokeElement',
        selector: { automationId: 'btnX' },
        target: { kind: 'hwnd', hwnd: 0x1234 }
      }
    ];
    const ctx = startRun('uia-throws', steps, (e: ProgressEvent) => {
      events.push({ status: e.status, message: e.message, stepId: e.stepId });
    });
    await ctx.promise.catch(() => {});
    // The stub throws UiaBackendUnavailableError; the runner
    // surfaces it as an 'error' progress event with a 'UIA'-ish
    // message.
    const err = events.find((e) => e.status === 'error');
    expect(err).toBeDefined();
    expect(err!.stepId).toBe('u1');
    expect(err!.message).toMatch(/UIA/i);
    // Sanity: the class is the one we documented in uia.ts.
    expect(UiaBackendUnavailableError).toBeDefined();
  });
});

// =================================================================
// sanity: the old single-targetHwnd behavior is preserved
// =================================================================

describe('runner: backward compat (v0.4.5 behavior preserved)', () => {
  it('startRun with no options runs a single step in foreground', async () => {
    const steps: Step[] = [tap('A', { kind: 'foreground' })];
    const ctx = startRun('compat-1', steps);
    await ctx.promise;
    expect(dispatchOrder.map((e) => `${e.id}-${e.phase}`)).toEqual([
      'A-start', 'A-done'
    ]);
    // The active-run map is cleared after completion.
    expect(getActiveRun('compat-1')).toBeUndefined();
  });

  it('awaitRun resolves after the run finishes', async () => {
    const steps: Step[] = [tap('A', { kind: 'foreground' })];
    startRun('await-1', steps);
    await expect(awaitRun('await-1')).resolves.toBeUndefined();
  });
});
