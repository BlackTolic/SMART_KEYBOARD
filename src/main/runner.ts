// Runner: orchestrates execution of a list of steps, exposing
// progress callbacks and a cancel hook via AbortController.
//
// v0.5-mini T2: per-targetHwnd queue + multi-window parallel execution.
//
//   * Each step carries its own `target` (StepTarget) — see
//     shared/types.ts. The runner resolves the target to a concrete
//     hwnd at dispatch time and dispatches the step onto a
//     per-hwnd queue.
//   * Steps targeting the SAME hwnd run serially (so a key tap + a
//     type + a click land in order, even if the user scheduled
//     them all in one run).
//   * Steps targeting DIFFERENT hwnds run in parallel via
//     Promise.all — this is the "drive a foreground window while
//     also clicking a bound background window" capability the
//     v0.4.x single-targetHwnd model could not express.
//   * Cancelling a runId aborts the shared AbortController, which
//     tears down every in-flight step regardless of hwnd.
//
// Backward compatibility:
//   * `options.targetHwnd` (v0.4.5) still triggers SetForegroundWindow
//     on the run's first step and is used as the default hwnd when
//     no `boundHwnd` is supplied AND no per-step `target` is set.
//   * `options.boundHwnd` (T2) is the new explicit run-level
//     binding. When set, it wins over `targetHwnd` for the default
//     step target.
//   * Per-step `target` always wins over both.

import type {
  Step,
  StepTarget,
  ProgressEvent,
  StepStatus
} from '../shared/types.js';
import { executeStep } from './simulator.js';
import {
  activateWindow,
  getCurrentForegroundHwnd,
  enumVisibleWindows
} from './window.js';

export type ProgressCallback = (e: ProgressEvent) => void;

