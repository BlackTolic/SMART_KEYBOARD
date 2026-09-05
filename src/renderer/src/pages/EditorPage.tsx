import { useCallback, useEffect, useState } from 'react';
import { useStepsStore } from '../store/steps';
import { useBindingStore } from '../store/binding';
import type { Step, WindowInfo } from '@shared/types';
import { RunBar } from '../components/RunBar';
import { StepEditor } from '../components/StepEditor';
import { WindowPicker } from '../components/WindowPicker';
import { useSimulatorProgress } from '../hooks/useApi';
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

  const [runId] = useState(() => crypto.randomUUID());
  const [isRunning, setIsRunning] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Dev-only: ?demo=1 in the URL pre-binds a fake window AND adds a
  // sample keyTap step so the screenshot / E2E can show the
  // "目标：..." label, the 后台运行 switch, and the holdMs/intervalMs
  // fields. Adding &picker=1 also opens the WindowPicker modal on
  // mount so the screenshot can show the picker with a highlighted
  // "current bound" row. No-op in production usage.
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
    } catch {
      /* ignore */
    }
  }, [demoBind, add, stepsForDemo.length]);

  const handleProgress = useCallback(
    (e: {
      runId: string;
      stepId: string;
      status: 'idle' | 'running' | 'done' | 'error' | 'looping';
      message?: string;
      loopCount?: number;
    }) => {
      if (e.runId !== runId) return;
      setStatus(e.stepId, e.status, e.message, e.loopCount);
    },
    [runId, setStatus]
  );

  useSimulatorProgress(handleProgress);

  async function handleRun() {
    if (isRunning) return;
    resetStatuses();
    try {
      // Strip the status field when sending to main.
      const clean: Step[] = steps.map(({ status, message, loopCount, ...rest }) => rest);
      // When background mode is on AND a window is bound, pass the
      // hwnd to the runner. Otherwise omit it (defaults to no switch).
      const targetHwnd = backgroundMode && boundWindow ? boundWindow.hwnd : undefined;
      await window.api.simulator.execute({ steps: clean, runId, targetHwnd });
     setIsRunning(true);
    } catch (err) {
      console.error('run failed', err);
    } finally {
      console.log('run finished');
      // setIsRunning(false);
    }
  }

  async function handleCancel() {
    await window.api.simulator.cancel(runId);
    setIsRunning(false);
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
      {JSON.stringify(isRunning)}
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
      <StepEditor />
      <WindowPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePickWindow}
        currentBound={boundWindow}
      />
    </div>
  );
}
