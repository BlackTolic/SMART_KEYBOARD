import { describe, it, expect, vi } from 'vitest';
import type { WindowInfo, WindowsApi } from '../src/shared/types';

// The component lives in the renderer package and pulls in React +
// CSS modules. To keep this test environment pure (vitest runs in
// 'node' mode, no jsdom), we import only the pure helper that the
// component exports. The picker component itself is exercised in the
// Electron dev build (see v0.3 changelog).

import {
  loadVisibleWindows,
  isCurrentlyBound,
  DEMO_WINDOWS
} from '../src/renderer/src/components/WindowPicker.helpers';

const SAMPLE: WindowInfo[] = [
  { hwnd: 0x1, title: 'Editor A', processName: 'app-a', pid: 100 },
  { hwnd: 0x2, title: 'Editor B', processName: 'app-b', pid: 200 }
];

describe('WindowPicker.loadVisibleWindows', () => {
  it('returns the demo list when no api is available', async () => {
    const list = await loadVisibleWindows(undefined);
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list[0]).toMatchObject({ title: 'Visual Studio Code' });
  });

  it('forwards the call to api.listVisible() when api is present', async () => {
    const listVisible = vi.fn().mockResolvedValue(SAMPLE);
    const fakeApi = { listVisible } as unknown as Pick<WindowsApi, 'listVisible'>;
    const list = await loadVisibleWindows(fakeApi);
    expect(listVisible).toHaveBeenCalledTimes(1);
    expect(list).toBe(SAMPLE);
  });

  it('returns an empty list when the api reports no visible windows', async () => {
    const fakeApi = {
      listVisible: vi.fn().mockResolvedValue([] as WindowInfo[])
    } as unknown as Pick<WindowsApi, 'listVisible'>;
    const list = await loadVisibleWindows(fakeApi);
    expect(list).toEqual([]);
  });

  it('propagates errors thrown by api.listVisible()', async () => {
    const fakeApi = {
      listVisible: vi.fn().mockRejectedValue(new Error('boom'))
    } as unknown as Pick<WindowsApi, 'listVisible'>;
    await expect(loadVisibleWindows(fakeApi)).rejects.toThrow('boom');
  });

  it('falls back to demo data when api is missing the listVisible function', async () => {
    // Belt-and-braces: a malformed api object should not crash the
    // picker. We treat it the same as "no api" and return demo data.
    const broken = {} as unknown as Pick<WindowsApi, 'listVisible'>;
    const list = await loadVisibleWindows(broken);
    expect(list.length).toBeGreaterThanOrEqual(3);
  });
});

describe('WindowPicker.isCurrentlyBound', () => {
  it('returns true when the window hwnd matches the bound hwnd', () => {
    const bound: WindowInfo = { hwnd: 0x1, title: 'X', processName: 'x', pid: 1 };
    const win: WindowInfo = { hwnd: 0x1, title: 'X (renamed)', processName: 'x', pid: 1 };
    expect(isCurrentlyBound(win, bound)).toBe(true);
  });

  it('returns false when hwnds differ', () => {
    const bound: WindowInfo = { hwnd: 0x1, title: 'X', processName: 'x', pid: 1 };
    const win: WindowInfo = { hwnd: 0x2, title: 'X', processName: 'x', pid: 1 };
    expect(isCurrentlyBound(win, bound)).toBe(false);
  });

  it('returns false when nothing is bound', () => {
    const win: WindowInfo = { hwnd: 0x1, title: 'X', processName: 'x', pid: 1 };
    expect(isCurrentlyBound(win, null)).toBe(false);
  });
});

describe('WindowPicker.DEMO_WINDOWS', () => {
  it('is a non-empty list with the demo app first', () => {
    expect(DEMO_WINDOWS.length).toBeGreaterThanOrEqual(3);
    expect(DEMO_WINDOWS[0].title).toBe('Visual Studio Code');
  });
});
