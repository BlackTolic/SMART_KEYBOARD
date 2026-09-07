import { create } from 'zustand';
import type { Step, StepType, StepStatus, StepTarget, ElementSelector } from '@shared/types';

export type StepState = Step & {
  status: StepStatus;
  message?: string;
  loopCount?: number;
};

interface StepsStore {
  steps: StepState[];
  add: (type: StepType) => void;
  remove: (id: string) => void;
  update: (id: string, patch: Partial<Step>) => void;
  moveUp: (id: string) => void;
  moveDown: (id: string) => void;
  setStatus: (id: string, status: StepStatus, message?: string, loopCount?: number) => void;
  clear: () => void;
  resetStatuses: () => void;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: very low chance of collision is fine for an editor.
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * v0.5-mini T3: every step type now carries an explicit `target`
 * field.  Most recipes leave it at the default `{ kind: 'foreground' }`
 * (or `{ kind: 'bound' }` once a window is bound), so we pre-fill
 * the default to make the editor's "Add step" button land on a
 * sensible value.  The T2 runner still falls back to the run-level
 * `boundHwnd` when `target` is undefined, but the store now always
 * sets it so the StepRow has something to render in the target row.
 */
const DEFAULT_TARGET: StepTarget = { kind: 'foreground' };

/**
 * Default selector for the four UIA step types.  Bare
 * `{ name: '' }` is the most user-friendly starting point: it asks
 * the user to type a label like "OK" or "登录" and the v0.5-mini
 * PowerShell backend resolves it via NameProperty.
 */
const DEFAULT_SELECTOR: ElementSelector = { name: '' };

function defaultStep(type: StepType): Step {
  const base = (extra: Partial<Step>): Step => ({
    ...(extra as object),
    id: uuid(),
    target: DEFAULT_TARGET
  } as Step);
  switch (type) {
    case 'move':
      return base({ type: 'move', x: 0, y: 0, delayMs: 0 });
    case 'click':
      return base({ type: 'click', button: 'left', delayMs: 0 });
    case 'doubleClick':
      return base({ type: 'doubleClick', delayMs: 0 });
    case 'scroll':
      return base({ type: 'scroll', dx: 0, dy: 0, delayMs: 0 });
    case 'keyTap':
      return base({
        type: 'keyTap',
        key: 'Enter',
        modifiers: [],
        holdMs: 50,
        intervalMs: 0,
        delayMs: 0
      });
    case 'type':
      return base({ type: 'type', text: '', holdMs: 50, intervalMs: 0, delayMs: 0 });
    case 'delay':
      return base({ type: 'delay', ms: 500 });
    // v0.5-mini T3: the four UIA step types now have full defaults
    // including a target row.  The selector starts as `{ name: '' }`
    // (the most common shape — automationId for legacy Win32 dialogs
    // is rarer than a localised name like "确定" / "OK" / "登录").
    case 'invokeElement':
      return base({ type: 'invokeElement', selector: { ...DEFAULT_SELECTOR } });
    case 'setText':
      return base({ type: 'setText', selector: { ...DEFAULT_SELECTOR }, text: '' });
    case 'getText':
      return base({ type: 'getText', selector: { ...DEFAULT_SELECTOR } });
    case 'focusElement':
      return base({ type: 'focusElement', selector: { ...DEFAULT_SELECTOR } });
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      throw new Error('unknown step type');
    }
  }
}

function asStepState(s: Step): StepState {
  return { ...s, status: 'idle' };
}

export const useStepsStore = create<StepsStore>((set) => ({
  steps: [],
  add(type) {
    set((state) => ({ steps: [...state.steps, asStepState(defaultStep(type))] }));
  },
  remove(id) {
    set((state) => ({ steps: state.steps.filter((s) => s.id !== id) }));
  },
  update(id, patch) {
    set((state) => ({
      steps: state.steps.map((s) => {
        if (s.id !== id) return s;
        // strip id+type from patch to keep them immutable
        const { id: _i, type: _t, ...rest } = patch as Partial<Step> & {
          id?: string;
          type?: StepType;
        };
        return { ...s, ...rest } as StepState;
      })
    }));
  },
  moveUp(id) {
    set((state) => {
      const idx = state.steps.findIndex((s) => s.id === id);
      if (idx <= 0) return state;
      const next = state.steps.slice();
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return { steps: next };
    });
  },
  moveDown(id) {
    set((state) => {
      const idx = state.steps.findIndex((s) => s.id === id);
      if (idx < 0 || idx >= state.steps.length - 1) return state;
      const next = state.steps.slice();
      [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
      return { steps: next };
    });
  },
  setStatus(id, status, message, loopCount) {
    set((state) => ({
      steps: state.steps.map((s) =>
        s.id === id
          ? {
              ...s,
              status,
              message,
              loopCount: status === 'looping' ? loopCount : undefined
            }
          : s
      )
    }));
  },
  clear() {
    set({ steps: [] });
  },
  resetStatuses() {
    set((state) => ({
      steps: state.steps.map((s) => ({
        ...s,
        status: 'idle',
        message: undefined,
        loopCount: undefined
      }))
    }));
  }
}));

export function makeNewStepId(): string {
  return uuid();
}
