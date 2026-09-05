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
  { value: 'delay', label: 'Delay' }
];

export function StepEditor() {
  const steps = useStepsStore((s) => s.steps);
  const add = useStepsStore((s) => s.add);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <section className={styles.section}>
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
            <StepRow key={s.id} step={s} index={i} total={steps.length} />
          ))
        )}
      </div>

      <div className={styles.addRow}>
        <IconButton
          variant="subtle"
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
        >
          + Add step
        </IconButton>
        {pickerOpen ? (
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
