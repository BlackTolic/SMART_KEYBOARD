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
    // v0.4.4: 绑即启用。用户绑定窗口的意图就是"跑过去"，自动勾上后台模式，
    // 这样 targetHwnd 才会被传进 runner，键鼠才会切到目标窗口。
    // 之前 v0.4.3 漏了"勾 checkbox"这一步，导致用户必须再手动点一下才会生效。
    set({ boundWindow: info, backgroundMode: true });
  },
  unbindWindow() {
    // v0.4.4: 解绑即关。避免 backgroundMode 单独留下"挂着"状态，
    // 让两个状态保持单调一致（绑 → on，解绑 → off）。
    set({ boundWindow: null, backgroundMode: false });
  },
  setBackgroundMode(b) {
    set({ backgroundMode: b });
  },
  demoBind() {
    // v0.4.4: 同步 demo 行为，让 ?demo=1 截图与"手动绑定窗口"行为一致。
    set({ boundWindow: DEMO_WINDOW, backgroundMode: true });
  }
}));
