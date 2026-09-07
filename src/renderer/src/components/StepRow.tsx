import { useStepsStore, type StepState } from '../store/steps';
import type { StepType, Modifier, StepTarget, ElementSelector } from '@shared/types';
import { IconButton } from './IconButton';
import styles from './StepRow.module.css';

interface Props {
  step: StepState;
  index: number;
  total: number;
  // v0.4.2: when true, every edit affordance in the row is disabled.
  // The store still accepts mutations; the UI just refuses to call them.
  disabled?: boolean;
}

const STEP_TYPES: { value: StepType; label: string }[] = [
  { value: 'move', label: 'Move mouse' },
  { value: 'click', label: 'Click' },
  { value: 'doubleClick', label: 'Double click' },
  { value: 'scroll', label: 'Scroll' },
  { value: 'keyTap', label: 'Key tap' },
  { value: 'type', label: 'Type text' },
  { value: 'delay', label: 'Delay' },
  // v0.5-mini T3: the four UIA step types live alongside the input
  // step types in the same dropdown.  The "UIA" suffix in the
  // label hints at the "uses UI Automation" backend.
  { value: 'invokeElement', label: 'Invoke UI element (UIA)' },
  { value: 'setText', label: 'Set text in UI element (UIA)' },
  { value: 'getText', label: 'Get text from UI element (UIA)' },
  { value: 'focusElement', label: 'Focus UI element (UIA)' }
];

const MODIFIERS: { value: Modifier; label: string }[] = [
  { value: 'ctrl', label: 'Ctrl' },
  { value: 'alt', label: 'Alt' },
  { value: 'shift', label: 'Shift' },
  { value: 'meta', label: 'Meta' }
];

/**
 * UIA controlType labels.  Mirrors src/main/uia.ts CONTROL_TYPE_MAP.
 * Kept short on purpose: the user usually wants one of the first
 * four (Button, Edit, Text, CheckBox).
 */
const CONTROL_TYPES: { value: string; label: string }[] = [
  { value: 'Button', label: 'Button' },
  { value: 'Edit', label: 'Edit (text box)' },
  { value: 'Text', label: 'Text (read-only)' },
  { value: 'CheckBox', label: 'CheckBox' },
  { value: 'RadioButton', label: 'RadioButton' },
  { value: 'ComboBox', label: 'ComboBox' },
  { value: 'List', label: 'List' },
  { value: 'ListItem', label: 'ListItem' },
  { value: 'Menu', label: 'Menu' },
  { value: 'MenuItem', label: 'MenuItem' },
  { value: 'Tab', label: 'Tab' },
  { value: 'Tree', label: 'Tree' },
  { value: 'TreeItem', label: 'TreeItem' },
  { value: 'Window', label: 'Window' },
  { value: 'Pane', label: 'Pane' },
  { value: 'Hyperlink', label: 'Hyperlink' }
];

