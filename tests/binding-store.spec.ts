// v0.4.4: regression test for "binding a window must also flip
// backgroundMode on". The user-reported defect was: "I clicked 绑定窗口
// → picked one → closed the modal, but pressing Run did nothing."
// Root cause: bindWindow() only set boundWindow; backgroundMode was
// still false, so the renderer passed targetHwnd=undefined to the
// runner and the runner never switched focus.
//
// This spec pins the new contract: bindWindow / demoBind are
// monotonic-on for backgroundMode, unbindWindow is monotonic-off, and
// setBackgroundMode is still an independent knob the user can toggle.

import { describe, it, expect, beforeEach } from 'vitest';
import { useBindingStore } from '../src/renderer/src/store/binding';

describe('binding store (v0.4.4 auto background-mode)', () => {
  beforeEach(() => {
    // Reset to a clean baseline so each test is independent.
    useBindingStore.setState({ boundWindow: null, backgroundMode: false });
  });

  it('bindWindow also enables background mode (the fix)', () => {
    const before = useBindingStore.getState();
    expect(before.boundWindow).toBeNull();
    expect(before.backgroundMode).toBe(false);

    before.bindWindow({
      hwnd: 12345,
      title: 'Test',
      processName: 'test.exe',
      pid: 9999
    });

    const after = useBindingStore.getState();
    expect(after.boundWindow?.hwnd).toBe(12345);
    // The whole point of v0.4.4: binding implicitly enables background
    // mode so targetHwnd reaches the runner.
    expect(after.backgroundMode).toBe(true);
  });

  it('unbindWindow also disables background mode', () => {
    // Pre-condition: something is bound and background mode is on.
    const store = useBindingStore.getState();
    store.bindWindow({ hwnd: 1, title: 't', processName: 't.exe', pid: 1 });
    expect(useBindingStore.getState().backgroundMode).toBe(true);
    expect(useBindingStore.getState().boundWindow).not.toBeNull();

    store.unbindWindow();

    const after = useBindingStore.getState();
    expect(after.boundWindow).toBeNull();
    // Symmetric to bindWindow: unbinding implicitly disables
    // background mode so we never carry a "hanging" true with no
    // bound window.
    expect(after.backgroundMode).toBe(false);
  });

  it('demoBind enables both, matching the manual-bind UX', () => {
    // The dev-only ?demo=1 path should look identical to "I clicked
    // 绑定窗口 and picked VS Code" — same chip, same checked
    // checkbox, same targetHwnd propagation.
    useBindingStore.getState().demoBind();

    const after = useBindingStore.getState();
    expect(after.boundWindow?.title).toBe('Visual Studio Code');
    expect(after.backgroundMode).toBe(true);
  });

  it('setBackgroundMode can still toggle independently without touching boundWindow', () => {
    const store = useBindingStore.getState();
    store.bindWindow({ hwnd: 1, title: 't', processName: 't.exe', pid: 1 });
    expect(useBindingStore.getState().backgroundMode).toBe(true);

    // The user can still turn background mode off manually (e.g.
    // they want to keep the chip but run in the foreground).
    store.setBackgroundMode(false);
    expect(useBindingStore.getState().backgroundMode).toBe(false);
    // The bound window stays — toggling the checkbox does NOT
    // cascade an unbind.
    expect(useBindingStore.getState().boundWindow).not.toBeNull();
  });

  it('re-binding replaces the window AND keeps background mode on', () => {
    // Switching targets (e.g. user picked the wrong window, then
    // re-picked the right one) should not silently drop background
    // mode to false.
    const store = useBindingStore.getState();
    store.bindWindow({ hwnd: 1, title: 'A', processName: 'a.exe', pid: 1 });
    store.bindWindow({ hwnd: 2, title: 'B', processName: 'b.exe', pid: 2 });

    const after = useBindingStore.getState();
    expect(after.boundWindow?.hwnd).toBe(2);
    expect(after.backgroundMode).toBe(true);
  });
});
