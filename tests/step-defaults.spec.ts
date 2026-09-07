// v0.5-mini T3: tests for the steps store's defaultStep factory.
//
// T3 changed `defaultStep` so every step type (including the four
// new UIA step types) now ships a `target` field set to
// `{ kind: 'foreground' }`.  This file pins that contract — the
// StepRow's target-selector UI relies on `target` always being
// present, even for new step rows that the user just added.

import { describe, it, expect, beforeEach } from 'vitest';
import { useStepsStore } from '../src/renderer/src/store/steps';
import type { StepType, StepTarget, Step } from '../src/shared/types';

beforeEach(() => {
  useStepsStore.setState({ steps: [] });
});

function addAndGet(type: StepType): Step {
  useStepsStore.getState().add(type);
  const steps = useStepsStore.getState().steps;
  expect(steps.length).toBe(1);
  // The store wraps Step in StepState (adds status/loopCount/message),
  // but the underlying Step fields are the same.  We strip the runtime
  // additions for the assertion.
  const s = steps[0] as unknown as Step;
  return s;
}

describe('defaultStep carries target=foreground for all step types (v0.5-mini T3)', () => {
  const allStepTypes: StepType[] = [
    'move',
    'click',
    'doubleClick',
    'scroll',
    'keyTap',
    'type',
    'invokeElement',
    'setText',
    'getText',
    'focusElement'
  ];

  for (const type of allStepTypes) {
    it(`${type} default step has target={ kind: "foreground" }`, () => {
      const step = addAndGet(type);
      // `delay` doesn't carry a target, but every other step type
      // does (per shared/types.ts).  We assert the presence for
      // every step except delay.
      if (type === 'delay') {
        expect((step as { target?: StepTarget }).target).toBeUndefined();
        return;
      }
      const target = (step as { target?: StepTarget }).target;
      expect(target).toEqual({ kind: 'foreground' });
    });
  }
});

describe('UIA step defaults (v0.5-mini T3)', () => {
  it('invokeElement default has selector={ name: "" }', () => {
    const step = addAndGet('invokeElement');
    if (step.type !== 'invokeElement') throw new Error('wrong type');
    expect(step.selector).toEqual({ name: '' });
    expect(step.target).toEqual({ kind: 'foreground' });
  });

  it('setText default has selector={ name: "" } and text=""', () => {
    const step = addAndGet('setText');
    if (step.type !== 'setText') throw new Error('wrong type');
    expect(step.selector).toEqual({ name: '' });
    expect(step.text).toBe('');
  });

  it('getText default has selector={ name: "" }', () => {
    const step = addAndGet('getText');
    if (step.type !== 'getText') throw new Error('wrong type');
    expect(step.selector).toEqual({ name: '' });
  });

  it('focusElement default has selector={ name: "" }', () => {
    const step = addAndGet('focusElement');
    if (step.type !== 'focusElement') throw new Error('wrong type');
    expect(step.selector).toEqual({ name: '' });
  });
});

describe('store mutations: update target / selector (v0.5-mini T3)', () => {
  it('update(id, { target: { kind: "hwnd", hwnd: 42 } }) persists', () => {
    useStepsStore.getState().add('invokeElement');
    const id = useStepsStore.getState().steps[0].id;
    useStepsStore
      .getState()
      .update(id, { target: { kind: 'hwnd', hwnd: 42 } } as Partial<Step>);
    const s = useStepsStore.getState().steps[0];
    expect((s as { target?: StepTarget }).target).toEqual({ kind: 'hwnd', hwnd: 42 });
  });

  it('update(id, { selector: { automationId: "btn" } }) persists', () => {
    useStepsStore.getState().add('invokeElement');
    const id = useStepsStore.getState().steps[0].id;
    useStepsStore
      .getState()
      .update(id, { selector: { automationId: 'btn' } } as Partial<Step>);
    const s = useStepsStore.getState().steps[0] as unknown as Step;
    if (s.type !== 'invokeElement') throw new Error('wrong type');
    expect(s.selector).toEqual({ automationId: 'btn' });
  });

  it('id and type are immutable through update()', () => {
    useStepsStore.getState().add('click');
    const step0 = useStepsStore.getState().steps[0];
    useStepsStore.getState().update(step0.id, { id: 'new-id', type: 'move' } as Partial<Step>);
    const step1 = useStepsStore.getState().steps[0];
    expect(step1.id).toBe(step0.id);
    expect(step1.type).toBe('click');
  });
});