function NumberField({
  value,
  onChange,
  placeholder,
  disabled
}: {
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      className={styles.input}
      type="number"
      value={Number.isFinite(value) ? value : 0}
      placeholder={placeholder}
      min={0}
      disabled={disabled}
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
  placeholder,
  disabled
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      className={styles.input}
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
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
  update,
  disabled
}: {
  step: Extract<StepState, { type: 'keyTap' | 'type' }>;
  update: (id: string, patch: Partial<StepState>) => void;
  disabled?: boolean;
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
          disabled={disabled}
        />
      </label>
      <label className={styles.label}>
        <span>Interval ms</span>
        <NumberField
          value={intervalMs}
          onChange={(v) => update(step.id, { intervalMs: v } as Partial<StepState>)}
          placeholder="ms"
          disabled={disabled}
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

/**
 * v0.5-mini T3: target selector — which window should this step
 * run against?  Four kinds, matching `StepTarget`:
 *   - foreground: the current foreground window at dispatch time
 *   - bound:      the RunBar-bound window (most common)
 *   - hwnd:       an explicit hwnd
 *   - title:      first visible window whose title matches
 *
 * The selector is rendered as a row of radio buttons plus a single
 * conditional field (hwnd number input, or title text input).  We
 * intentionally keep the design flat — the StepRow already has
 * three grid columns and we don't want to add a fourth row of
 * nested controls.
 */
function TargetRow({
  step,
  update,
  disabled
}: {
  step: StepState;
  update: (id: string, patch: Partial<StepState>) => void;
  disabled?: boolean;
}) {
  // `delay` steps don't address a window at all.  Render a hint
  // instead of an interactive target row.
  if (step.type === 'delay') {
    return (
      <div className={styles.targetRow}>
        <span className={styles.targetHint}>target: n/a (delay has no window)</span>
      </div>
    );
  }
  const target: StepTarget = (step as { target?: StepTarget }).target ?? { kind: 'foreground' };
  function setTarget(next: StepTarget) {
    update(step.id, { target: next } as Partial<StepState>);
  }
  return (
    <div className={styles.targetRow}>
      <span className={styles.targetLabel}>target</span>
      <div className={styles.targetRadios}>
        <label className={styles.targetRadio}>
          <input
            type="radio"
            name={`target-${step.id}`}
            checked={target.kind === 'foreground'}
            disabled={disabled}
            onChange={() => setTarget({ kind: 'foreground' })}
          />
          <span>前景</span>
        </label>
        <label className={styles.targetRadio}>
          <input
            type="radio"
            name={`target-${step.id}`}
            checked={target.kind === 'bound'}
            disabled={disabled}
            onChange={() => setTarget({ kind: 'bound' })}
          />
          <span>绑定窗口</span>
        </label>
        <label className={styles.targetRadio}>
          <input
            type="radio"
            name={`target-${step.id}`}
            checked={target.kind === 'hwnd'}
            disabled={disabled}
            onChange={() =>
              setTarget({ kind: 'hwnd', hwnd: target.kind === 'hwnd' ? target.hwnd : 0 })
            }
          />
          <span>hwnd</span>
        </label>
        {target.kind === 'hwnd' ? (
          <input
            className={`${styles.input} ${styles.targetExtra}`}
            type="number"
            min={0}
            value={target.hwnd}
            placeholder="hwnd"
            disabled={disabled}
            onChange={(e) =>
              setTarget({ kind: 'hwnd', hwnd: Math.max(0, Number(e.target.value) || 0) })
            }
          />
        ) : null}
        <label className={styles.targetRadio}>
          <input
            type="radio"
            name={`target-${step.id}`}
            checked={target.kind === 'title'}
            disabled={disabled}
            onChange={() =>
              setTarget({ kind: 'title', title: target.kind === 'title' ? target.title : '' })
            }
          />
          <span>标题</span>
        </label>
        {target.kind === 'title' ? (
          <input
            className={`${styles.input} ${styles.targetExtra}`}
            type="text"
            value={target.title}
            placeholder="window title"
            disabled={disabled}
            onChange={(e) => setTarget({ kind: 'title', title: e.target.value })}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * v0.5-mini T3: UIA selector editor.  Lets the user pick a
 * strategy (automationId / name / controlType / className) and
 * fill in the discriminator.  The four strategies correspond to
 * the four `ElementSelector` shapes the renderer can author; the
 * runner / UIA backend may not support every one (e.g. className
 * and xpath are deferred to v0.5-full — they show up here but
 * the runner will surface a clear error at run time).
 */
function SelectorEditor({
  selector,
  onChange,
  disabled
}: {
  selector: ElementSelector;
  onChange: (next: ElementSelector) => void;
  disabled?: boolean;
}) {
  // Decide the "strategy" from the current selector.  We pick the
  // first matching discriminator in priority order
  // (automationId > name > controlType > className).
  let strategy: 'automationId' | 'name' | 'controlType' | 'className' = 'name';
  let value = '';
  let controlType = 'Button';
  if ('automationId' in selector) {
    strategy = 'automationId';
    value = selector.automationId;
  } else if ('name' in selector && !('controlType' in selector) && !('className' in selector)) {
    strategy = 'name';
    // The `name` discriminator on the bare { name } shape is
    // required, but TypeScript still widens it to `string |
    // undefined` because the same `name` field exists as optional
    // on the { controlType, name? } and { className, name? }
    // shapes.  Cast back to string to satisfy the assignment.
    value = (selector as { name: string }).name;
  } else if ('controlType' in selector) {
    strategy = 'controlType';
    controlType = selector.controlType;
    value = selector.name ?? '';
  } else if ('className' in selector) {
    strategy = 'className';
    controlType = selector.className;
    value = selector.name ?? '';
  }
  return (
    <div className={styles.selectorEditor}>
      <label className={styles.label}>
        <span>Match by</span>
        <select
          className={styles.select}
          value={strategy}
          disabled={disabled}
          onChange={(e) => {
            const s = e.target.value as typeof strategy;
            if (s === 'automationId') {
              onChange({ automationId: value });
            } else if (s === 'name') {
              onChange({ name: value });
            } else if (s === 'controlType') {
              onChange({ controlType, name: value || undefined });
            } else {
              onChange({ className: controlType, name: value || undefined });
            }
          }}
        >
          <option value="automationId">AutomationId</option>
          <option value="name">Name (label)</option>
          <option value="controlType">ControlType (+ name)</option>
          <option value="className">className (+ name)</option>
        </select>
      </label>
      {strategy === 'controlType' ? (
        <label className={styles.label}>
          <span>Control type</span>
          <select
            className={styles.select}
            value={controlType}
            disabled={disabled}
            onChange={(e) => onChange({ controlType: e.target.value, name: value || undefined })}
          >
            {CONTROL_TYPES.map((ct) => (
              <option key={ct.value} value={ct.value}>
                {ct.label}
              </option>
            ))}
          </select>
        </label>
      ) : strategy === 'className' ? (
        <label className={styles.label}>
          <span>Class</span>
          <TextField
            value={controlType}
            onChange={(v) => onChange({ className: v, name: value || undefined })}
            placeholder="Win32 class"
            disabled={disabled}
          />
        </label>
      ) : null}
      <label className={[styles.label, styles.wide].join(' ')}>
        <span>{strategy === 'automationId' ? 'AutomationId' : strategy === 'controlType' || strategy === 'className' ? 'Name (optional)' : 'Name'}</span>
        <TextField
          value={value}
          onChange={(v) => {
            if (strategy === 'automationId') onChange({ automationId: v });
            else if (strategy === 'name') onChange({ name: v });
            else if (strategy === 'controlType') onChange({ controlType, name: v || undefined });
            else onChange({ className: controlType, name: v || undefined });
          }}
          placeholder={
            strategy === 'name' || strategy === 'controlType' || strategy === 'className'
              ? 'e.g. 确定 / OK / 登录'
              : 'e.g. btnSubmit'
          }
          disabled={disabled}
        />
      </label>
    </div>
  );
}

export function StepRow({ step, index, total, disabled = false }: Props) {
  const update = useStepsStore((s) => s.update);
  const remove = useStepsStore((s) => s.remove);
  const moveUp = useStepsStore((s) => s.moveUp);
  const moveDown = useStepsStore((s) => s.moveDown);

  function setType(type: StepType) {
    // v0.5-mini T3: switching the type wipes incompatible fields by
    // building a fresh default of the new type and re-attaching
    // the same id (so React keys stay stable).  We replace the
    // array slot in place so the step's position is preserved.
    const idx = useStepsStore.getState().steps.findIndex((s) => s.id === step.id);
    if (idx < 0) return;
    // Use the add() then move + remove dance: simpler than
    // reaching into the store internals, and keeps the exhaustive
    // switch in defaultStep as the single source of truth.
    useStepsStore.getState().add(type);
    const all = useStepsStore.getState().steps;
    const newStep = all[all.length - 1];
    useStepsStore.setState((state) => {
      // Insert newStep at idx, then drop the old step from its
      // original (now idx+1) position.
      const next = state.steps.slice();
      next.splice(idx, 0, next.splice(next.length - 1, 1)[0]);
      return { steps: next };
    });
    // Suppress an unused variable warning for the temp `newStep`
    // (we used splice to move it instead of capturing the ref).
    void newStep;
  }

  return (
    <div
      className={[
        styles.row,
        styles[`status_${step.status}`],
        step.status === 'looping' ? styles.statusLooping : '',
        disabled ? styles.locked : ''
      ].join(' ')}
    >
      <div className={styles.statusBar} />

      <div className={styles.index}>{index + 1}</div>

      <div className={styles.typeCol}>
        <select
          className={styles.select}
          value={step.type}
          disabled={disabled}
          onChange={(e) => setType(e.target.value as StepType)}
        >
          {STEP_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.params}>{renderParams(step, update, disabled)}</div>

      <div className={styles.delayCol}>
        <label className={styles.label}>
          <span>Delay</span>
          <NumberField
            value={'delayMs' in step ? (step.delayMs ?? 0) : 0}
            onChange={(v) => update(step.id, { delayMs: v } as Partial<StepState>)}
            placeholder="ms"
            disabled={disabled}
          />
        </label>
      </div>

      <div className={styles.actions}>
        <IconButton
          size="sm"
          onClick={() => moveUp(step.id)}
          disabled={disabled || index === 0}
          title={disabled ? 'Locked while running' : 'Move up'}
          aria-label="Move up"
        >
          ↑
        </IconButton>
        <IconButton
          size="sm"
          onClick={() => moveDown(step.id)}
          disabled={disabled || index === total - 1}
          title={disabled ? 'Locked while running' : 'Move down'}
          aria-label="Move down"
        >
          ↓
        </IconButton>
        <IconButton
          size="sm"
          variant="danger"
          onClick={() => remove(step.id)}
          disabled={disabled}
          title={disabled ? 'Locked while running' : 'Delete step'}
          aria-label="Delete step"
        >
          ×
        </IconButton>
      </div>

      <div className={styles.targetRowCol}>
        <TargetRow step={step} update={update} disabled={disabled} />
      </div>

      {step.message && step.status !== 'looping' ? (
        <div className={styles.message}>{step.message}</div>
      ) : null}
    </div>
  );
}

function renderParams(
  step: StepState,
  update: (id: string, patch: Partial<StepState>) => void,
  disabled: boolean
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
              disabled={disabled}
            />
          </label>
          <label className={styles.label}>
            <span>Y</span>
            <NumberField
              value={step.y}
              onChange={(v) => update(step.id, { y: v } as Partial<StepState>)}
              disabled={disabled}
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
              disabled={disabled}
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
              disabled={disabled}
            />
          </label>
          <label className={styles.label}>
            <span>dy</span>
            <NumberField
              value={step.dy}
              onChange={(v) => update(step.id, { dy: v } as Partial<StepState>)}
              disabled={disabled}
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
              disabled={disabled}
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
                    disabled={disabled}
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
          <RepeatFields step={step} update={update} disabled={disabled} />
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
              disabled={disabled}
            />
          </label>
          <RepeatFields step={step} update={update} disabled={disabled} />
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
              disabled={disabled}
            />
          </label>
        </div>
      );
    // v0.5-mini T3: full UIA step editors.  The selector row is
    // the same for all four (SelectorEditor), the parameter column
    // varies: invokeElement has no params, setText adds a text
    // field, getText adds a variableName field, focusElement has
    // no params.
    case 'invokeElement':
      return (
        <div className={styles.paramGroup}>
          <SelectorEditor
            selector={step.selector}
            onChange={(sel) => update(step.id, { selector: sel } as Partial<StepState>)}
            disabled={disabled}
          />
        </div>
      );
    case 'setText':
      return (
        <div className={styles.paramGroup}>
          <SelectorEditor
            selector={step.selector}
            onChange={(sel) => update(step.id, { selector: sel } as Partial<StepState>)}
            disabled={disabled}
          />
          <label className={[styles.label, styles.wide].join(' ')}>
            <span>Text</span>
            <TextField
              value={step.text}
              onChange={(v) => update(step.id, { text: v } as Partial<StepState>)}
              placeholder="Value to set (UIA ValuePattern.SetValue)"
              disabled={disabled}
            />
          </label>
        </div>
      );
    case 'getText':
      return (
        <div className={styles.paramGroup}>
          <SelectorEditor
            selector={step.selector}
            onChange={(sel) => update(step.id, { selector: sel } as Partial<StepState>)}
            disabled={disabled}
          />
          <label className={styles.label}>
            <span>Variable</span>
            <TextField
              value={step.variableName ?? ''}
              onChange={(v) =>
                update(step.id, { variableName: v } as Partial<StepState>)
              }
              placeholder="(optional, v0.5-full)"
              disabled={disabled}
            />
          </label>
        </div>
      );
    case 'focusElement':
      return (
        <div className={styles.paramGroup}>
          <SelectorEditor
            selector={step.selector}
            onChange={(sel) => update(step.id, { selector: sel } as Partial<StepState>)}
            disabled={disabled}
          />
        </div>
      );
    default: {
      const _exhaustive: never = step;
      void _exhaustive;
      return null;
    }
  }
}
