// Shared types used by both main and renderer process.
// Keep this file dependency-free so it can be imported anywhere.

export type MouseButton = 'left' | 'right' | 'middle';
export type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta';

// ---- v0.5-mini: step-level target selection -------------------------------
//
// StepTarget is the per-step override for "which window should this step
// run against?". Most steps inherit the binding from the RunBar
// (kind: 'bound'), but steps that target a different window (e.g. a
// pop-up dialog or a system folder) can override per-step.
//
// Resolved at runner-time against the current binding (or the explicit
// hwnd / title). See runner.ts (T2) for the resolver.
export type StepTarget =
  | { kind: 'foreground' }                          // current foreground
  | { kind: 'bound' }                               // RunBar-bound window
  | { kind: 'hwnd'; hwnd: number }                  // explicit hwnd
  | { kind: 'title'; title: string };               // first title match

export const DEFAULT_TARGET: StepTarget = { kind: 'foreground' };

// ---- v0.5-mini: UIA element selector --------------------------------------
//
// ElementSelector is the discriminant used by the four new UIA step
// types. Match priority at runner-time (see uia.ts findElement):
//   1. automationId  — most stable, framework-assigned
//   2. name          — display label, language-dependent but common
//   3. controlType   — coarse role (Button/Edit/etc.), optionally + name
//   4. className     — Win32 class, language-independent
//   5. xpath         — last-resort positional selector
//
// The union is open: xpath is the escape hatch. The other four are the
// recommended selectors and we expect >90% of recipes to use one of them.
export type ElementSelector =
  | { automationId: string }
  | { name: string }
  | { controlType: string; name?: string }
  | { className: string; name?: string }
  | { xpath: string };

// v0.5-mini: UIA-based step types share this discriminator helper. We
// keep the underlying step types open (renderer-side may need to add
// more later) and let the runner pattern-match on `type`.
//
// All 7 existing step types now also carry an optional `target` field.
// Old recipes that don't set it continue to use the run-level binding.
export type Step =
  // ----- v0.5-mini T1: new UIA step types -----
  | {
      id: string;
      type: 'invokeElement';
      selector: ElementSelector;
      target?: StepTarget;
      delayMs?: number;
    }
  | {
      id: string;
      type: 'setText';
      selector: ElementSelector;
      text: string;
      target?: StepTarget;
      delayMs?: number;
    }
  | {
      id: string;
      type: 'getText';
      selector: ElementSelector;
      variableName?: string;     // reserved for v0.5-full (no-op in T1)
      target?: StepTarget;
      delayMs?: number;
    }
  | {
      id: string;
      type: 'focusElement';
      selector: ElementSelector;
      target?: StepTarget;
      delayMs?: number;
    }
  // ----- existing 7 step types, now all accept optional `target` -----
  | { id: string; type: 'move'; x: number; y: number; target?: StepTarget; delayMs?: number }
  | { id: string; type: 'click'; button: MouseButton; target?: StepTarget; delayMs?: number }
  | { id: string; type: 'doubleClick'; target?: StepTarget; delayMs?: number }
  | { id: string; type: 'scroll'; dx: number; dy: number; target?: StepTarget; delayMs?: number }
  | {
      id: string;
      type: 'keyTap';
      key: string;
      modifiers?: Modifier[];
      holdMs?: number;
      intervalMs?: number;
      target?: StepTarget;
      delayMs?: number;
    }
  | {
      id: string;
      type: 'type';
      text: string;
      holdMs?: number;
      intervalMs?: number;
      target?: StepTarget;
      delayMs?: number;
    }
  | { id: string; type: 'delay'; ms: number };

export type StepType = Step['type'];

// 'looping' indicates the step is in a hold+interval auto-repeat cycle
// and has not yet been cancelled. The runner emits looping events with
// a `loopCount` field to drive UI counters.
export type StepStatus = 'idle' | 'running' | 'done' | 'error' | 'looping';

export interface WindowInfo {
  hwnd: number;
  title: string;
  processName: string;
  pid: number;
}

export interface ExecuteRequest {
  steps: Step[];
  runId: string;
  // v0.4.5: When set, the runner will bring this window to the foreground
  // before executing steps. Skipped on non-Windows or if 0.
  //
  // v0.5-mini: deprecated in favour of per-step `target` (StepTarget). Kept
  // here for backward compatibility with v0.4.6 callers and as the
  // run-level default when a step doesn't set its own `target`.
  targetHwnd?: number;
  // v0.5-mini: optional run-level target default. Per-step `target` (if
  // set) wins over this. If neither is set, falls back to the foreground
  // window at the moment the step starts.
  target?: StepTarget;
  // v0.5-mini T2: the run-level "binding" hwnd injected by the
  // renderer from its binding store. When a step's target is
  // { kind: 'bound' } (or a step has no target and `targetHwnd` is
  // not set), the runner resolves the target to this hwnd. Distinct
  // from `targetHwnd` so the renderer can pass a "binding" without
  // forcing the runner to call SetForegroundWindow on it (the
  // background-mode toggle still drives `targetHwnd` separately).
  boundHwnd?: number;
}

export interface ProgressEvent {
  runId: string;
  stepId: string;
  status: StepStatus;
  message?: string;
  index?: number;
  total?: number;
  // Populated when status === 'looping'. Indicates how many full
  // press+release cycles the looping step has completed so far.
  loopCount?: number;
}

export interface WindowsApi {
  getCurrent: () => Promise<WindowInfo | null>;
  listVisible: () => Promise<WindowInfo[]>;
  /**
   * Return per-window diagnostics, including the fields that
   * explain why a window shows up in (or is filtered out of) the
   * picker: raw IsWindowVisible flag, computed effective visibility,
   * window rect and the OS class name. Used by the AboutPage
   * diagnostic panel.
   */
  diagnose: () => Promise<WindowDiagnostics[]>;
}

// v0.6: TSPlug 插件状态快照。供渲染层展示 dll 是否可用、版本号、错误原因。
// 只读；user 配置项（SetSimMode / 注册码）不暴露。
export interface PluginStatus {
  available: boolean;
  version: string | null;
  error: string | null;
  source: 'wrapper' | 'unavailable';
}

export interface PluginApi {
  status: () => Promise<PluginStatus>;
}

// Extended view of a window with the extra fields that the
// diagnostic panel surfaces. The base `WindowInfo` stays narrow so
// the picker can keep using it without dragging in fields only the
// diagnostics page cares about.
export interface WindowDiagnostics {
  hwnd: number;
  pid: number;
  title: string;
  processName: string;
  isVisible: boolean;
  isEffectivelyVisible: boolean;
  width: number;
  height: number;
  className: string;
}

export interface SimulatorApi {
  execute: (req: ExecuteRequest) => Promise<void>;
  cancel: (runId: string) => Promise<void>;
  onProgress: (cb: (e: ProgressEvent) => void) => () => void;
}

declare global {
  interface Window {
    api: {
      simulator: SimulatorApi;
      windows: WindowsApi;
      plugin: PluginApi;
    };
  }
}
