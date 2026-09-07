// 模拟器 (simulator) — 负责把用户配置的 step 序列翻译成对系统的实际输入
//
// 优先级（每一步独立判断）：
//   1. SKIP_REAL_EXECUTION=1：纯 log，不真实触发（开发调试 / CI 用）
//   2. TSPlug.dll 可用：调天使插件的 C API（带后台模式 / 驱动级 input）
//   3. fallback：@nut-tree/nut-js 真实 SendInput（标准 Win32 应用 OK，反外挂游戏拦不住）
//
// TSPlug 走后台模式的关键是 BindWindow(hwnd, display, mouse, keypad, mode)：
//   - 绑定后键鼠消息直接进目标窗口 message queue，不依赖 OS 前台焦点
//   - 可选 display/mouse/keypad 模式：normal（前台）/ gdi/dx（后台抓图 + 模拟）
//
// 当前选择 TSPlug 还是 nut-js 是 step-by-step 判断的，不影响 run 整体行为：
// - 没绑 hwnd 的 step：两边都走"全局"模式（前台 OS 焦点），行为基本一致
// - 绑了 hwnd 的 step：TSPlug 走 BindWindow 后台模式，nut-js 走 withAttachedInput
//   把 SendInput 附加到目标窗口所在线程。两种方式都能绕过 Foreground Lock，
//   但 TSPlug 的 dx 系列更稳（驱动级，拦不到）。
//
// v0.5-mini T2: the top-level executeStep() now switches between
// three sub-paths:
//   1. executeInputStep — wraps nut-js calls in withAttachedInput()
//      so the per-step hwnd can be tied to the target thread.
//   2. executeDelay     — plain sleep, no hwnd dependency.
//   3. executeUiaStep   — calls the UIA stub from ./uia.ts. T1
//      threw a placeholder; T2 calls the actual stub functions so
//      the runner sees a real UiaBackendUnavailableError on
//      Windows. T3 will replace the stub internals; the runner
//      contract here does not change.
//
// v0.6: TSPlug 路径被插到 execKeyTap / execType / execClick / execMove /
// execScroll / execDoubleClick / execDelay 之前，每步先问 loader "TSPlug
// 在不在？"，在就走 wrapper，不在就走 nut-js。

import { mouse, keyboard, Button, Point } from '@nut-tree/nut-js';
import { Key } from '@nut-tree/shared';
import type { Step, Modifier } from '../shared/types.js';
import { withAttachedInput } from './window.js';
import {
  findElement,
  invokeElement,
  setElementText,
  getElementText,
  focusElement
} from './uia.js';
import {
  isTSPlugAvailable,
  getTSPlug,
  withBoundHwnd
} from './auto-plugin/tian-shi/loader.js';

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

// ----- key 名字映射 --------------------------------------------------------
//
// TSPlug.KeyPressChar / KeyDownChar / KeyUpChar 接受 key 名字符串。
// 我们从 Step.key 拿到的是 "F5" / "Enter" / "a" / "LeftShift" 之类。
// TSPlug 内部有大写 key map，简单 toUpperCase() 就能覆盖 95% 的情况。
// 少数 unicode 字符（中文 / emoji）保持原样。
function keyToTSPlugChar(key: string): string {
  if (!key) return key;
  // 单字符：保持原样（包括大小写字母；TSPlug 接受 "a" 和 "A"，两者等价）
  if (key.length === 1) return key;
  // 复合键：F1-F12、方向键、功能键。toUpperCase 是 TSPlug 的标准写法。
  return key.toUpperCase();
}

// ----- TSPlug 路径（每个 exec* 在调用前先判 isTSPlugAvailable） ------------
//
// 每个 TSPlug 路径都是一个小 async 函数，签名跟对应的 nut-js 版本保持一致
// （step + signal + 可选 holdMs 等），方便 executeInputStepInner 在分支里替换。
// BindWindow/UnBindWindow 的成对调用由 withBoundHwnd() 包好。

async function execMoveTSPlug(
  step: Extract<Step, { type: 'move' }>,
  hwnd: number | null
) {
  await withBoundHwnd(hwnd, (ts) => {
    ts.MoveTo(step.x, step.y);
  });
  console.log(`[simulator] move x=${step.x} y=${step.y} (TSPlug)`);
}