export interface RunOptions {
  // v0.4.5: When set, the runner brings this window to the foreground
  // before executing steps (legacy behavior). Also acts as the
  // default hwnd for steps without an explicit `target`, when no
  // `boundHwnd` is provided. Skipped on non-Windows or if 0.
  targetHwnd?: number | null;
  // v0.5-mini T2: explicit run-level "binding" hwnd. When set, steps
  // whose `target` is `{ kind: 'bound' }` (or steps that have no
  // `target`) resolve to this hwnd. Distinct from `targetHwnd` so
  // the renderer can pass a "binding" without forcing the runner to
  // call SetForegroundWindow on it.
  boundHwnd?: number;
  // Sleep window (ms) after activating the target window before
  // pressing keys.
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

// ----- per-hwnd queue ------------------------------------------------------
//
// FIFO serialization keyed on the resolved target hwnd. The
// "foreground" sentinel is for steps that resolved to a non-positive
// hwnd (e.g. explicit `kind: 'foreground'` with no current FG, or a
// misconfigured `kind: 'hwnd', hwnd: 0`). They share a single queue
// so they never race.
//
// State per key:
//   holder:  resolver to call when the current holder releases. null
//            means no one is currently in the slot.
//   waiters: FIFO array of resolvers for acquirers that arrived
//            while the slot was occupied.

type QueueKey = number | 'foreground';

interface QueueEntry {
  holder: (() => void) | null;
  waiters: Array<() => void>;
}

interface Slot {
  wait: Promise<void>;
  release: () => void;
}

const perHwndQueue = new Map<QueueKey, QueueEntry>();

/**
 * Block until the slot for `key` is available, then return a
 * handle whose `wait` promise resolves when the slot is granted
 * and whose `release` function gives the slot to the next waiter
 * (or clears the entry if there are none). The caller MUST await
 * `slot.wait` and call `slot.release` inside a `try/finally`, so
 * a thrown step doesn't strand subsequent waiters.
 *
 * FIFO semantics: waiters are kept in arrival order. The first
 * waiter becomes the new holder when the previous holder releases.
 *
 * 中文注释：这是 v0.5-mini T2 的"按 hwnd 排队"机制。
 *   同一个 hwnd 上的所有 step 必须串行执行（保证键鼠消息按顺序到达）。
 *   不同 hwnd 上的 step 走不同的 queue key，互不阻塞 → 并行执行。
 *   典型用例：用户在 SmartKeyboard 里编辑了一个 run，第一步把鼠标
 *   移到 A 窗口的某个按钮，第二步在 B 窗口（已绑定的后台窗口）里敲 F5。
 *   旧版本（v0.4）只能单窗口串行；T2 之后 A/B 窗口可以并行。
 */
function acquireQueueSlot(key: QueueKey): Slot {
  let entry = perHwndQueue.get(key);
  if (!entry) {
    entry = { holder: null, waiters: [] };
    perHwndQueue.set(key, entry);
  }
  let resolveWait!: () => void;
  const wait = new Promise<void>((resolve) => {
    resolveWait = resolve;
  });
  if (entry.holder === null) {
    // Slot is free — grant immediately. The awaiter proceeds on
    // the next microtask (the resolve below is synchronous from
    // the awaiter's perspective).
    entry.holder = resolveWait;
    resolveWait();
  } else {
    // Slot is held — become a waiter. The previous holder's
    // release() will call our resolveWait, which unblocks our
    // awaiter.
    entry.waiters.push(resolveWait);
  }
  return {
    wait,
    release: () => {
      const e = perHwndQueue.get(key);
      if (!e) return;
      // The current holder's `resolveWait` was already called
      // when it became the holder (see the `if (entry.holder === null)`
      // branch above for the first acquirer, and the promotion
      // logic here for subsequent holders). Calling it again is
      // a no-op (Promise resolvers are idempotent), so we just
      // promote the next waiter to the new holder and resolve
      // THEIR promise to unblock their `await slot.wait`.
      if (e.waiters.length > 0) {
        const next = e.waiters.shift()!;
        e.holder = next;
        next();
      } else {
        e.holder = null;
        perHwndQueue.delete(key);
      }
    }
  };
}

/**
 * Test-only: snapshot of the current per-hwnd queue. Used by
 * runner-parallel.spec.ts to assert "step B was queued behind
 * step A on hwnd 100" without poking at internals.
 */
export function __getPerHwndQueueSnapshot(): Array<{
  key: QueueKey;
  waiters: number;
  hasHolder: boolean;
}> {
  return [...perHwndQueue.entries()].map(([key, entry]) => ({
    key,
    waiters: entry.waiters.length,
    hasHolder: entry.holder !== null
  }));
}

// ----- target resolution ---------------------------------------------------

/**
 * Compute the default StepTarget for a step that didn't set its own
 * `target`. Precedence (T2):
 *   1. `reqTarget` (run-level) if the caller passed one through.
 *   2. `boundHwnd` → `{ kind: 'bound' }` (the renderer's binding).
 *   3. `targetHwnd` (v0.4 legacy) → `{ kind: 'hwnd', hwnd }`.
 *   4. `{ kind: 'foreground' }` (use the current foreground at
 *      dispatch time).
 */
function getDefaultStepTarget(
  reqTarget: StepTarget | undefined,
  boundHwnd: number,
  targetHwnd: number | null
): StepTarget {
  if (reqTarget) return reqTarget;
  if (boundHwnd > 0) return { kind: 'bound' };
  if (targetHwnd && targetHwnd > 0) return { kind: 'hwnd', hwnd: targetHwnd };
  return { kind: 'foreground' };
}

/**
 * Return the per-step `target`, or `undefined` for the `delay` step
 * (which by design has no target field). Centralised so the
 * resolver doesn't have to know the discriminated-union shape.
 */
function getStepTarget(step: Step): StepTarget | undefined {
  if (step.type === 'delay') return undefined;
  return (step as { target?: StepTarget }).target;
}

/**
 * Resolve a step's target to a concrete hwnd. `0` means "no
 * resolvable hwnd" (the step will land in the 'foreground' queue
 * with no real window attached). Title resolution uses the
 * pre-fetched `titleMap` — the runner calls `enumVisibleWindows()`
 * once at the start of the run if any step needs it.
 */
function resolveStepHwnd(
  step: Step,
  reqTarget: StepTarget | undefined,
  boundHwnd: number,
  targetHwnd: number | null,
  titleMap: ReadonlyMap<number, string>,
  foregroundHwnd: number
): number {
  const target = getStepTarget(step) ?? getDefaultStepTarget(reqTarget, boundHwnd, targetHwnd);
  switch (target.kind) {
    case 'foreground':
      return foregroundHwnd;
    case 'bound':
      return boundHwnd;
    case 'hwnd':
      return target.hwnd;
    case 'title': {
      for (const [h, title] of titleMap) {
        if (title === target.title) return h;
      }
      return 0;
    }
  }
}

// ----- startRun ------------------------------------------------------------

/**
 * Start running the given steps. Returns the in-flight RunContext so
 * the caller can await completion or cancel it.
 *
 * T2: per-step `target` is honored, and steps targeting different
 * hwnds run in parallel.
 *
 * `options.targetHwnd` (v0.4.5) still triggers SetForegroundWindow
 * pre-step. `options.boundHwnd` is the new run-level binding. Per-
 * step `target` always wins over both.
 *
 * `reqTarget` is the new v0.5 run-level default (StepTarget on
 * ExecuteRequest). If supplied, it acts as the default for any step
 * that didn't set its own `target`. This is the per-run
 * "all-steps-default-to-X" override that the renderer can pass
 * without polluting the per-step field.
 */
export function startRun(
  runId: string,
  steps: Step[],
  onProgress?: ProgressCallback,
  options: RunOptions = {},
  reqTarget?: StepTarget
): RunContext {
  // Reuse the existing AbortController if a run with this id is
  // already active, otherwise create a new one.
  let ctx = activeRuns.get(runId);
  if (ctx) {
    ctx.abortController.abort();
    activeRuns.delete(runId);
  }

  const abortController = new AbortController();
  const signal = abortController.signal;
  const total = steps.length;
  const targetHwnd = options.targetHwnd ?? null;
  const boundHwnd = options.boundHwnd ?? 0;
  const settleMs = options.activateSettleMs ?? 300;
  // Per-step re-activation settle: shorter, just enough for
  // SetForegroundWindow to take effect, not for the user's window
  // to "settle visually". 150ms.
  const perStepSettleMs = 150;

  const promise = (async () => {
    // 1. Activate the legacy target window up front (v0.4.5 behavior).
    //    T2 keeps this for backward compat: the renderer may still
    //    pass `targetHwnd` to mean "activate this window before
    //    running" even when individual steps override `target`.
    if (targetHwnd && targetHwnd > 0) {
      try {
        await activateWindow(targetHwnd);
      } catch (err) {
        console.error('[runner] activateWindow failed:', err);
      }
      if (settleMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, settleMs));
      }
      const fgAfter = getCurrentForegroundHwnd();
      if (fgAfter !== targetHwnd) {
        console.log(
          `[runner] focus drifted after initial activate: target=${targetHwnd} current=${fgAfter} (will re-check per step)`
        );
      } else {
        console.log(
          `[runner] focus OK after initial activate: target=${targetHwnd} current=${fgAfter}`
        );
      }
    }

    // 2. Pre-fetch the title→hwnd map if any step targets by title.
    //    We snapshot at the start of the run so a long run doesn't
    //    get a "title moved" surprise mid-way.
    const titleMap = new Map<number, string>();
    const needsTitle = steps.some(
      (s) => (getStepTarget(s)?.kind ?? reqTarget?.kind) === 'title'
    );
    if (needsTitle) {
      try {
        const wins = await enumVisibleWindows();
        for (const w of wins) titleMap.set(w.hwnd, w.title);
      } catch (err) {
        console.warn('[runner] enumVisibleWindows for title resolution failed:', err);
      }
    }

    // 3. Dispatch every step. Same-hwnd steps serialize via the
    //    queue; different-hwnd steps run in parallel. A single
    //    AbortSignal is shared across all steps in this run.
    const promises = steps.map((step, index) =>
      dispatchStep(step, index, runId, total, signal, onProgress, {
        reqTarget,
        boundHwnd,
        targetHwnd,
        perStepSettleMs,
        titleMap
      })
    );
    try {
      await Promise.all(promises);
    } catch (err) {
      // v0.4.3: a user-initiated cancel is not a failure. Tag it
      // so the .catch below can downgrade.
      if (signal.aborted) {
        const e: Error & { __cancelled?: boolean } =
          err instanceof Error ? err : new Error(String(err));
        e.__cancelled = true;
        throw e;
      }
      throw err;
    }
  })()
    .catch((err) => {
      if (err && (err as Error & { __cancelled?: boolean }).__cancelled) {
        console.log(`[runner] run ${runId} cancelled by user`);
      } else {
        console.error(`[runner] run ${runId} failed:`, err);
      }
    })
    .finally(() => {
      activeRuns.delete(runId);
    });

  ctx = { runId, abortController, promise };
  activeRuns.set(runId, ctx);
  return ctx;
}

