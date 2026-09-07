// v0.5-mini T3: tests for the UIA wrapper — pure-function half.
//
// T3 replaces the T1 stub with a real PowerShell + .NET UIA backend
// (see src/main/uia.ts header for the rationale).  This file pins
// the parts of the contract that don't need a real PowerShell:
//
//   1. Selector → strategy mapping (the priority that T3's
//      PowerShell script generators dispatch on).
//   2. StepTarget → ResolvedTarget resolution.
//   3. The platform-gate (every entry point returns the documented
//      null / [] / no-op when not on Windows).
//   4. The unsupported-selector gate (className / xpath throw
//      UiaBackendUnavailableError on the Windows path; they're
//      promised for v0.5-full).
//
// The Windows half (real PowerShell script generation, mock-spawn
// behaviour, cache semantics) lives in tests/uia-backend.spec.ts.

import { describe, it, expect, beforeEach } from 'vitest';

import {
  resolveSelector,
  resolveTarget,
  findElement,
  listElementsInWindow,
  invokeElement,
  setElementText,
  getElementText,
  focusElement,
  UiaBackendUnavailableError,
  __test__
} from '../src/main/uia';

import type { UIAElementHandle, UIElementInfo } from '../src/main/uia';
import type { ElementSelector, StepTarget } from '../src/shared/types';

const originalPlatform = process.platform;

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
});

/**
 * Build a minimal valid UIAElementHandle.  Tests that don't care
 * about the handle's contents use this so they don't have to
 * re-construct the full shape.
 */
function fakeHandle(selector: ElementSelector = { name: 'fake' }): UIAElementHandle {
  const info: UIElementInfo = {
    name: 'fake',
    automationId: '',
    controlType: 'Button',
    className: '',
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isEnabled: true,
    isVisible: true
  };
  return { hwnd: 0x1234, selector, found: info };
}

describe('resolveSelector (v0.5-mini)', () => {
  it('maps { automationId } → automationId strategy', () => {
    const s: ElementSelector = { automationId: 'btnSubmit' };
    expect(resolveSelector(s)).toEqual({ kind: 'automationId', value: 'btnSubmit' });
  });

  it('maps bare { name } → name strategy (not controlType)', () => {
    const s: ElementSelector = { name: '确定' };
    expect(resolveSelector(s)).toEqual({ kind: 'name', value: '确定' });
  });

  it('maps { controlType } → controlType strategy', () => {
    const s: ElementSelector = { controlType: 'Button' };
    expect(resolveSelector(s)).toEqual({ kind: 'controlType', controlType: 'Button' });
  });

  it('maps { controlType, name } → controlType strategy with name filter', () => {
    const s: ElementSelector = { controlType: 'Button', name: '确定' };
    expect(resolveSelector(s)).toEqual({
      kind: 'controlType',
      controlType: 'Button',
      name: '确定'
    });
  });

  it('maps { className } → className strategy', () => {
    const s: ElementSelector = { className: 'Button' };
    expect(resolveSelector(s)).toEqual({ kind: 'className', className: 'Button' });
  });

  it('maps { className, name } → className strategy with name filter', () => {
    const s: ElementSelector = { className: 'Button', name: 'OK' };
    expect(resolveSelector(s)).toEqual({
      kind: 'className',
      className: 'Button',
      name: 'OK'
    });
  });

  it('maps { xpath } → xpath strategy (last-resort)', () => {
    const s: ElementSelector = { xpath: '/Window[1]/Button[2]' };
    expect(resolveSelector(s)).toEqual({ kind: 'xpath', value: '/Window[1]/Button[2]' });
  });

  it('preserves the spec order: automationId > name > controlType > className > xpath', () => {
    const order: Array<[ElementSelector, string]> = [
      [{ automationId: 'a' }, 'automationId'],
      [{ name: 'n' }, 'name'],
      [{ controlType: 'c' }, 'controlType'],
      [{ className: 'cl' }, 'className'],
      [{ xpath: 'x' }, 'xpath']
    ];
    for (const [sel, expectedKind] of order) {
      expect(resolveSelector(sel).kind).toBe(expectedKind);
    }
  });
});

