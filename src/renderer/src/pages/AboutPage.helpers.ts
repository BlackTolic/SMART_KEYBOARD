// Pure helpers for the AboutPage diagnostic panel.
//
// Kept in a `.ts` file (not `.tsx`) so the helper can be imported
// from the vitest test environment without needing the React JSX
// transform. The component imports from here; tests can also
// import from here directly if we ever add a dedicated test file.

import type { WindowDiagnostics } from '@shared/types';

// Stable demo rows used when the renderer is being loaded outside
// Electron (Browser preview, screenshots). Mirrors what the real
// diagnostic endpoint would return for a typical developer
// machine running Edge + Code + a couple of support tools.
export const DEMO_DIAGNOSTICS: WindowDiagnostics[] = [
  {
    hwnd: 0x1a2b3c,
    pid: 12345,
    title: 'Visual Studio Code',
    processName: 'Code.exe',
    isVisible: true,
    isEffectivelyVisible: true,
    width: 1920,
    height: 1040,
    className: 'Chrome_WidgetWin_1'
  },
  {
    hwnd: 0x2b3c4d,
    pid: 13579,
    title: 'Bing — Microsoft Edge',
    processName: 'msedge.exe',
    isVisible: true,
    isEffectivelyVisible: true,
    width: 1280,
    height: 800,
    className: 'Chrome_WidgetWin_1'
  },
  {
    hwnd: 0x3c4d5e,
    pid: 24680,
    title: 'QQ自由幻想',
    processName: 'QQXXHG.exe',
    isVisible: false,
    isEffectivelyVisible: true,
    width: 1920,
    height: 1080,
    className: 'TWINCONTROL'
  },
  {
    hwnd: 0x4d5e6f,
    pid: 31415,
    title: 'Notepad',
    processName: 'notepad.exe',
    isVisible: true,
    isEffectivelyVisible: true,
    width: 720,
    height: 480,
    className: 'Notepad'
  },
  {
    hwnd: 0x5e6f70,
    pid: 99999,
    title: '',
    processName: 'background_helper.exe',
    isVisible: false,
    isEffectivelyVisible: false,
    width: 0,
    height: 0,
    className: 'DummyHWND'
  }
];

/**
 * Format diagnostics rows as tab-separated text for clipboard /
 * issue reports. Exposed for future unit testing.
 *
 * Visibility flag convention:
 *   Y — appears in the picker (IsWindowVisible=true AND rect>0)
 *   P — appears via the "effective visibility" fallback
 *       (IsWindowVisible=false but rect>0, the DirectX 9 case)
 *   N — does not appear (IsWindowVisible=false AND rect=0)
 */
export function diagnosticsToText(rows: WindowDiagnostics[]): string {
  const header = 'PID\t进程名\thwnd(hex)\t标题\t类名\t可见\t宽x高';
  const body = rows
    .map((r) => {
      const flag = r.isEffectivelyVisible ? (r.isVisible ? 'Y' : 'P') : 'N';
      return [
        r.pid,
        r.processName || '',
        '0x' + r.hwnd.toString(16),
        r.title || '(untitled)',
        r.className || '',
        flag,
        `${r.width}x${r.height}`
      ].join('\t');
    })
    .join('\n');
  return `${header}\n${body}\n`;
}
