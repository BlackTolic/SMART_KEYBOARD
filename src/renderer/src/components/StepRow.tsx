import { useStepsStore, type StepState } from '../store/steps';
import type { StepType, Modifier } from '@shared/types';
import { IconButton } from './IconButton';
import styles from './StepRow.module.css';

interface Props {
  step: StepState;
  index: number;
  total: number;
}

const STEP_TYPES: { value: StepType; label: string }[] = [
  { value: 'move', label: 'Move mouse' },
  { value: 'click', label: 'Click' },
  { value: 'doubleClick', label: 'Double click' },
  { value: 'scroll', label: 'Scroll' },
  { value: 'keyTap', label: 'Key tap' },
  { value: 'type', label: 'Type text' },
  { value: 'delay', label: 'Delay' }
];

const MODIFIERS: { value: Modifier; label: string }[] = [
  { value: 'ctrl', label: 'Ctrl' },
  { value: 'alt', label: 'Alt' },
  { value: 'shift', label: 'Shift' },
  { value: 'meta', label: 'Meta' }
];

function NumberField({
  value,
  onChange,
  placeholder
}: {
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
}) {
  return (
    <input
      className={styles.input}
      type="number"
      value={Number.isFinite(value) ? value : 0}
      placeholder={placeholder}
      min={0}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? 0 : Math.max(0, Number(v)));
      }}
    />
  );
}

