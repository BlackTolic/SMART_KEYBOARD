// Preload script: expose a narrow API surface to the renderer via
// contextBridge. The renderer never gets direct access to Node.

import { contextBridge, ipcRenderer } from 'electron';
import type {
  ExecuteRequest,
  ProgressEvent,
  WindowDiagnostics,
  WindowInfo
} from '../shared/types.js';

// v0.6: TSPlug 状态报告。类型跟主进程 loader 的 TSPlugStatus 保持一致。
// 只读快照；不暴露 dll 操作 / SetSimMode 等 user-side 配置。
export interface PluginStatus {
  available: boolean;
  version: string | null;
  error: string | null;
  source: 'wrapper' | 'unavailable';
}

const api = {
  simulator: {
    execute(req: ExecuteRequest) {
      return ipcRenderer.invoke('simulator:execute', req);
    },
    cancel(runId: string) {
      return ipcRenderer.invoke('simulator:cancel', runId);
    },
    onProgress(cb: (e: ProgressEvent) => void) {
      const listener = (_event: unknown, payload: ProgressEvent) => cb(payload);
      ipcRenderer.on('simulator:progress', listener);
      return () => {
        ipcRenderer.removeListener('simulator:progress', listener);
      };
    }
  },
  windows: {
    getCurrent(): Promise<WindowInfo | null> {
      return ipcRenderer.invoke('windows:getCurrent');
    },
    listVisible(): Promise<WindowInfo[]> {
      return ipcRenderer.invoke('windows:listVisible');
    },
    diagnose(): Promise<WindowDiagnostics[]> {
      return ipcRenderer.invoke('windows:diagnose');
    }
  },
  // v0.6: TSPlug 插件状态（天使插件 dll 是否可用、版本号、错误信息）。
  // 主进程 IPC 失败时降级返回 { available: false, error: <reason> }，
  // 渲染层永远拿到一个可读的 object，不会抛错。
  plugin: {
    status(): Promise<PluginStatus> {
      return ipcRenderer.invoke('plugin:status');
    }
  }
};

contextBridge.exposeInMainWorld('api', api);

export type ExposedApi = typeof api;
