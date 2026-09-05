import { create } from 'zustand';
import type { Step, StepType, StepStatus } from '@shared/types';

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

function defaultStep(type: StepType): Step {
  switch (type) {
    case 'move':
      return { id: uuid(), type: 'move', x: 0, y: 0, delayMs: 0 };
    case 'click':
      return { id: uuid(), type: 'click', button: 'left', delayMs: 0 };
    case 'doubleClick':
      return { id: uuid(), type: 'doubleClick', delayMs: 0 };
    case 'scroll':
      return { id: uuid(), type: 'scroll', dx: 0, dy: 0, delayMs: 0 };
    case 'keyTap':
      return { id: uuid(), type: 'keyTap', key: 'Enter', modifiers: [], holdMs: 50, intervalMs: 0, delayMs: 0 };
    case 'type':
      return { id: uuid(), type: 'type', text: '', holdMs: 50, intervalMs: 0, delayMs: 0 };
    case 'delay':
      return { id: uuid(), type: 'delay', ms: 500 };
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