function TextField({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      className={styles.input}
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Render the holdMs / intervalMs pair plus a "looping" tag for
 * keyTap and type steps.
 */
function RepeatFields({
  step,
  update
}: {
  step: Extract<StepState, { type: 'keyTap' | 'type' }>;
  update: (id: string, patch: Partial<StepState>) => void;
}) {
  const holdMs = step.holdMs ?? 50;
  const intervalMs = step.intervalMs ?? 0;
  const isLooping = intervalMs > 0;
  const status = step.status;
  // Show count only when actively looping; otherwise just the tag.
  const count = status === 'looping' && step.loopCount ? step.loopCount : undefined;
  return (
    <div className={styles.repeatFields}>
      <label className={styles.label}>
        <span>Hold ms</span>
        <NumberField
          value={holdMs}
          onChange={(v) => update(step.id, { holdMs: v } as Partial<StepState>)}
          placeholder="ms"
        />
      </label>
      <label className={styles.label}>
        <span>Interval ms</span>
        <NumberField
          value={intervalMs}
          onChange={(v) => update(step.id, { intervalMs: v } as Partial<StepState>)}
          placeholder="ms"
        />
      </label>
      {isLooping ? (
        <span className={styles.loopingTag} title="Auto-repeating step">
          {typeof count === 'number' ? `连点中 ${count}` : '连点中'}
        </span>
      ) : null}
    </div>
  );
}

export function StepRow({ step, index, total }: Props) {
  const update = useStepsStore((s) => s.update);
  const remove = useStepsStore((s) => s.remove);
  const moveUp = useStepsStore((s) => s.moveUp);
  const moveDown = useStepsStore((s) => s.moveDown);

  function setType(type: StepType) {
    // switching type wipes incompatible fields by re-using store default
    const step2 = useStepsStore.getState().steps.find((s) => s.id === step.id);
    if (!step2) return;
    const id = step2.id;
    useStepsStore.getState().remove(id);
    // create with new type
    useStepsStore.getState().add(type);
    // re-insert at the original index is not trivial; for simplicity just append.
    // Acceptable since type switches are rare in the minimal build.
  }

  return (
    <div
      className={[
        styles.row,
        styles[`status_${step.status}`],
        step.status === 'looping' ? styles.statusLooping : ''
      ].join(' ')}
    >
      <div className={styles.statusBar} />

      <div className={styles.index}>{index + 1}</div>

      <div className={styles.typeCol}>
        <select
          className={styles.select}
          value={step.type}
          onChange={(e) => setType(e.target.value as StepType)}
        >
          {STEP_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.params}>{renderParams(step, update)}</div>

      <div className={styles.delayCol}>
        <label className={styles.label}>
          <span>Delay</span>
          <NumberField
            value={'delayMs' in step ? (step.delayMs ?? 0) : 0}
            onChange={(v) => update(step.id, { delayMs: v } as Partial<StepState>)}
            placeholder="ms"
          />
        </label>
      </div>

      <div className={styles.actions}>
        <IconButton
          size="sm"
          onClick={() => moveUp(step.id)}
          disabled={index === 0}
          title="Move up"
          aria-label="Move up"
        >
          ↑
        </IconButton>
        <IconButton
          size="sm"
          onClick={() => moveDown(step.id)}
          disabled={index === total - 1}
          title="Move down"
          aria-label="Move down"
        >
          ↓
        </IconButton>
        <IconButton
          size="sm"
          variant="danger"
          onClick={() => remove(step.id)}
          title="Delete step"
          aria-label="Delete step"
        >
          ×
        </IconButton>
      </div>

      {step.message && step.status !== 'looping' ? (
        <div className={styles.message}>{step.message}</div>
      ) : null}
    </div>
  );
}

function renderParams(
  step: StepState,
  update: (id: string, patch: Partial<StepState>) => void
) {
  switch (step.type) {
    case 'move':
      return (
        <div className={styles.paramGroup}>
          <label className={styles.label}>
            <span>X</span>
            <NumberField
              value={step.x}
              onChange={(v) => update(step.id, { x: v } as Partial<StepState>)}
            />
          </label>
          <label className={styles.label}>
            <span>Y</span>
            <NumberField
              value={step.y}
              onChange={(v) => update(step.id, { y: v } as Partial<StepState>)}
            />
          </label>
        </div>
      );
    case 'click':
      return (
        <div className={styles.paramGroup}>
          <label className={styles.label}>
            <span>Button</span>
            <select
              className={styles.select}
              value={step.button}
              onChange={(e) =>
                update(step.id, {
                  button: e.target.value as 'left' | 'right' | 'middle'
                } as Partial<StepState>)
              }
            >
              <option value="left">left</option>
              <option value="right">right</option>
              <option value="middle">middle</option>
            </select>
          </label>
        </div>
      );
    case 'doubleClick':
      return <div className={styles.hint}>Double-click at current cursor</div>;
    case 'scroll':
      return (
        <div className={styles.paramGroup}>
          <label className={styles.label}>
            <span>dx</span>
            <NumberField
              value={step.dx}
              onChange={(v) => update(step.id, { dx: v } as Partial<StepState>)}
            />
          </label>
          <label className={styles.label}>
            <span>dy</span>
            <NumberField
              value={step.dy}
              onChange={(v) => update(step.id, { dy: v } as Partial<StepState>)}
            />
          </label>
        </div>
      );
    case 'keyTap':
      return (
        <div className={styles.paramGroup}>
          <label className={styles.label}>
            <span>Key</span>
            <TextField
              value={step.key}
              onChange={(v) => update(step.id, { key: v } as Partial<StepState>)}
              placeholder="Enter, a, F5..."
            />
          </label>
          <div className={styles.modifiers}>
            {MODIFIERS.map((m) => {
              const checked = (step.modifiers || []).includes(m.value);
              return (
                <label key={m.value} className={styles.mod}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const cur = step.modifiers || [];
                      const next = e.target.checked
                        ? [...cur, m.value]
                        : cur.filter((x) => x !== m.value);
                      update(step.id, { modifiers: next } as Partial<StepState>);
                    }}
                  />
                  {m.label}
                </label>
              );
            })}
          </div>
          <RepeatFields step={step} update={update} />
        </div>
      );
    case 'type':
      return (
        <div className={styles.paramGroup}>
          <label className={[styles.label, styles.wide].join(' ')}>
            <span>Text</span>
            <TextField
              value={step.text}
              onChange={(v) => update(step.id, { text: v } as Partial<StepState>)}
              placeholder="Type into focused field"
            />
          </label>
          <RepeatFields step={step} update={update} />
        </div>
      );
    case 'delay':
      return (
        <div className={styles.paramGroup}>
          <label className={styles.label}>
            <span>ms</span>
            <NumberField
              value={step.ms}
              onChange={(v) => update(step.id, { ms: v } as Partial<StepState>)}
            />
          </label>
        </div>
      );
    default: {
      const _exhaustive: never = step;
      void _exhaustive;
      return null;
    }
  }
}