interface DispatchCtx {
  reqTarget: StepTarget | undefined;
  boundHwnd: number;
  targetHwnd: number | null;
  perStepSettleMs: number;
  titleMap: ReadonlyMap<number, string>;
}

async function dispatchStep(
  step: Step,
  index: number,
  runId: string,
  total: number,
  signal: AbortSignal,
  onProgress: ProgressCallback | undefined,
  dctx: DispatchCtx
): Promise<void> {
  // 中文注释：单步派发的核心循环。每一步都遵循以下顺序：
  //   1. abort 预检（避免对已取消的 step 还去抢 slot）
  //   2. 解析 step 的目标 hwnd（按 StepTarget → boundHwnd → targetHwnd → foreground 顺序）
  //   3. 抢对应 hwnd 的 queue slot（同步，可能立即成功 / 进入等待队列）
  //   4. 进入 slot 后再 re-check abort（防止"等到了但已被取消"的尴尬）
  //   5. emit 'running' 事件
  //   6. 如果 v0.4.5 legacy targetHwnd 还在，重新验证 focus（React rerender 可能偷焦点）
  //   7. executeStep（由 simulator 决定走 TSPlug 还是 nut-js）
  //   8. emit 'done' / 'error' 事件
  //   9. finally: 释放 slot
  // 任何环节出错都会被 catch 后转成 'error' 事件 + Promise reject（让 runner 的
  // Promise.all 在第一个错误时停止等待剩下的并行 step）。
  //
  // Pre-check: don't even queue if the run was cancelled before
  // this step got a chance to dispatch. Without this, a 0-length
  // queue would still get the slot and emit a 'running' event for
  // a step that never actually started.
  if (signal.aborted) {
    emit(runId, step.id, 'error', index, total, onProgress, { message: 'cancelled' });
    const e: Error & { __cancelled?: boolean } = new Error('cancelled');
    e.__cancelled = true;
    throw e;
  }

  // Resolve the step's hwnd at dispatch time. Foreground hwnd is
  // sampled now so a user who Alt-Tab'd between steps sees the new
  // foreground as the target.
  const foregroundHwnd = getCurrentForegroundHwnd();
  const hwnd = resolveStepHwnd(
    step,
    dctx.reqTarget,
    dctx.boundHwnd,
    dctx.targetHwnd,
    dctx.titleMap,
    foregroundHwnd
  );
  const queueKey: QueueKey = hwnd > 0 ? hwnd : 'foreground';

  // Acquire the per-hwnd queue slot. This is where same-hwnd
  // steps serialize; different-hwnd steps acquire independent slots
  // in parallel. The first acquirer for a fresh queue key gets the
  // slot immediately; subsequent acquirers wait until the previous
  // holder calls `release()`.
  const slot = acquireQueueSlot(queueKey);
  await slot.wait;

  try {
    // Re-check abort after acquiring the slot. Cancellation can
    // arrive between `acquireQueueSlot` and the inner work.
    if (signal.aborted) {
      emit(runId, step.id, 'error', index, total, onProgress, { message: 'cancelled' });
      const e: Error & { __cancelled?: boolean } = new Error('cancelled');
      e.__cancelled = true;
      throw e;
    }

    emit(runId, step.id, 'running', index, total, onProgress);

    // v0.4.5: re-verify focus on every step when the legacy
    // `targetHwnd` is set. The renderer's React rerender (e.g.
    // lock banner appearing) can yank focus back to SmartKeyboard
    // mid-run, and Windows will then route subsequent SendInput
    // events to the wrong window. We detect that and re-activate
    // before executing the step.
    if (dctx.targetHwnd && dctx.targetHwnd > 0) {
      const fgBefore = getCurrentForegroundHwnd();
      if (fgBefore !== dctx.targetHwnd) {
        console.log(
          `[runner] step ${index} focus drift: expected=${dctx.targetHwnd} actual=${fgBefore}, re-activating`
        );
        await activateWindow(dctx.targetHwnd);
        if (dctx.perStepSettleMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, dctx.perStepSettleMs));
        }
      }
    }

    // Throttle the 'looping' tick: only emit every Nth cycle to
    // avoid flooding IPC.
    let lastEmittedCount = 0;
    const onLoopTick = (count: number) => {
      if (count - lastEmittedCount >= LOOP_TICK_THROTTLE || count === 1) {
        lastEmittedCount = count;
        emit(runId, step.id, 'looping', index, total, onProgress, { loopCount: count });
      }
    };

    if (dctx.targetHwnd && dctx.targetHwnd > 0) {
      const fgExec = getCurrentForegroundHwnd();
      console.log(
        `[runner] step ${index} (${step.type}) -> sending, target=${dctx.targetHwnd} fg=${fgExec} resolvedHwnd=${hwnd}`
      );
    }

    try {
      await executeStep(step, signal, onLoopTick, hwnd);
    } catch (err) {
      if (signal.aborted) {
        const e: Error & { __cancelled?: boolean } =
          err instanceof Error ? err : new Error(String(err));
        e.__cancelled = true;
        emit(runId, step.id, 'error', index, total, onProgress, { message: 'cancelled' });
        throw e;
      }
      const message = err instanceof Error ? err.message : String(err);
      emit(runId, step.id, 'error', index, total, onProgress, { message });
      throw err;
    }

    if (dctx.targetHwnd && dctx.targetHwnd > 0) {
      const fgDone = getCurrentForegroundHwnd();
      console.log(
        `[runner] step ${index} (${step.type}) <- done, target=${dctx.targetHwnd} fg=${fgDone}`
      );
    }
    emit(runId, step.id, 'done', index, total, onProgress);
  } finally {
    slot.release();
  }
}

export async function awaitRun(runId: string): Promise<void> {
  const ctx = activeRuns.get(runId);
  if (!ctx) return;
  await ctx.promise;
}
