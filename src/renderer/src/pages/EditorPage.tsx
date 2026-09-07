import { useCallback, useEffect, useRef, useState } from 'react';
import { useStepsStore } from '../store/steps';
import { useBindingStore } from '../store/binding';
import { useRunStore } from '../store/run';
import type { Step, WindowInfo, ProgressEvent } from '@shared/types';
import { RunBar } from '../components/RunBar';
import { StepEditor } from '../components/StepEditor';
import { WindowPicker } from '../components/WindowPicker';
import styles from './EditorPage.module.css';

interface Props {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function EditorPage({ theme, onToggleTheme }: Props) {
  const steps = useStepsStore((s) => s.steps);
  const setStatus = useStepsStore((s) => s.setStatus);
  const resetStatuses = useStepsStore((s) => s.resetStatuses);
  const clear = useStepsStore((s) => s.clear);

  const boundWindow = useBindingStore((s) => s.boundWindow);
  const backgroundMode = useBindingStore((s) => s.backgroundMode);
  const bindWindow = useBindingStore((s) => s.bindWindow);
  const unbindWindow = useBindingStore((s) => s.unbindWindow);
  const demoBind = useBindingStore((s) => s.demoBind);
  const add = useStepsStore((s) => s.add);
  const stepsForDemo = useStepsStore((s) => s.steps);

  // v0.4.6: read run state from the module-level run store so
  // the lock UI survives navigating to About and back. The
  // store's currentRunId is the source of truth; the progress
  // listener lives at App level (see App.tsx).
  const isRunning = useRunStore((s) => s.isRunning);
  const startRunStore = useRunStore((s) => s.startRun);
  const cancelRunStore = useRunStore((s) => s.cancelRun);

  const [pickerOpen, setPickerOpen] = useState(false);

  // Dev-only: ?demo=1 in the URL pre-binds a fake window AND adds a
  // sample keyTap step so the screenshot / E2E can show the
  // "目标：..." label, the 后台运行 switch, and the holdMs/intervalMs
  // fields. Adding &picker=1 also opens the WindowPicker modal on
  // mount so the screenshot can show the picker with a highlighted
  // "current bound" row. Adding &run=1 also flips the page into
  // "running" mode (UI lock) without actually executing a sequence —
  // used by the v0.4.2 screenshot harness to capture the locked state.
  // No-op in production usage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('demo') === '1') {
        demoBind();
        if (stepsForDemo.length === 0) {
          add('keyTap');
          add('type');
        }
      }
      if (params.get('picker') === '1') {
        setPickerOpen(true);
      }
      if (params.get('run') === '1') {
        // Drive the run store directly so the locked UI shows up
        // without actually executing a sequence.
        startRunStore();
      }
    } catch {
      /* ignore */
    }
  }, [demoBind, add, stepsForDemo.length, startRunStore]);

  // v0.4.6: scoped `inert`. v0.4.5 put `inert` on the page root,
  // which had a side-effect of making the Stop button
  // un-clickable while a run was in progress (the user could not
  // cancel the run from the UI). The fix is to scope `inert` to
  // just the step content area, NOT the entire page. The RunBar
  // (which contains the Stop button) stays interactive so the
  // user can always cancel. The StepEditor (which is what
  // React was rerendering aggressively — the lock banner, the
  // step inputs becoming disabled, etc.) is the subtree we
  // actually need to keep focus-free.
  const stepContentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stepContentRef.current;
    if (!el) return;
    if (isRunning) {
      el.setAttribute('inert', '');
    } else {
      el.removeAttribute('inert');
    }
  }, [isRunning]);

  async function handleRun() {
    if (isRunning) return;
    resetStatuses();
    // v0.4.6: ask the run store for a runId. If a run is
    // already in progress (e.g. because we navigated away and
    // back during a previous run), startRun returns the existing
    // id and we re-attach. Otherwise it generates a new id.
    const runId = startRunStore();
    try {
      // Strip the status field when sending to main.
      const clean: Step[] = steps.map(({ status, message, loopCount, ...rest }) => rest);
      // v0.5-mini T2: pass the bound window's hwnd so the runner
      // can resolve `{ kind: 'bound' }` steps (and steps that
      // don't set a target) to it. Pass it regardless of the
      // background-mode toggle — the toggle only controls whether
      // SetForegroundWindow is called (via `targetHwnd`).
      const boundHwnd = boundWindow ? boundWindow.hwnd : undefined;
      const targetHwnd = backgroundMode && boundWindow ? boundWindow.hwnd : undefined;
      await window.api.simulator.execute({
        steps: clean,
        runId,
        targetHwnd,
        boundHwnd
      });
    } catch (err) {
      // IPC error: e.g. validation rejection, no handler installed.
      // Release the lock so the user can recover without a page
      // reload. The App-level progress listener will not fire for
      // a run that never started in main, so we have to flip the
      // store ourselves here.
      console.error('run failed', err);
      cancelRunStore(runId);
    }
  }

  async function handleCancel() {
    // v0.4.6: read the current runId from the store (not local
    // state) because the page may have remounted after a
    // navigation and the local state would have a stale value.
    const currentRunId = useRunStore.getState().currentRunId;
    if (currentRunId) {
      try {
        await window.api.simulator.cancel(currentRunId);
      } catch (err) {
        console.warn('cancel request failed (ignored):', err);
      }
      // Optimistically flip the store; the App-level progress
      // listener will also fire finishRun when the cancelled
      // event reaches us, but cancelRun is a no-op when the
      // runId no longer matches, so calling it twice is safe.
      cancelRunStore(currentRunId);
    }
  }

  function handleClear() {
    clear();
  }

  function handleUnbindWindow() {
    unbindWindow();
  }

  function handlePickWindow(win: WindowInfo) {
    bindWindow(win);
  }

  return (
    <div className={styles.page}>
      <RunBar
        stepCount={steps.length}
        isRunning={isRunning}
        theme={theme}
        onRun={handleRun}
        onCancel={handleCancel}
        onClear={handleClear}
        onToggleTheme={onToggleTheme}
        onOpenPicker={() => setPickerOpen(true)}
        onUnbindWindow={handleUnbindWindow}
      />
      <div ref={stepContentRef} className={styles.stepContent}>
        <StepEditor isRunning={isRunning} />
      </div>
      <WindowPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePickWindow}
        currentBound={boundWindow}
      />
    </div>
  );
}
