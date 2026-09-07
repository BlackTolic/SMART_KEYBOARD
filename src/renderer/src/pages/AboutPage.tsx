import { useEffect, useMemo, useState } from 'react';
import type { WindowDiagnostics, PluginStatus } from '@shared/types';
import { DEMO_DIAGNOSTICS, diagnosticsToText } from './AboutPage.helpers';
import styles from './AboutPage.module.css';

const NUTJS = 'https://github.com/nut-tree/nut-js';
const ELECTRON = 'https://www.electronjs.org/';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export function AboutPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.title}>About</div>
        <div className={styles.subtitle}>
          Lightweight mouse &amp; keyboard automation for desktop.
        </div>
      </header>

      <section className={styles.section}>
        <div className={styles.h2}>What it does</div>
        <p className={styles.p}>
          SmartKeyboard is a minimal Electron app that runs a sequence of
          automation steps you compose by hand. Add moves, clicks, key taps,
          typed text and delays, then hit Run.
        </p>
      </section>

      <section className={styles.section}>
        <div className={styles.h2}>Stack</div>
        <ul className={styles.list}>
          <li>Electron 32 with contextIsolation and a preload bridge</li>
          <li>React 18 + TypeScript, built with Vite</li>
          <li>
            <a href={NUTJS} target="_blank" rel="noreferrer">
              @nut-tree/nut-js
            </a>{' '}
            for cross-platform mouse &amp; keyboard simulation
          </li>
          <li>
            <a href={ELECTRON} target="_blank" rel="noreferrer">
              Electron
            </a>{' '}
            for the desktop shell
          </li>
          <li>zustand for the step list state</li>
          <li>vitest for unit tests</li>
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.h2}>Credits</div>
        <p className={styles.p}>
          Thanks to the @nut-tree contributors — this app would be much
          larger without their library. UI design is inspired by minimal,
          low-saturation palettes (Codex++ style): blue accent, soft borders,
          no decorative imagery.
        </p>
      </section>

      <DiagnosticsSection />
    </div>
  );
}