async function execClickTSPlug(
  step: Extract<Step, { type: 'click' }>,
  hwnd: number | null
) {
  await withBoundHwnd(hwnd, (ts) => {
    if (step.button === 'right') ts.RightClick();
    else if (step.button === 'middle') ts.MiddleClick();
    else ts.LeftClick();
  });
  console.log(`[simulator] click button=${step.button} (TSPlug)`);
}

async function execDoubleClickTSPlug(hwnd: number | null) {
  await withBoundHwnd(hwnd, (ts) => {
    ts.LeftDoubleClick();
  });
  console.log('[simulator] doubleClick (TSPlug)');
}

async function execScrollTSPlug(
  step: Extract<Step, { type: 'scroll' }>,
  hwnd: number | null
) {
  // TSPlug 的滚轮接口是 WheelUp/WheelDown 两个独立方法（没有方向 / 步数合一）。
  // 我们的 step.dx/dy 可能为正 / 负 / 0；dx>0 → 右滚，dx<0 → 左滚，
  // TSPlug 没有 Left/Right wheel API，因此 dx 走"额外水平滚动"近似。
  // 实际项目里 90% 场景是纯 dy，这里只覆盖 dy；dx 留 warning。
  await withBoundHwnd(hwnd, (ts) => {
    if (step.dy > 0) {
      for (let i = 0; i < step.dy; i++) ts.WheelUp();
    } else if (step.dy < 0) {
      for (let i = 0; i < -step.dy; i++) ts.WheelDown();
    }
    if (step.dx !== 0) {
      // TSPlug 没暴露水平 wheel，键盘层有 Left/Right 模拟但 nut-js 的
      // 行为是 mouse scroll API 跟 wheel event 配对。dev 模式先告警。
      console.warn(`[simulator] TSPlug: horizontal scroll (dx=${step.dx}) is not fully supported; skipping`);
    }
  });
  console.log(`[simulator] scroll dx=${step.dx} dy=${step.dy} (TSPlug)`);
}

async function execKeyTapTSPlugWithHold(
  step: Extract<Step, { type: 'keyTap' }>,
  signal: AbortSignal | undefined,
  holdMs: number,
  hwnd: number | null
) {
  const key = keyToTSPlugChar(step.key);
  const mods = step.modifiers || [];
  // hold>0 时必须分三段：down → sleep → up。withBoundHwnd 的 callback 是
  // 同步的（我们 await 它的结果），所以 sleep 在 callback 内部 await。
  await withBoundHwnd(hwnd, async (ts) => {
    for (const m of mods) {
      ts.KeyDownChar(keyToTSPlugChar(m));
    }
    ts.KeyDownChar(key);
    if (holdMs > 0) {
      await sleep(holdMs, signal);
    }
    ts.KeyUpChar(key);
    for (let i = mods.length - 1; i >= 0; i--) {
      ts.KeyUpChar(keyToTSPlugChar(mods[i]!));
    }
  });
  console.log(
    `[simulator] keyTap key=${step.key} mods=${mods.join(',') || '-'} holdMs=${holdMs} (TSPlug)`
  );
}

async function execTypeTSPlug(
  step: Extract<Step, { type: 'type' }>,
  signal: AbortSignal | undefined,
  holdMs: number,
  hwnd: number | null
) {
  // TSPlug 的文本发送有两种：
  //   - SendString(hwnd, text): 走 SendMessage → 目标窗口的 WndProc，
  //     只对自家 EDIT 控件有效，对浏览器/游戏的 IMM 文本框无效。
  //   - SendStringIme(text): 走 IME，注入到当前输入法的合成串，
  //     跟手动打字走同一通道，对游戏聊天框、浏览器地址栏都有效。
  // 选择规则：绑了 hwnd 用 SendString；没绑用 SendStringIme。
  await withBoundHwnd(hwnd, async (ts) => {
    if (hwnd && hwnd > 0 && typeof ts.SendString === 'function') {
      ts.SendString(hwnd, step.text);
    } else if (typeof ts.SendStringIme === 'function') {
      ts.SendStringIme(step.text);
    } else {
      // 两个 API 都不在（理论上 wrapper 总会有） → 退到逐字 KeyPress
      for (const ch of step.text) {
        ts.KeyPressChar(ch);
        if (holdMs > 0) await sleep(holdMs, signal);
      }
    }
  });
  console.log(`[simulator] type text="${step.text}" holdMs=${holdMs} (TSPlug)`);
}

