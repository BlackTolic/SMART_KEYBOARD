import { useState } from 'react';
import { useStepsStore } from '../store/steps';
import { StepRow } from './StepRow';
import { IconButton } from './IconButton';
import type { StepType } from '@shared/types';
import styles from './StepEditor.module.css';

const ADD_OPTIONS: { value: StepType; label: string }[] = [
  { value: 'move', label: 'Move mouse' },
  { value: 'click', label: 'Click' },
  { value: 'doubleClick', label: 'Double click' },
  { value: 'scroll', label: 'Scroll' },
  { value: 'keyTap', label: 'Key tap' },
  { value: 'type', label: 'Type text' },
  { value: 'delay', label: 'Delay' },
  // v0.5-mini T3: the four UIA step types are now author-able
  // through the same picker as the input step types.  The "(UIA)"
  // suffix hints at the "uses UI Automation" backend.
  { value: 'invokeElement', label: 'Invoke UI element (UIA)' },
  { value: 'setText', label: 'Set text in UI element (UIA)' },
  { value: 'getText', label: 'Get text from UI element (UIA)' },
  { value: 'focusElement', label: 'Focus UI element (UIA)' }
];

interface Props {
  isRunning: boolean;
}

export function StepEditor({ isRunning }: Props) {
  const steps = useStepsStore((s) => s.steps);
  const add = useStepsStore((s) => s.add);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <section className={styles.section}>
      {isRunning ? (
        <div className={styles.lockBanner} role="status" aria-live="polite">
          <span className={styles.lockIcon} aria-hidden="true">
            ⏸
          </span>
          <span>正在运行 — 步骤已锁定</span>
        </div>
      ) : null}

      <div className={styles.headerRow}>
        <div className={styles.title}>Sequence</div>
        <div className={styles.subtitle}>
          {steps.length === 0
            ? 'No steps yet. Add one below.'
            : `${steps.length} step${steps.length === 1 ? '' : 's'} queued`}
        </div>
      </div>

      <div className={styles.list}>
        {steps.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>Build a sequence</div>
            <div className={styles.emptyHint}>
              Add steps like <code>move</code>, <code>click</code>,{' '}
              <code>type</code> to chain them.
            </div>
          </div>
        ) : (
          steps.map((s, i) => (
            <StepRow key={s.id} step={s} index={i} total={steps.length} disabled={isRunning} />
          ))
        )}
      </div>

      <div className={styles.addRow}>
        <IconButton
          variant="subtle"
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
          disabled={isRunning}
          title={isRunning ? 'Sequence is locked while running' : 'Add a new step'}
        >
          + Add step
        </IconButton>
        {pickerOpen && !isRunning ? (
          <div className={styles.picker} role="menu">
            {ADD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={styles.pickerItem}
                onClick={() => {
                  add(opt.value);
                  setPickerOpen(false);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
