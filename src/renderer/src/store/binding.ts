import { create } from 'zustand';
import type { WindowInfo } from '@shared/types';

interface BindingStore {
  boundWindow: WindowInfo | null;
  backgroundMode: boolean;
  bindWindow: (info: WindowInfo) => void;
  unbindWindow: () => void;
  setBackgroundMode: (b: boolean) => void;
  // Dev-only: bind a fake window for screenshot / demo purposes.
  // Triggered by the ?demo=1 query param in EditorPage.
  demoBind: () => void;
}

const DEMO_WINDOW: WindowInfo = {
  hwnd: 0x1a2b3c,
  title: 'Visual Studio Code',
  processName: 'Code.exe',
  pid: 12345
};

export const useBindingStore = create<BindingStore>((set) => ({
  boundWindow: null,
  backgroundMode: false,
  bindWindow(info) {
    set({ boundWindow: info });
  },
  unbindWindow() {
    set({ boundWindow: null });
  },
  setBackgroundMode(b) {
    set({ backgroundMode: b });
  },
  demoBind() {
    set({ boundWindow: DEMO_WINDOW });
  }
}));
