// v0.4.6: pin the run-store contract that EditorPage and App
// both rely on. Specifically: startRun returns a stable id
// while a run is in progress, finishRun only clears the lock
// when the runId matches (handles stale events from a previous
// run), and cancelRun is just an alias for finishRun.

import { describe, it, expect, beforeEach } from 'vitest';
import { useRunStore } from '../src/renderer/src/store/run';

function reset() {
  useRunStore.setState({ currentRunId: null, isRunning: false });
}

describe('run store: startRun', () => {
  beforeEach(() => {
    reset();
  });

  it('generates a new runId and flips isRunning=true on the first call', () => {
    const id = useRunStore.getState().startRun();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(useRunStore.getState().isRunning).toBe(true);
    expect(useRunStore.getState().currentRunId).toBe(id);
  });

  it('returns the same runId on subsequent calls while a run is in progress', () => {
    const a = useRunStore.getState().startRun();
    const b = useRunStore.getState().startRun();
    expect(a).toBe(b);
    expect(useRunStore.getState().currentRunId).toBe(a);
  });

  it('generates a new runId after the previous run is finished', () => {
    const a = useRunStore.getState().startRun();
    useRunStore.getState().finishRun(a);
    const b = useRunStore.getState().startRun();
    expect(b).not.toBe(a);
  });
});

describe('run store: finishRun', () => {
  beforeEach(() => {
    reset();
  });

  it('clears the lock when the runId matches', () => {
    const id = useRunStore.getState().startRun();
    useRunStore.getState().finishRun(id);
    expect(useRunStore.getState().isRunning).toBe(false);
    expect(useRunStore.getState().currentRunId).toBeNull();
  });

  it('is a no-op when the runId does not match the current run', () => {
    const id = useRunStore.getState().startRun();
    useRunStore.getState().finishRun('stale-id');
    // Lock should still be held by the actual run.
    expect(useRunStore.getState().isRunning).toBe(true);
    expect(useRunStore.getState().currentRunId).toBe(id);
  });
});

describe('run store: cancelRun', () => {
  beforeEach(() => {
    reset();
  });

  it('clears the lock (alias for finishRun)', () => {
    const id = useRunStore.getState().startRun();
    useRunStore.getState().cancelRun(id);
    expect(useRunStore.getState().isRunning).toBe(false);
  });

  it('is a no-op for stale runIds', () => {
    const id = useRunStore.getState().startRun();
    useRunStore.getState().cancelRun('stale-id');
    expect(useRunStore.getState().isRunning).toBe(true);
  });
});
