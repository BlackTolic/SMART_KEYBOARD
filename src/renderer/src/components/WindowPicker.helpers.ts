// Pure helpers for the WindowPicker component.
//
// Kept in a `.ts` file (not `.tsx`) so the helper can be imported
// from the vitest test environment without needing the React JSX
// transform. The component file imports from here; tests import from
// here directly.

import type { WindowInfo, WindowsApi } from '@shared/types';

// Demo data used when the renderer is being loaded outside Electron
// (e.g. when navigating to the vite dev server in a plain Browser to
// grab a screenshot). The `processName` fields mirror what psapi
// would return in production: a real .exe basename (the Windows
// convention), so the UI looks consistent with the real picker.
export const DEMO_WINDOWS: WindowInfo[] = [
  {
    hwnd: 0x1a2b3c,
    title: 'Visual Studio Code',
    processName: 'Code.exe',
    pid: 12345
  },
  {
    hwnd: 0x2b3c4d,
    title: 'Notepad',
    processName: 'notepad.exe',
    pid: 6789
  },
  {
    hwnd: 0x3c4d5e,
    title: 'File Explorer',
    processName: 'explorer.exe',
    pid: 2468
  },
  {
    hwnd: 0x4d5e6f,
    title: 'Microsoft Edge',
    processName: 'msedge.exe',
    pid: 13579
  }
];

/**
 * Resolve the list of visible windows to show in the picker.
 *
 * Exported as a pure helper so it can be unit-tested without a DOM.
 * When `api` is missing (Browser preview, Storybook, tests) we fall
 * back to a stable demo list. When `api.listVisible` rejects, we
 * return a rejected promise so the caller can surface the error.
 */
export async function loadVisibleWindows(
  api: Pick<WindowsApi, 'listVisible'> | undefined
): Promise<WindowInfo[]> {
  if (!api || typeof api.listVisible !== 'function') {
    return DEMO_WINDOWS;
  }
  return api.listVisible();
}

export function isCurrentlyBound(
  win: WindowInfo,
  currentBound: WindowInfo | null
): boolean {
  if (!currentBound) return false;
  return win.hwnd === currentBound.hwnd;
}
