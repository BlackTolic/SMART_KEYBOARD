import { useEffect, useState, useCallback } from 'react';
import type { WindowInfo } from '@shared/types';
import { loadVisibleWindows, isCurrentlyBound } from './WindowPicker.helpers';
import styles from './WindowPicker.module.css';

interface WindowPickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (win: WindowInfo) => void;
  currentBound: WindowInfo | null;
}

export function WindowPicker({ open, onClose, onPick, currentBound }: WindowPickerProps) {
  const [loading, setLoading] = useState(false);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Reload the list every time the picker opens.
  useEffect(() => {
    if (!open) {
      // Reset transient state when closed so the next open starts fresh.
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadVisibleWindows(
      typeof window !== 'undefined' && window.api ? window.api.windows : undefined
    )
      .then((list) => {
        if (cancelled) return;
        console.log('Loaded visible windows:', list);
        setWindows(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setWindows([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // ESC closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handlePick = useCallback(
    (win: WindowInfo) => {
      onPick(win);
      onClose();
    },
    [onPick, onClose]
  );

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      onClick={onClose}
      role="presentation"
      data-testid="window-picker-backdrop"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="window-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 id="window-picker-title" className={styles.title}>
            选择目标窗口
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close window picker"
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          {loading && (
            <div className={styles.stateBlock}>
              <span className={styles.spinner} aria-hidden="true" />
              加载中...
            </div>
          )}

          {!loading && error && (
            <div className={styles.stateBlockError}>加载失败：{error}</div>
          )}

          {!loading && !error && windows.length === 0 && (
            <div className={styles.stateBlock}>未发现可见窗口</div>
          )}

          {!loading && !error && windows.length > 0 && (
            <ul className={styles.list} role="listbox" aria-label="Visible windows">
              {windows.map((win) => {
                const isBound = isCurrentlyBound(win, currentBound);
                return (
                  <li key={win.hwnd} role="presentation">
                    <button
                      type="button"
                      className={`${styles.row} ${isBound ? styles.rowBound : ''}`}
                      onClick={() => handlePick(win)}
                      role="option"
                      aria-selected={isBound}
                      title={win.title}
                    >
                      <span className={styles.rowTitle}>
                        {win.title || '(untitled)'}
                        {isBound && <span className={styles.boundBadge}>已绑定</span>}
                      </span>
                      <span className={styles.rowSub}>
                        {win.processName || `pid-${win.pid}`} · PID {win.pid}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
