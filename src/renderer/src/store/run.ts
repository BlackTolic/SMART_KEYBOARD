// Run state: lives at module scope (zustand) so it survives
// EditorPage unmount/remount when the user navigates to About
// and back. v0.4.6.

import { create } from 'zustand';

interface RunStore {
  // The runId of the run currently in progress, or null if
  // nothing is running. The store keeps the same runId until
  // either a new run is started (which replaces it) or the
  // current run is finished (which sets it back to null).
  currentRunId: string | null;
  // True iff a run is in progress. Mirrors `currentRunId !== null`
  // but is its own field so consumers don't need to remember the
  // null-vs-string distinction.
  isRunning: boolean;
  // Mark a run as started. Returns the new runId so the caller
  // can use it for the IPC call. If a run is already in
  // progress, returns the existing runId (no double-start).
  startRun: () => string;
  // Mark a run as finished. No-op if the runId doesn't match
  // the current runId (handles the "old run finished after a
  // new run was started" race).
  finishRun: (runId: string) => void;
  // Same as finishRun, but for an explicit user cancel. We
  // don't differentiate the two in the store, but keep the
  // separate name so call sites are self-documenting.
  cancelRun: (runId: string) => void;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const useRunStore = create<RunStore>((set, get) => ({
  currentRunId: null,
  isRunning: false,
  startRun() {
    const existing = get().currentRunId;
    if (existing) return existing;
    const next = uuid();
    set({ currentRunId: next, isRunning: true });
    return next;
  },
  finishRun(runId) {
    set((state) => {
      if (state.currentRunId !== runId) return state;
      return { currentRunId: null, isRunning: false };
    });
  },
  cancelRun(runId) {
    // Same body as finishRun; kept as a separate name so the
    // call site in EditorPage.handleCancel reads naturally.
    set((state) => {
      if (state.currentRunId !== runId) return state;
      return { currentRunId: null, isRunning: false };
    });
  }
}));