async function execDelayTSPlug(step: Extract<Step, { type: 'delay' }>) {
  // TSPlug 的 Delay 是 native sleep，比 Node 的 setTimeout 在 system-wide 节流
  // 下更稳（精度高一点）。但语义上 setTimeout 也够用，这里直接用 JS sleep。
  // 保留 Delay 调用作为占位（万一以后想切 native）。
  const ts = getTSPlug();
  if (typeof ts.Delay === 'function') {
    ts.Delay(Math.max(0, Math.floor(step.ms)));
  } else {
    await sleep(Math.max(0, Math.floor(step.ms)));
  }
  console.log(`[simulator] delay ms=${step.ms} (TSPlug)`);
}

// ----- 原有 nut-js 路径（fallback / 无 TSPlug 时用） ------------------------

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
  // v0.4.5: log every real SendInput so the dev console can
  // confirm what the simulator actually sent. The line is paired
  // with the [runner] step N -> sending line; if both appear with
  // matching step index, the chain is end-to-end: bind -> activate
  // -> focus OK -> keyTap dispatched. If the Notepad text is
  // empty afterwards, it's a target-app reception problem (UWP
  // apps reject SendInput), not a SmartKeyboard routing problem.
  console.log(
    `[simulator] keyTap key=${step.key} mods=${(step.modifiers || []).join(',') || '-'} holdMs=${holdMs}`
  );
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
  onLoopTick?: (count: number) => void,
  hwnd: number | null = null
) {
  checkAbort(signal);
  const holdMsRaw = typeof step.holdMs === 'number' ? step.holdMs : DEFAULT_HOLD_MS;
  const holdMs = Math.max(0, Math.floor(holdMsRaw));
  const intervalMs = Math.max(0, Math.floor(step.intervalMs ?? 0));

  // v0.6: TSPlug 优先。注意只支持单 key + modifiers 的循环，TSPlug.KeyPressChar
  // 是 native call，速度远快于 nut-js.keyboard.pressKey。
  if (isTSPlugAvailable() && !isMock()) {
    if (intervalMs <= 0) {
      await execKeyTapTSPlugWithHold(step, signal, holdMs, hwnd);
      return;
    }
    // 循环模式：和 nut-js 路径相同的 press → hold → release → wait 循环
    let count = 0;
    while (true) {
      if (signal?.aborted) throw new Error('cancelled');
      await execKeyTapTSPlugWithHold(step, signal, holdMs, hwnd);
      count += 1;
      if (onLoopTick) onLoopTick(count);
      if (signal?.aborted) throw new Error('cancelled');
      await sleep(intervalMs, signal);
    }
  }

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
  holdMs: number,
  hwnd: number | null = null
): Promise<void> {
  if (isMock()) {
    console.log(`[skip] type text="${step.text}" holdMs=${holdMs}`);
    return;
  }
  // v0.6: TSPlug 路径（SendString / SendStringIme）。无 hold 概念 → holdMs=0 走 TSPlug。
  if (isTSPlugAvailable() && holdMs <= 0) {
    await execTypeTSPlug(step, signal, holdMs, hwnd);
    return;
  }
  // v0.4.5: see execKeyTapOnce for the rationale.
  console.log(`[simulator] type text="${step.text}" holdMs=${holdMs}`);
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
  onLoopTick?: (count: number) => void,
  hwnd: number | null = null
) {
  checkAbort(signal);
  const holdMsRaw = typeof step.holdMs === 'number' ? step.holdMs : DEFAULT_HOLD_MS;
  const holdMs = Math.max(0, Math.floor(holdMsRaw));
  const intervalMs = Math.max(0, Math.floor(step.intervalMs ?? 0));

  if (intervalMs <= 0) {
    await execTypeOnce(step, signal, holdMs, hwnd);
    return;
  }

  // looping: re-emit the full text every intervalMs.
  let count = 0;
  while (true) {
    if (signal?.aborted) {
      throw new Error('cancelled');
    }
    await execTypeOnce(step, signal, holdMs, hwnd);
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
 *
 * v0.5-mini T2: `resolvedHwnd` is the per-step target hwnd the
 * runner resolved at dispatch time. For input steps (move / click /
 * doubleClick / scroll / keyTap / type) we wrap the nut-js call in
 * `withAttachedInput()` so the calling thread's input state is
 * tied to the target window's thread — this is the cure for the
 * Foreground Lock when the bound window is not currently
 * foreground. For UIA steps the hwnd is forwarded to
 * `findElement()`. `null` (or 0) means "no specific target" — the
 * input path skips the attach (and the call lands in the current
 * foreground, whatever it is), and the UIA path throws a clear
 * error so a misconfigured recipe fails loudly.
 *
 * v0.6: `resolvedHwnd` 现在同时驱动 TSPlug.BindWindow 和
 * nut-js.withAttachedInput，路径选择按 isTSPlugAvailable()。
 */
export async function executeStep(
  step: Step,
  signal?: AbortSignal,
  onLoopTick?: (count: number) => void,
  resolvedHwnd?: number | null
): Promise<void> {
  const hwnd = resolvedHwnd ?? null;
  switch (step.type) {
    case 'move':
    case 'click':
    case 'doubleClick':
    case 'scroll':
    case 'keyTap':
    case 'type':
      await executeInputStep(step, signal, onLoopTick, hwnd);
      break;
    case 'delay':
      await execDelay(step, signal);
      break;
    case 'invokeElement':
    case 'setText':
    case 'getText':
    case 'focusElement':
      await executeUiaStep(step, signal, hwnd);
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
 * v0.5-mini T2: run an input step. If `hwnd` is a real hwnd, the
 * inner nut-js call runs inside `withAttachedInput()` so the call
 * is not blocked by the Windows Foreground Lock. If `hwnd` is
 * null/0 we run the call directly (current foreground, no
 * attachment).
 *
 * v0.6: 优先 TSPlug 路径。TSPlug 走 BindWindow（不需要 Foreground Lock）；
 * nut-js 路径才需要 withAttachedInput。两种后台机制互斥，TSPlug
 * 成功时跳过 withAttachedInput 以避免双重线程切换。
 */
async function executeInputStep(
  step: Step,
  signal: AbortSignal | undefined,
  onLoopTick: ((count: number) => void) | undefined,
  hwnd: number | null
): Promise<void> {
  // v0.6: TSPlug 路径（如果可用）。把 TSPlug 专用的 step 类型桥到这里。
  if (isTSPlugAvailable() && !isMock()) {
    await executeInputStepTSPlug(step, signal, onLoopTick, hwnd);
    return;
  }
  // fallback: nut-js
  const inner = () => executeInputStepInner(step, signal, onLoopTick, hwnd);
  if (hwnd && hwnd > 0) {
    await withAttachedInput(hwnd, inner);
  } else {
    await inner();
  }
}

async function executeInputStepTSPlug(
  step: Step,
  signal: AbortSignal | undefined,
  onLoopTick: ((count: number) => void) | undefined,
  hwnd: number | null
): Promise<void> {
  const inputStep = step as Extract<
    Step,
    { type: 'move' | 'click' | 'doubleClick' | 'scroll' | 'keyTap' | 'type' }
  >;
  switch (inputStep.type) {
    case 'move':
      await execMoveTSPlug(inputStep, hwnd);
      return;
    case 'click':
      await execClickTSPlug(inputStep, hwnd);
      return;
    case 'doubleClick':
      await execDoubleClickTSPlug(hwnd);
      return;
    case 'scroll':
      await execScrollTSPlug(inputStep, hwnd);
      return;
    case 'keyTap': {
      const holdMsRaw = typeof inputStep.holdMs === 'number' ? inputStep.holdMs : DEFAULT_HOLD_MS;
      const holdMs = Math.max(0, Math.floor(holdMsRaw));
      const intervalMs = Math.max(0, Math.floor(inputStep.intervalMs ?? 0));
      if (intervalMs <= 0) {
        await execKeyTapTSPlugWithHold(inputStep, signal, holdMs, hwnd);
        return;
      }
      // looping：和 nut-js 路径一样，press+release 一轮后等 intervalMs
      let count = 0;
      while (true) {
        if (signal?.aborted) throw new Error('cancelled');
        await execKeyTapTSPlugWithHold(inputStep, signal, holdMs, hwnd);
        count += 1;
        if (onLoopTick) onLoopTick(count);
        if (signal?.aborted) throw new Error('cancelled');
        await sleep(intervalMs, signal);
      }
    }
    case 'type': {
      const holdMsRaw = typeof inputStep.holdMs === 'number' ? inputStep.holdMs : DEFAULT_HOLD_MS;
      const holdMs = Math.max(0, Math.floor(holdMsRaw));
      const intervalMs = Math.max(0, Math.floor(inputStep.intervalMs ?? 0));
      if (intervalMs <= 0) {
        await execTypeTSPlug(inputStep, signal, holdMs, hwnd);
        return;
      }
      let count = 0;
      while (true) {
        if (signal?.aborted) throw new Error('cancelled');
        await execTypeTSPlug(inputStep, signal, holdMs, hwnd);
        count += 1;
        if (onLoopTick) onLoopTick(count);
        if (signal?.aborted) throw new Error('cancelled');
        await sleep(intervalMs, signal);
      }
    }
    default: {
      const _exhaustive: never = inputStep;
      void _exhaustive;
      throw new Error(`executeInputStepTSPlug: not an input step: ${(step as { type: string }).type}`);
    }
  }
}

async function executeInputStepInner(
  step: Step,
  signal: AbortSignal | undefined,
  onLoopTick: ((count: number) => void) | undefined,
  hwnd: number | null
): Promise<void> {
  // The caller (executeInputStep) only ever forwards input-step
  // types here. Narrow the union for the inner switch so the
  // exhaustive check actually exhausts the input subset.
  const inputStep = step as Extract<
    Step,
    { type: 'move' | 'click' | 'doubleClick' | 'scroll' | 'keyTap' | 'type' }
  >;
  switch (inputStep.type) {
    case 'move':
      await execMove(inputStep, signal);
      break;
    case 'click':
      await execClick(inputStep, signal);
      break;
    case 'doubleClick':
      await execDoubleClick(inputStep, signal);
      break;
    case 'scroll':
      await execScroll(inputStep, signal);
      break;
    case 'keyTap':
      await execKeyTap(inputStep, signal, onLoopTick, hwnd);
      break;
    case 'type':
      await execType(inputStep, signal, onLoopTick, hwnd);
      break;
    default: {
      const _exhaustive: never = inputStep;
      void _exhaustive;
      throw new Error(`executeInputStepInner: not an input step: ${(step as { type: string }).type}`);
    }
  }
}

/**
 * v0.5-mini T2: run a UIA step. Looks up the element via the UIA
 * stub (`findElement`) and dispatches the action. The stub throws
 * `UiaBackendUnavailableError` on Windows in T2 (T3 will replace
 * the stub internals with a real UIA client); on non-Windows it
 * returns null, in which case we surface a clear
 * "UIA element not found" error so a misconfigured recipe fails
 * loudly.
 */
async function executeUiaStep(
  step: Step,
  signal: AbortSignal | undefined,
  hwnd: number | null
): Promise<void> {
  // T2 doesn't have a per-step selector→element cache, so a
  // cancellation check here is good enough: the loop tick is
  // already checked inside execKeyTap/execType for looping
  // variants, and UIA calls are single-shot.
  if (signal?.aborted) {
    throw new Error('cancelled');
  }
  if (!hwnd || hwnd <= 0) {
    throw new Error(
      `UIA step ${step.type} requires a target hwnd > 0 (got ${hwnd}); set step.target or bind a window`
    );
  }
  // findElement may throw UiaBackendUnavailableError on Windows
  // (T2 reality; T3 will replace the stub with a real UIA client).
  // We let that propagate; the runner emits the message verbatim.
  // Narrow step to the UIA subset BEFORE the call so the
  // selector/text fields are visible to the type checker.
  const uiaStep = step as Extract<
    Step,
    { type: 'invokeElement' | 'setText' | 'getText' | 'focusElement' }
  >;
  const el = await findElement(hwnd, uiaStep.selector);
  if (el == null) {
    throw new Error(
      `UIA element not found for selector ${JSON.stringify(uiaStep.selector)} in hwnd ${hwnd}`
    );
  }
  switch (uiaStep.type) {
    case 'invokeElement':
      await invokeElement(el);
      return;
    case 'setText':
      await setElementText(el, uiaStep.text);
      return;
    case 'getText':
      await getElementText(el);
      return;
    case 'focusElement':
      await focusElement(el);
      return;
    default: {
      const _exhaustive: never = uiaStep;
      void _exhaustive;
      throw new Error(`executeUiaStep: not a UIA step: ${(step as { type: string }).type}`);
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
