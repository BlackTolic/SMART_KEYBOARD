import { useEffect, useState } from 'react';
import { Sidebar, type PageId } from './components/Sidebar';
import { EditorPage } from './pages/EditorPage';
import { AboutPage } from './pages/AboutPage';

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
