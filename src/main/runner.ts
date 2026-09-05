// Runner: orchestrates execution of a list of steps, exposing
// progress callbacks and a cancel hook via AbortController.

import type { Step, ProgressEvent, StepStatus } from '../shared/types.js';
import { executeStep } from './simulator.js';
import { activateWindow } from './window.js';

export type ProgressCallback = (e: ProgressEvent) => void;

export interface RunOptions {
  // When set, the runner will try to bring the target window to the
  // foreground before any step executes. 0 / null / undefined means
  // "do not switch focus".
  targetHwnd?: number | null;
  // Sleep window (ms) after activating the target window before
  // pressing keys. Gives the window a moment to actually receive
  // focus before we start sending input.
  activateSettleMs?: number;
}

export interface RunContext {
  runId: string;
  abortController: AbortController;
  promise: Promise<void>;
}

const activeRuns = new Map<string, RunContext>();

// How often (in completed press+release cycles) to emit a 'looping'
// progress event. 10 is a reasonable default — fast enough to keep
// the UI counter alive, slow enough to avoid IPC storm.
const LOOP_TICK_THROTTLE = 10;

export function getActiveRun(runId: string): RunContext | undefined {
  return activeRuns.get(runId);
}

export function cancelRun(runId: string): boolean {
  const ctx = activeRuns.get(runId);
  if (!ctx) return false;
  ctx.abortController.abort();
  return true;
}

function emit(
  runId: string,
  stepId: string,
  status: StepStatus,
  index: number,
  total: number,
  onProgress: ProgressCallback | undefined,
  extra?: { message?: string; loopCount?: number }
) {
  if (!onProgress) return;
  onProgress({
    runId,
    stepId,
    status,
    index,
    total,
    message: extra?.message,
    loopCount: extra?.loopCount
  });
}

/**
 * Start running the given steps. Returns the in-flight RunContext so
 * the caller can await completion or cancel it.
 *
 * `options.targetHwnd` switches focus to a foreign window before
 * executing. `options.activateSettleMs` controls the post-activate
 * sleep (default 100ms).
 */
export function startRun(
  runId: string,
  steps: Step[],
  onProgress?: ProgressCallback,
  options: RunOptions = {}
): RunContext {
  // Reuse the existing AbortController if a run with this id is already
  // active, otherwise create a new one.
  let ctx = activeRuns.get(runId);
  if (ctx) {
    ctx.abortController.abort();
    activeRuns.delete(runId);
  }

  const abortController = new AbortController();
  const total = steps.length;
  const targetHwnd = options.targetHwnd ?? null;
  const settleMs = options.activateSettleMs ?? 100;

  const promise = (async () => {
    // Activate target window up front, before any step fires.
    if (targetHwnd && targetHwnd > 0) {
      try {
        await activateWindow(targetHwnd);
      } catch (err) {
        console.error('[runner] activateWindow failed:', err);
      }
      if (settleMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, settleMs));
      }
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (abortController.signal.aborted) {
        emit(runId, step.id, 'error', i, total, onProgress, { message: 'cancelled' });
        throw new Error('cancelled');
      }
      emit(runId, step.id, 'running', i, total, onProgress);

      // Throttle the 'looping' tick: only emit every Nth cycle to
      // avoid flooding IPC. The counter is internal; we don't surface
      // missed ticks.
      let lastEmittedCount = 0;
      const onLoopTick = (count: number) => {
        if (count - lastEmittedCount >= LOOP_TICK_THROTTLE || count === 1) {
          lastEmittedCount = count;
          emit(runId, step.id, 'looping', i, total, onProgress, { loopCount: count });
        }
      };

      try {
        await executeStep(step, abortController.signal, onLoopTick);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit(runId, step.id, 'error', i, total, onProgress, { message });
        throw err;
      }
      emit(runId, step.id, 'done', i, total, onProgress);
    }
  })()
    .catch((err) => {
      // surface through console; main process logs already capture it
      console.error(`[runner] run ${runId} failed:`, err);
    })
    .finally(() => {
      // keep the entry briefly so callers can detect the end; delete immediately
      activeRuns.delete(runId);
    });

  ctx = { runId, abortController, promise };
  activeRuns.set(runId, ctx);
  return ctx;
}

export async function awaitRun(runId: string): Promise<void> {
  const ctx = activeRuns.get(runId);
  if (!ctx) return;
  await ctx.promise;
}
