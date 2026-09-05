// Shared types used by both main and renderer process.
// Keep this file dependency-free so it can be imported anywhere.

export type MouseButton = 'left' | 'right' | 'middle';
export type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta';

export type Step =
  | { id: string; type: 'move'; x: number; y: number; delayMs?: number }
  | { id: string; type: 'click'; button: MouseButton; delayMs?: number }
  | { id: string; type: 'doubleClick'; delayMs?: number }
  | { id: string; type: 'scroll'; dx: number; dy: number; delayMs?: number }
  | {
      id: string;
      type: 'keyTap';
      key: string;
      modifiers?: Modifier[];
      holdMs?: number;
      intervalMs?: number;
      delayMs?: number;
    }
  | {
      id: string;
      type: 'type';
      text: string;
      holdMs?: number;
      intervalMs?: number;
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
  // When set, the runner will bring this window to the foreground
  // before executing steps. Skipped on non-Windows or if 0.
  targetHwnd?: number;
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
    };
  }
}
