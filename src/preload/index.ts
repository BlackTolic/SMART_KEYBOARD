// Preload script: expose a narrow API surface to the renderer via
// contextBridge. The renderer never gets direct access to Node.

import { contextBridge, ipcRenderer } from 'electron';
import type {
  ExecuteRequest,
  ProgressEvent,
  WindowDiagnostics,
  WindowInfo
} from '../shared/types.js';

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
  }
};

contextBridge.exposeInMainWorld('api', api);

export type ExposedApi = typeof api;