function DiagnosticsSection() {
  // Dev-only: ?diag=1 in the URL opens the diagnostics panel on
  // mount so screenshots / E2E can land on the expanded table
  // without an extra click.
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('diag') === '1';
    } catch {
      return false;
    }
  });
  const [status, setStatus] = useState<Status>('idle');
  const [rows, setRows] = useState<WindowDiagnostics[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const api = typeof window !== 'undefined' ? window.api : undefined;

  // Auto-load once the panel is expanded for the first time.
  useEffect(() => {
    if (!open || status !== 'idle') return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function refresh() {
    setStatus('loading');
    setError(null);
    try {
      if (api && typeof api.windows.diagnose === 'function') {
        const list = await api.windows.diagnose();
        setRows(list);
      } else {
        // Browser preview / no preload — show stable demo rows so the
        // screenshot still has something to render.
        setRows(DEMO_DIAGNOSTICS);
      }
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  const summary = useMemo(() => {
    if (status !== 'ready') return '';
    const total = rows.length;
    const visible = rows.filter((r) => r.isEffectivelyVisible).length;
    const procs = new Set(rows.map((r) => r.pid)).size;
    return `${total} window${total === 1 ? '' : 's'} · ${visible} effectively visible · ${procs} process${procs === 1 ? '' : 'es'}`;
  }, [rows, status]);

  async function copyAsText() {
    const text = rowsToText(rows);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setError(`clipboard: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <section className={styles.section}>
      <button
        type="button"
        className={styles.diagToggle}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="diagnostics-toggle"
      >
        <span className={styles.diagToggleText}>调试 / Diagnostics</span>
        <span className={styles.diagToggleHint}>
          {open ? '收起' : '展开'} · 列出所有可见窗口的 hwnd / pid / 进程名 / 类名 / 尺寸
        </span>
        <span className={styles.diagToggleIcon} aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <div className={styles.diagPanel}>
          <div className={styles.diagToolbar}>
            <button
              type="button"
              className={styles.diagBtn}
              onClick={refresh}
              disabled={status === 'loading'}
              data-testid="diagnostics-refresh"
            >
              {status === 'loading' ? '加载中…' : '刷新'}
            </button>
            <button
              type="button"
              className={styles.diagBtn}
              onClick={copyAsText}
              disabled={status !== 'ready' || rows.length === 0}
              data-testid="diagnostics-copy"
            >
              {copied ? '已复制 ✓' : '复制为文本'}
            </button>
            {summary && <span className={styles.diagSummary}>{summary}</span>}
          </div>

          {/* v0.6: TSPlug 状态行。诊断面板打开时一次性读取快照，
              user 重启主进程才会变（因为 dll 注册是一次性事件）。 */}
          <div className={styles.diagToolbar}>
            <PluginStatusRow />
          </div>

          {status === 'error' && (
            <div className={styles.diagError}>诊断失败：{error}</div>
          )}

          {status === 'ready' && rows.length === 0 && (
            <div className={styles.diagEmpty}>未发现任何窗口（包括被过滤的）。</div>
          )}

          {status === 'ready' && rows.length > 0 && (
            <div className={styles.diagTableWrap}>
              <table className={styles.diagTable}>
                <thead>
                  <tr>
                    <th>PID</th>
                    <th>进程名</th>
                    <th>hwnd</th>
                    <th>标题</th>
                    <th>类名</th>
                    <th>可见</th>
                    <th>宽 × 高</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={`${r.hwnd}-${r.pid}`}
                      className={
                        r.isEffectivelyVisible
                          ? styles.diagRowVisible
                          : styles.diagRowHidden
                      }
                    >
                      <td className={styles.diagMono}>{r.pid}</td>
                      <td className={styles.diagMono}>{r.processName || '—'}</td>
                      <td className={styles.diagMono}>0x{r.hwnd.toString(16)}</td>
                      <td className={styles.diagTitle}>{r.title || '(untitled)'}</td>
                      <td className={styles.diagMono}>{r.className || '—'}</td>
                      <td>
                        {r.isEffectivelyVisible ? '✓' : r.isVisible ? '~' : '×'}
                      </td>
                      <td className={styles.diagMono}>
                        {r.width} × {r.height}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {status === 'loading' && (
            <div className={styles.diagEmpty}>枚举窗口中…</div>
          )}
        </div>
      )}
    </section>
  );
}

function rowsToText(rows: WindowDiagnostics[]): string {
  // Delegate to the pure helper so the component + tests stay in
  // lockstep with the export in AboutPage.helpers.ts.
  return diagnosticsToText(rows);
}

// v0.6: TSPlug 状态行。展示在诊断面板头部，作为 "你机器上 dll 装没装 / 注册没注册" 的快查。
// 只读：不展示任何 user 配置项（SetSimMode、Reg 等由 user 在 main 进程启动时自行控制）。
function PluginStatusRow() {
  const [status, setStatus] = useState<PluginStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.plugin?.status) {
      setError('plugin API unavailable');
      return;
    }
    void api.plugin.status().then(setStatus).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, []);

  if (error) {
    return (
      <div className={styles.diagSummary}>
        TSPlug: <strong>未知</strong> · {error}
      </div>
    );
  }
  if (!status) {
    return <div className={styles.diagSummary}>TSPlug: 探测中…</div>;
  }
  if (status.available) {
    return (
      <div className={styles.diagSummary}>
        TSPlug: <strong>已加载 v{status.version}</strong> · 后台键鼠模拟可用
      </div>
    );
  }
  return (
    <div className={styles.diagSummary}>
      TSPlug: <strong>未加载</strong> · {status.error ?? 'dll 缺失或未注册'} · 当前走 nut-js fallback
    </div>
  );
}
