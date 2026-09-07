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
import { getTSPlugStatus } from './auto-plugin/tian-shi/loader.js';
import type { ExecuteRequest, ProgressEvent } from '../shared/types.js';

export function registerIpc() {
  ipcMain.handle('simulator:execute', async (event, payload: ExecuteRequest) => {
    // 中文注释：renderer 触发 run 的入口。返回 { accepted, runId } 表示"已接受，
    //  正在跑"，不返回 run 的完成结果（完成结果走 simulator:progress 事件）。
    //  abort / error 也走 progress 事件，renderer 不用再 await 这个 handler。
    const { steps, runId, targetHwnd, target, boundHwnd } =
      payload || ({} as ExecuteRequest);
    if (!runId) {
      throw new Error('runId is required');
    }
    if (!Array.isArray(steps)) {
      throw new Error('steps must be an array');
    }

    const sender = event.sender;
    const onProgress = (e: ProgressEvent) => {
      // sender 可能已 destroy（例如 user 关了窗口）：要 guard，否则 send 抛错。
      if (sender.isDestroyed()) return;
      sender.send('simulator:progress', e);
    };

    // v0.5-mini T2: pass `boundHwnd` and `target` (the new run-level
    // default) through to the runner. `targetHwnd` is the legacy
    // v0.4.5 activate hwnd; the runner still honors it for
    // SetForegroundWindow + as the default for steps without
    // `target`.
    const ctx = startRun(
      runId,
      steps,
      onProgress,
      {
        targetHwnd: targetHwnd ?? null,
        boundHwnd: typeof boundHwnd === 'number' ? boundHwnd : undefined
      },
      target
    );

    // Don't await; the renderer tracks state via progress events.
    // 这里吃掉的 catch 是为了不让 unhandled rejection 进 main 进程的
    // unhandledRejection 事件；run 的错误已经在 progress 事件里报了。
    ctx.promise.catch(() => {
      /* errors are already reported through progress */
    });
    return { accepted: true, runId };
  });

  // 中文注释：renderer 主动取消一个 runId。返回 { cancelled, runId }：
  //   cancelled = true 表示有 run 在跑并已被 abort
  //   cancelled = false 表示这个 runId 不存在（已经完成 / 还没开始）
  // 幂等：重复 cancel 同一个 runId 第二次会返回 cancelled=false。
  ipcMain.handle('simulator:cancel', async (_event, runId: string) => {
    if (typeof runId !== 'string') {
      throw new Error('runId must be a string');
    }
    const ok = cancelRun(runId);
    return { cancelled: ok, runId };
  });

  // 中文注释：当前前台窗口的 hwnd + 进程信息。RunBar 的"自动 bind 当前窗口"
  // 按钮会调这个，避免 user 手动从窗口列表里找。
  ipcMain.handle('windows:getCurrent', async () => {
    return await getForegroundWindow();
  });

  // 中文注释：枚举所有可见窗口。WindowPicker 组件用这个填充下拉列表。
  // 返回 WindowInfo[]，每条带 hwnd / title / processName / pid。
  ipcMain.handle('windows:listVisible', async () => {
    return await enumVisibleWindows();
  });

  // 中文注释：详细诊断。AboutPage 调试面板用这个，比 listVisible 多带
  // IsWindowVisible 原始值 / 尺寸 / 类名 / 有效可见性。
  ipcMain.handle('windows:diagnose', async () => {
    return await diagnoseWindows();
  });

  // v0.6: 暴露 TSPlug 状态给渲染层（AboutPage 诊断面板用）。
  // 这是只读快照，不暴露任何 dll 操作 API（user 自负 SetSimMode / Reg 等配置）。
  ipcMain.handle('plugin:status', async () => {
    return getTSPlugStatus();
  });
}

export function unregisterIpc() {
  ipcMain.removeHandler('simulator:execute');
  ipcMain.removeHandler('simulator:cancel');
  ipcMain.removeHandler('windows:getCurrent');
  ipcMain.removeHandler('windows:listVisible');
  ipcMain.removeHandler('windows:diagnose');
  ipcMain.removeHandler('plugin:status');
  // removeAllListeners is too aggressive; we only remove the ones we own
  for (const wc of webContents.getAllWebContents()) {
    wc.removeAllListeners('simulator:progress');
  }
}

export type _BrowserWindow = BrowserWindow;
