import { IconButton } from './IconButton';
import { useBindingStore } from '../store/binding';
import styles from './RunBar.module.css';

interface Props {
  stepCount: number;
  isRunning: boolean;
  theme: 'light' | 'dark';
  onRun: () => void;
  onCancel: () => void;
  onClear: () => void;
  onToggleTheme: () => void;
  // v0.3: opens the WindowPicker modal. The actual binding happens
  // when the user clicks a row inside the picker — this callback just
  // signals "show me the list".
  onOpenPicker: () => void;
  onUnbindWindow: () => void;
}

export function RunBar({
  stepCount,
  isRunning,
  theme,
  onRun,
  onCancel,
  onClear,
  onToggleTheme,
  onOpenPicker,
  onUnbindWindow
}: Props) {
  const boundWindow = useBindingStore((s) => s.boundWindow);
  const backgroundMode = useBindingStore((s) => s.backgroundMode);
  const setBackgroundMode = useBindingStore((s) => s.setBackgroundMode);

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <div className={styles.title}>Steps</div>
        <div className={styles.count}>{stepCount}</div>
      </div>

      <div className={styles.right}>
        <label className={styles.bgSwitch} title="Bring bound window to foreground before running">
          <input
            type="checkbox"
            checked={backgroundMode}
            disabled={!boundWindow}
            onChange={(e) => setBackgroundMode(e.target.checked)}
            aria-label="Background mode"
          />
          <span className={styles.bgSwitchLabel}>后台运行</span>
        </label>

        {boundWindow ? (
          <div className={styles.boundTag} title={`hwnd=${boundWindow.hwnd} pid=${boundWindow.pid}`}>
            <span className={styles.boundText}>
              目标：{boundWindow.title || '(untitled)'} (PID {boundWindow.pid})
            </span>
            <button
              className={styles.boundX}
              type="button"
              onClick={onUnbindWindow}
              aria-label="Unbind window"
              title="Unbind"
            >
              ×
            </button>
          </div>
        ) : (
          <IconButton
            variant="subtle"
            onClick={onOpenPicker}
            aria-label="Bind a window"
            title="Pick a visible window as the run target"
          >
            绑定窗口
          </IconButton>
        )}

        {isRunning ? (
          <IconButton variant="danger" onClick={onCancel} aria-label="Stop run">
            Stop
          </IconButton>
        ) : (
          <IconButton
            variant="primary"
            onClick={onRun}
            disabled={stepCount === 0}
            aria-label="Run steps"
          >
            Run
          </IconButton>
        )}
        <IconButton
          variant="subtle"
          onClick={onClear}
          disabled={stepCount === 0 || isRunning}
          aria-label="Clear all"
        >
          Clear
        </IconButton>
        <IconButton
          variant="ghost"
          onClick={onToggleTheme}
          aria-label="Toggle theme"
          title="Toggle theme"
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </IconButton>
      </div>
    </header>
  );
}
