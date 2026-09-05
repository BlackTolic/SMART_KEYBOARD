// IPC handlers: expose simulator execution, cancellation, and window
// enumeration to the renderer over Electron's ipcMain / webContents
// bridge.

import { ipcMain, BrowserWindow, webContents } from 'electron';
import { startRun, cancelRun } from './runner.js';
import {
  getForegroundWindow,
  enumVisibleWindows,
  diagnoseWindows
} from './window.js';
import type { ExecuteRequest, ProgressEvent } from '../shared/types.js';

export function registerIpc() {
  ipcMain.handle('simulator:execute', async (event, payload: ExecuteRequest) => {
    const { steps, runId, targetHwnd } = payload || ({} as ExecuteRequest);
    if (!runId) {
      throw new Error('runId is required');
    }
    if (!Array.isArray(steps)) {
      throw new Error('steps must be an array');
    }

    const sender = event.sender;
    const onProgress = (e: ProgressEvent) => {
      if (sender.isDestroyed()) return;
      sender.send('simulator:progress', e);
    };

    const ctx = startRun(
      runId,
      steps,
      onProgress,
      { targetHwnd: targetHwnd ?? null }
    );

    // Don't await; the renderer tracks state via progress events.
    ctx.promise.catch(() => {
      /* errors are already reported through progress */
    });
    return { accepted: true, runId };
  });

  ipcMain.handle('simulator:cancel', async (_event, runId: string) => {
    if (typeof runId !== 'string') {
      throw new Error('runId must be a string');
    }
    const ok = cancelRun(runId);
    return { cancelled: ok, runId };
  });

  ipcMain.handle('windows:getCurrent', async () => {
    return await getForegroundWindow();
  });

  ipcMain.handle('windows:listVisible', async () => {
    return await enumVisibleWindows();
  });

  ipcMain.handle('windows:diagnose', async () => {
    return await diagnoseWindows();
  });
}

export function unregisterIpc() {
  ipcMain.removeHandler('simulator:execute');
  ipcMain.removeHandler('simulator:cancel');
  ipcMain.removeHandler('windows:getCurrent');
  ipcMain.removeHandler('windows:listVisible');
  ipcMain.removeHandler('windows:diagnose');
  // removeAllListeners is too aggressive; we only remove the ones we own
  for (const wc of webContents.getAllWebContents()) {
    wc.removeAllListeners('simulator:progress');
  }
}

export type _BrowserWindow = BrowserWindow;
