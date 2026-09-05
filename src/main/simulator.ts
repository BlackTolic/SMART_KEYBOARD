// Thin wrapper around @nut-tree/nut-js so it can be mocked in tests
// and skipped in CI via SKIP_REAL_EXECUTION=1.
//
// We use a top-level import rather than require() so that Vitest's
// vi.mock() can intercept the module (Vitest mocks don't reliably
// cover require() calls). electron-vite's externalizeDepsPlugin
// keeps the dependency external at runtime, so the import resolves
// to the installed package via Node's resolver at run time.

import { mouse, keyboard, Button, Point } from '@nut-tree/nut-js';
import { Key } from '@nut-tree/shared';
import type { Step, Modifier } from '../shared/types.js';

const MODIFIER_MAP: Record<Modifier, Key[]> = {
  ctrl: [Key.LeftControl],
  alt: [Key.LeftAlt],
  shift: [Key.LeftShift],
  meta: [Key.LeftWin]
};

const DEFAULT_HOLD_MS = 50;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('cancelled'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error('cancelled');
  }
}

function isMock(): boolean {
  return process.env.SKIP_REAL_EXECUTION === '1';
}

/**
 * Resolve a user-supplied key string (e.g. "Enter", "a", "F5") to a
 * nut-js Key enum value. If the string isn't a known enum name we
 * pass it through cast as Key — the underlying libnut provider
 * accepts raw key names at runtime.
 */
function resolveKey(name: string): Key {
  const entries = Object.entries(Key) as [string, Key][];
  for (const [k, v] of entries) {
    if (k === name) return v;
  }
  return name as unknown as Key;
}

async function execMove(step: Extract<Step, { type: 'move' }>, signal?: AbortSignal) {
  checkAbort(signal);
  if (isMock()) {
    console.log(`[skip] move x=${step.x} y=${step.y}`);
    return;
  }
  await mouse.setPosition(new Point(step.x, step.y));
}

async function execClick(
  step: Extract<Step, { type: 'click' }>,
  signal?: AbortSignal
) {
  checkAbort(signal);
  if (isMock()) {
    console.log(`[skip] click button=${step.button}`);
    return;
  }
  const button = Button[step.button === 'left' ? 'LEFT' : step.button === 'right' ? 'RIGHT' : 'MIDDLE'];
  await mouse.click(button);
}

async function execDoubleClick(
  step: Extract<Step, { type: 'doubleClick' }>,
  signal?: AbortSignal
) {
  checkAbort(signal);
  if (isMock()) {
    console.log('[skip] doubleClick');
    return;
  }
  await mouse.doubleClick(Button.LEFT);
}

async function execScroll(
  step: Extract<Step, { type: 'scroll' }>,
  signal?: AbortSignal
) {
  checkAbort(signal);
  if (isMock()) {
    console.log(`[skip] scroll dx=${step.dx} dy=${step.dy}`);
    return;
  }
  if (step.dy > 0) await mouse.scrollUp(step.dy);
  if (step.dy < 0) await mouse.scrollDown(-step.dy);
  if (step.dx > 0) await mouse.scrollRight(step.dx);
  if (step.dx < 0) await mouse.scrollLeft(-step.dx);
}

/**
 * Perform a single keyTap: press (modifiers + main), sleep(holdMs),
 * release in reverse order. This is a behavioral change from v0.1,
 * which relied on nut-js's implicit press+release. We now always
 * release explicitly so the holdMs timing is honored.
 */
async function execKeyTapOnce(
  step: Extract<Step, { type: 'keyTap' }>,
  signal: AbortSignal | undefined,
  holdMs: number
): Promise<void> {
  if (isMock()) {
    console.log(
      `[skip] keyTap key=${step.key} modifiers=${(step.modifiers || []).join(',')} holdMs=${holdMs}`
    );
    return;
  }
  const modKeys: Key[] = [];
  for (const m of step.modifiers || []) {
    modKeys.push(...MODIFIER_MAP[m]);
  }
  const namedKey = resolveKey(step.key);
  // 1. press: modifiers first, then the main key
  await keyboard.pressKey(...modKeys, namedKey);
  // 2. hold
  if (holdMs > 0) {
    await sleep(holdMs, signal);
  }
  // 3. release: main first, then modifiers in reverse
  await keyboard.releaseKey(namedKey);
  for (let i = modKeys.length - 1; i >= 0; i--) {
    await keyboard.releaseKey(modKeys[i]);
  }
}

