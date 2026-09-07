import { useEffect, useState } from 'react';
import { Sidebar, type PageId } from './components/Sidebar';
import { EditorPage } from './pages/EditorPage';
import { AboutPage } from './pages/AboutPage';
import { useRunStore } from './store/run';
import { useStepsStore } from './store/steps';
import type { ProgressEvent } from '@shared/types';

type Theme = 'light' | 'dark';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = window.localStorage.getItem('sk:theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* localStorage may be unavailable */
  }
  return 'light';
}

function getInitialPage(): PageId {
  // Dev-only: ?about=1 in the URL opens the About page on mount so
  // screenshots / E2E can land directly on the diagnostic panel
  // without a click.
  if (typeof window === 'undefined') return 'editor';
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('about') === '1') return 'about';
  } catch {
    /* ignore */
  }
  return 'editor';
}

export function App() {
  const [page, setPage] = useState<PageId>(getInitialPage);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem('sk:theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

  // v0.4.6: progress listener lives at App level so it survives
  // navigation to About and back. Previously the listener was
  // registered inside EditorPage's useSimulatorProgress hook,
  // which unsubscribed on unmount — that meant if the user
  // clicked About mid-run, the EditorPage lost its progress
  // stream and the lock UI never updated on remount.
  //
  // Strategy: the listener subscribes only when a run is in
  // progress (currentRunId !== null). The handler filters events
  // by runId so a late "done" event for a previous run doesn't
  // unlock a new run. Both the step statuses (via useStepsStore)
  // and the run lock (via useRunStore) are written from here.
  const setStatus = useStepsStore((s) => s.setStatus);
  const currentRunId = useRunStore((s) => s.currentRunId);
  useEffect(() => {
    if (!currentRunId) return;
    if (typeof window === 'undefined' || !window.api) return;
    const myRunId = currentRunId;
    const unsub = window.api.simulator.onProgress((e: ProgressEvent) => {
      if (e.runId !== myRunId) return;
      setStatus(e.stepId, e.status, e.message, e.loopCount);
      const isLast =
        typeof e.index === 'number' && typeof e.total === 'number'
          ? e.index === e.total - 1
          : true;
      // v0.4.3: an 'error' for any step (real failure or user
      // cancel) ends the run; a 'done' on the LAST step also
      // ends the run naturally.
      if (e.status === 'error' || (e.status === 'done' && isLast)) {
        useRunStore.getState().finishRun(e.runId);
      }
    });
    return unsub;
  }, [currentRunId, setStatus]);

  return (
    <div className="app-shell">
      <Sidebar current={page} onChange={setPage} />
      <main className="app-main">
        {page === 'editor' ? (
          <EditorPage theme={theme} onToggleTheme={toggleTheme} />
        ) : (
          <AboutPage />
        )}
      </main>
    </div>
  );
}
