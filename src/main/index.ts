import { app, BrowserWindow, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerIpc, unregisterIpc } from './ipc.js';
import { initTSPlug } from './auto-plugin/tian-shi/loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): BrowserWindow {
  // v0.4.1 dev-only: SMART_KEYBOARD_DEV_SIZE=WxH (e.g. "1100x1500")
  // overrides the default 1080x720 so the diagnostic panel is
  // visible without scrolling. Production is unaffected because
  // the env var is unset in `electron-builder`.
  const devSize = process.env['SMART_KEYBOARD_DEV_SIZE'];
  let width = 1080;
  let height = 720;
  if (devSize) {
    const m = devSize.match(/^(\d+)x(\d+)$/);
    if (m) {
      width = Number(m[1]);
      height = Number(m[2]);
    }
  }
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 880,
    minHeight: 560,
    show: false,
    backgroundColor: '#FAFAFA',
    title: 'SmartKeyboard',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Open external links in the default browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  // v0.4.1 dev-only: SMART_KEYBOARD_DEV_QUERY lets a screenshot /
  // smoke test deep-link straight to ?about=1&diag=1 so the
  // diagnostic panel is expanded on first paint. Production is
  // unaffected because the env var is unset in `electron-builder`.
  const devQuery = process.env['SMART_KEYBOARD_DEV_QUERY'] ?? '';
  if (devUrl) {
    const sep = devUrl.includes('?') ? '&' : '?';
    void win.loadURL(devQuery ? `${devUrl}${sep}${devQuery}` : devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  return win;
}

app.whenReady().then(async () => {
  // v0.6: 启动时探测 TSPlug.dll 是否可用。探测是异步的（要等 winax + COM 初始化），
  // 我们在注册 IPC 之前 await，确保 simulator 收到的第一次 isTSPlugAvailable() 就有
  // 稳定结果。探测失败不影响主流程：loader 内部会记录错误，simulator 走 nut-js fallback。
  await initTSPlug();
  registerIpc();
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  unregisterIpc();
});