async function execKeyTap(
  step: Extract<Step, { type: 'keyTap' }>,
  signal?: AbortSignal,
  onLoopTick?: (count: number) => void
) {
  checkAbort(signal);
  const holdMsRaw = typeof step.holdMs === 'number' ? step.holdMs : DEFAULT_HOLD_MS;
  const holdMs = Math.max(0, Math.floor(holdMsRaw));
  const intervalMs = Math.max(0, Math.floor(step.intervalMs ?? 0));

  if (intervalMs <= 0) {
    // single press+hold+release
    await execKeyTapOnce(step, signal, holdMs);
    return;
  }

  // looping mode: press → hold → release → wait intervalMs → repeat
  // until AbortSignal fires.
  let count = 0;
  while (true) {
    if (signal?.aborted) {
      throw new Error('cancelled');
    }
    await execKeyTapOnce(step, signal, holdMs);
    count += 1;
    if (onLoopTick) onLoopTick(count);
    if (signal?.aborted) {
      throw new Error('cancelled');
    }
    await sleep(intervalMs, signal);
  }
}

/**
 * Emit a single "type text" pass. With holdMs=0 (the default) we
 * just defer to nut-js's keyboard.type which is a fast string type.
 * With holdMs>0 we press + hold + release each character so the user
 * gets per-character timing control.
 */
async function execTypeOnce(
  step: Extract<Step, { type: 'type' }>,
  signal: AbortSignal | undefined,
  holdMs: number
): Promise<void> {
  if (isMock()) {
    console.log(`[skip] type text="${step.text}" holdMs=${holdMs}`);
    return;
  }
  if (holdMs <= 0) {
    await keyboard.type(step.text);
    return;
  }
  for (const ch of step.text) {
    checkAbort(signal);
    const k = resolveKey(ch);
    await keyboard.pressKey(k);
    await sleep(holdMs, signal);
    await keyboard.releaseKey(k);
  }
}

async function execType(
  step: Extract<Step, { type: 'type' }>,
  signal?: AbortSignal,
  onLoopTick?: (count: number) => void
) {
  checkAbort(signal);
  const holdMsRaw = typeof step.holdMs === 'number' ? step.holdMs : DEFAULT_HOLD_MS;
  const holdMs = Math.max(0, Math.floor(holdMsRaw));
  const intervalMs = Math.max(0, Math.floor(step.intervalMs ?? 0));

  if (intervalMs <= 0) {
    await execTypeOnce(step, signal, holdMs);
    return;
  }

  // looping: re-emit the full text every intervalMs.
  let count = 0;
  while (true) {
    if (signal?.aborted) {
      throw new Error('cancelled');
    }
    await execTypeOnce(step, signal, holdMs);
    count += 1;
    if (onLoopTick) onLoopTick(count);
    if (signal?.aborted) {
      throw new Error('cancelled');
    }
    await sleep(intervalMs, signal);
  }
}

async function execDelay(
  step: Extract<Step, { type: 'delay' }>,
  signal?: AbortSignal
) {
  if (isMock()) {
    console.log(`[skip] delay ms=${step.ms}`);
    return;
  }
  await sleep(step.ms, signal);
}

/**
 * Execute a single step. Throws if the step is unknown or if the
 * AbortSignal fires. The optional onLoopTick callback is invoked on
 * every completed press+release cycle while a looping step is
 * running.
 */
export async function executeStep(
  step: Step,
  signal?: AbortSignal,
  onLoopTick?: (count: number) => void
): Promise<void> {
  switch (step.type) {
    case 'move':
      await execMove(step, signal);
      break;
    case 'click':
      await execClick(step, signal);
      break;
    case 'doubleClick':
      await execDoubleClick(step, signal);
      break;
    case 'scroll':
      await execScroll(step, signal);
      break;
    case 'keyTap':
      await execKeyTap(step, signal, onLoopTick);
      break;
    case 'type':
      await execType(step, signal, onLoopTick);
      break;
    case 'delay':
      await execDelay(step, signal);
      break;
    default: {
      const _exhaustive: never = step;
      void _exhaustive;
      throw new Error(`unknown step type: ${(step as { type: string }).type}`);
    }
  }

  // post-step delay (delayMs) — skipped for looping steps because the
  // user already controls the cadence via intervalMs.
  const isLooping =
    (step.type === 'keyTap' || step.type === 'type') &&
    (step.intervalMs ?? 0) > 0;
  if (!isLooping) {
    const postDelay = (step as { delayMs?: number }).delayMs;
    if (typeof postDelay === 'number' && postDelay > 0) {
      await sleep(postDelay, signal);
    }
  }
}

/**
 * Execute a list of steps sequentially. The optional AbortSignal can be
 * used to cancel mid-run. The optional onLoopTick fires for every
 * completed press+release cycle inside a looping step.
 */
export async function executeSteps(
  steps: Step[],
  signal?: AbortSignal,
  onLoopTick?: (stepId: string, count: number) => void
): Promise<void> {
  for (const step of steps) {
    if (signal?.aborted) {
      throw new Error('cancelled');
    }
    const tick = (count: number) => onLoopTick?.(step.id, count);
    await executeStep(step, signal, tick);
  }
}
