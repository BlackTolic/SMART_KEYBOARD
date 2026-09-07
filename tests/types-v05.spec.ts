// v0.5-mini: tests for the Step type extensions (StepTarget,
// ElementSelector, new UIA step types, per-step target on
// existing step types).
//
// These tests don't run a runner — they exercise the TYPE
// definitions at runtime by constructing values of each
// step variant and asserting shape. Type-time correctness is
// enforced separately by `npm run typecheck`.

import { describe, it, expect } from 'vitest';

import type {
  Step,
  StepTarget,
  ElementSelector,
  DEFAULT_TARGET
} from '../src/shared/types';
import { DEFAULT_TARGET as ImportedDefault } from '../src/shared/types';

describe('StepTarget (v0.5-mini)', () => {
  it('exposes the four kind variants', () => {
    const variants: StepTarget[] = [
      { kind: 'foreground' },
      { kind: 'bound' },
      { kind: 'hwnd', hwnd: 0x1234 },
      { kind: 'title', title: 'Notepad' }
    ];
    expect(variants.length).toBe(4);
  });

  it('DEFAULT_TARGET is { kind: "foreground" }', () => {
    // Compile-time + runtime check. The type re-export is
    //   `export const DEFAULT_TARGET: StepTarget = ...`
    // so we can read it back through the type alias and the
    // runtime constant.
    const t: StepTarget = ImportedDefault;
    expect(t).toEqual({ kind: 'foreground' });
    // The DEFAULT_TARGET type alias is also a "shape" we can
    // construct; here we just confirm the alias exists.
    const _alias: typeof DEFAULT_TARGET = { kind: 'foreground' };
    expect(_alias).toBeDefined();
  });
});

describe('ElementSelector (v0.5-mini)', () => {
  it('supports the five selector shapes', () => {
    const variants: ElementSelector[] = [
      { automationId: 'btnSubmit' },
      { name: '确定' },
      { controlType: 'Button' },
      { controlType: 'Button', name: '确定' },
      { className: 'Button' },
      { className: 'Button', name: 'OK' },
      { xpath: '/Window[1]/Button[2]' }
    ];
    expect(variants.length).toBe(7);
  });
});

describe('Step extensions (v0.5-mini)', () => {
  it('all four new UIA step types are accepted', () => {
    const steps: Step[] = [
      { id: 'a', type: 'invokeElement', selector: { automationId: 'btn' } },
      { id: 'b', type: 'setText', selector: { name: 'Search' }, text: 'hi' },
      { id: 'c', type: 'getText', selector: { controlType: 'Edit' } },
      { id: 'd', type: 'focusElement', selector: { xpath: '/Window/Edit' } }
    ];
    expect(steps.map((s) => s.type)).toEqual([
      'invokeElement',
      'setText',
      'getText',
      'focusElement'
    ]);
  });

  it('new UIA steps accept optional target and delayMs', () => {
    const step: Step = {
      id: 'a',
      type: 'invokeElement',
      selector: { name: 'OK' },
      target: { kind: 'hwnd', hwnd: 0xbeef },
      delayMs: 100
    };
    expect(step.type).toBe('invokeElement');
    if (step.type === 'invokeElement') {
      expect(step.target).toEqual({ kind: 'hwnd', hwnd: 0xbeef });
      expect(step.delayMs).toBe(100);
    }
  });

  it('existing 7 step types still accept their original fields (backward compat)', () => {
    const steps: Step[] = [
      { id: '1', type: 'move', x: 10, y: 20 },
      { id: '2', type: 'click', button: 'left' },
      { id: '3', type: 'doubleClick' },
      { id: '4', type: 'scroll', dx: 0, dy: 1 },
      { id: '5', type: 'keyTap', key: 'Enter' },
      { id: '6', type: 'type', text: 'hello' },
      { id: '7', type: 'delay', ms: 50 }
    ];
    expect(steps.length).toBe(7);
  });

  it('existing 7 step types now also accept optional target', () => {
    // Each existing step type should compile with an added
    // `target` field. If the type union forgot any one, tsc
    // will fail on this file.
    const steps: Step[] = [
      { id: '1', type: 'move', x: 1, y: 2, target: { kind: 'bound' } },
      { id: '2', type: 'click', button: 'left', target: { kind: 'foreground' } },
      { id: '3', type: 'doubleClick', target: { kind: 'hwnd', hwnd: 0x1234 } },
      { id: '4', type: 'scroll', dx: 0, dy: 1, target: { kind: 'title', title: 'X' } },
      {
        id: '5',
        type: 'keyTap',
        key: 'A',
        target: { kind: 'bound' }
      },
      {
        id: '6',
        type: 'type',
        text: 'x',
        target: { kind: 'bound' }
      }
      // delay intentionally has no target: it doesn't address a window.
    ];
    expect(steps.length).toBe(6);
  });

  it('delay step is unchanged (no target field)', () => {
    const s: Step = { id: '7', type: 'delay', ms: 50 };
    expect(s.type).toBe('delay');
    if (s.type === 'delay') {
      expect(s.ms).toBe(50);
    }
  });
});