describe('resolveTarget (v0.5-mini)', () => {
  it('returns foreground hwnd for { kind: "foreground" }', () => {
    const t: StepTarget = { kind: 'foreground' };
    const r = resolveTarget(t, { boundHwnd: 100, foregroundHwnd: 200 });
    expect(r.hwnd).toBe(200);
    expect(r.source).toEqual({ kind: 'foreground' });
  });

  it('returns bound hwnd for { kind: "bound" }', () => {
    const t: StepTarget = { kind: 'bound' };
    const r = resolveTarget(t, { boundHwnd: 100, foregroundHwnd: 200 });
    expect(r.hwnd).toBe(100);
    expect(r.source).toEqual({ kind: 'bound' });
  });

  it('returns explicit hwnd for { kind: "hwnd" }', () => {
    const t: StepTarget = { kind: 'hwnd', hwnd: 0xabcd };
    const r = resolveTarget(t, { boundHwnd: 100, foregroundHwnd: 200 });
    expect(r.hwnd).toBe(0xabcd);
    expect(r.source).toEqual({ kind: 'hwnd', hwnd: 0xabcd });
  });

  it('matches title against the knownTitles map (first hit wins)', () => {
    const t: StepTarget = { kind: 'title', title: 'Notepad' };
    const known = new Map<number, string>([
      [111, 'Other window'],
      [222, 'Notepad'],
      [333, 'Notepad']
    ]);
    const r = resolveTarget(t, { boundHwnd: 0, foregroundHwnd: 0, knownTitles: known });
    expect(r.hwnd).toBe(222);
    expect(r.source).toEqual(t);
  });

  it('returns hwnd=0 when the title is not in the map', () => {
    const t: StepTarget = { kind: 'title', title: 'Missing' };
    const known = new Map<number, string>([[111, 'Other']]);
    const r = resolveTarget(t, { boundHwnd: 0, foregroundHwnd: 0, knownTitles: known });
    expect(r.hwnd).toBe(0);
    expect(r.source).toEqual(t);
  });

  it('returns hwnd=0 when no knownTitles map is provided', () => {
    const t: StepTarget = { kind: 'title', title: 'Notepad' };
    const r = resolveTarget(t, { boundHwnd: 0, foregroundHwnd: 0 });
    expect(r.hwnd).toBe(0);
  });

  it('treats undefined target as { kind: "foreground" }', () => {
    const r = resolveTarget(undefined, { boundHwnd: 100, foregroundHwnd: 200 });
    expect(r.hwnd).toBe(200);
    expect(r.source).toEqual({ kind: 'foreground' });
  });
});

describe('UIA entry points on non-Windows (v0.5-mini)', () => {
  it('listElementsInWindow returns []', async () => {
    const r = await listElementsInWindow(12345);
    expect(r).toEqual([]);
  });

  it('findElement returns null', async () => {
    const r = await findElement(12345, { name: 'test' });
    expect(r).toBeNull();
  });

  it('invokeElement is a no-op (does not throw)', async () => {
    await expect(invokeElement(fakeHandle())).resolves.toBeUndefined();
  });

  it('setElementText is a no-op (does not throw)', async () => {
    await expect(setElementText(fakeHandle(), 'text')).resolves.toBeUndefined();
  });

  it('getElementText returns ""', async () => {
    const r = await getElementText(fakeHandle());
    expect(r).toBe('');
  });

  it('focusElement is a no-op (does not throw)', async () => {
    await expect(focusElement(fakeHandle())).resolves.toBeUndefined();
  });

  it('findElement with hwnd=0 returns null without doing any work', async () => {
    const r = await findElement(0, { name: 'test' });
    expect(r).toBeNull();
  });

  it('listElementsInWindow with hwnd=0 returns []', async () => {
    const r = await listElementsInWindow(0, { controlType: 'Button' });
    expect(r).toEqual([]);
  });
});

describe('UIA selector gates on Windows (v0.5-mini T3)', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  });

  it('className selector throws UiaBackendUnavailableError on findElement', async () => {
    // Even with mocked spawn, the unsupported-selector gate fires
    // synchronously inside buildConditionPs BEFORE we hit spawn.
    await expect(findElement(0x1234, { className: 'Button' })).rejects.toBeInstanceOf(
      UiaBackendUnavailableError
    );
  });

  it('xpath selector throws UiaBackendUnavailableError on findElement', async () => {
    await expect(findElement(0x1234, { xpath: '/Window/Button' })).rejects.toBeInstanceOf(
      UiaBackendUnavailableError
    );
  });

  it('unsupported controlType label throws UiaBackendUnavailableError on findElement', async () => {
    await expect(
      findElement(0x1234, { controlType: 'TotallyMadeUp' })
    ).rejects.toBeInstanceOf(UiaBackendUnavailableError);
  });

  it('hwnd=0 short-circuits before the platform gate', async () => {
    // We never get to the ensureBackend throw because hwnd=0
    // returns null first.  This pins the order of the gates.
    const r = await findElement(0, { name: 'test' });
    expect(r).toBeNull();
  });

  it('ensureBackend on non-Windows still throws UiaBackendUnavailableError', () => {
    // Sanity: flip back to non-Windows and confirm the platform
    // gate fires.  This is a regression check against the T1
    // contract: if someone removes the platform gate, this fails.
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    expect(() => __test__.ensureBackend()).toThrow(UiaBackendUnavailableError);
    // Restore the Windows platform for any later hooks.
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  });
});
