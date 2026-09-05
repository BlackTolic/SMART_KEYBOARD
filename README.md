# SmartKeyboard

A minimal Electron desktop app for hand-crafted mouse and keyboard
automation. You build a list of steps in the UI, hit **Run**, and the
app drives the input for you.

This is the **minimal build** — it intentionally omits recording,
macro libraries, and global hotkeys.

## Highlights

- **Step composer**: add / remove / reorder `move`, `click`,
  `doubleClick`, `scroll`, `keyTap`, `type`, and `delay` steps.
- **Run / Stop**: sequential execution with progress events. Stop
  cancels mid-run via an `AbortController`.
- **Codex++-style UI**: light/dark theme, low-saturation palette,
  generous whitespace, no emoji or illustration.
- **Mock mode**: set `SKIP_REAL_EXECUTION=1` to short-circuit the
  simulator (`@nut-tree/nut-js`) and log each step instead. Used by
  the E2E task so the real desktop doesn't get driven by tests.

## Stack

| Layer       | Tool                                           |
| ----------- | ---------------------------------------------- |
| Shell       | Electron 32 (contextIsolation, preload bridge) |
| Renderer    | React 18 + TypeScript + Vite                   |
| Build       | `electron-vite` (one config, three entries)    |
| Simulation  | `@nut-tree/nut-js` 5.x (lazy-loaded)           |
| State       | `zustand`                                      |
| Tests       | `vitest`                                       |
| Packager    | `electron-builder` (configured, not run here)  |

## Project layout

```
src/
  main/        # Electron main process: window, IPC, runner, simulator
  preload/     # contextBridge — exposes window.api to the renderer
  shared/      # types shared by main and renderer
  renderer/    # React app
    src/
      components/   # Sidebar, RunBar, StepRow, StepEditor, IconButton
      pages/        # EditorPage, AboutPage
      store/        # zustand store
      hooks/        # useSimulatorProgress
      styles/       # tokens.css, global.css
tests/         # vitest unit tests
```

## Getting started

Requirements:

- Node.js ≥ 20 (tested on Node 22.14)
- npm 10+
- Windows 10/11 x64 (the project also runs on macOS / Linux; only
  packaging was exercised on Windows here)

```bash
# 1. Install dependencies
npm install

# 2. Run the dev server (Vite + Electron with HMR)
npm run dev

# 3. Unit tests
npm test
```

`npm run dev` opens a 1080×720 Electron window. The first paint is the
light theme; click **Dark** in the top-right to toggle.

## Building a production bundle

```bash
# 1. Type-check + bundle main / preload / renderer into out/
npm run build

# 2. Build platform installers (Windows, in this repo)
npx electron-builder --win --x64 --publish never
```

Outputs land in `release/`:

- `SmartKeyboard-<version>-x64.exe` — NSIS installer
- `SmartKeyboard-<version>-portable.exe` — portable build
- `win-unpacked/SmartKeyboard.exe` — direct executable

Packaging is intentionally **not** run as part of the minimal T1 task;
it is reserved for T2.

## Key technical choices

- **electron-vite over vite-plugin-electron**: a single config file
  describes main / preload / renderer with sensible defaults and
  dead-simple HMR.
- **Lazy `require('@nut-tree/nut-js')`**: keeps the renderer out of
  the dep chain and lets unit tests mock the module before it is
  ever loaded. The renderer never imports it.
- **Preload bridge over `nodeIntegration`**: only `window.api.*` is
  exposed. The renderer cannot touch `ipcRenderer` or `require`.
- **AbortController-based cancellation**: a single `AbortController`
  per run lets `Stop` interrupt any in-flight step, including
  `delay`.
- **CSS Modules + design tokens**: scoped per-component styling plus
  one `tokens.css` file with light/dark CSS variables. No Tailwind.
- **No external icons / emoji**: pure typography, copy and one
  monospace `SK` logo block. Easy to recolor by changing tokens.

## Mock mode for CI / E2E

```bash
# Linux/macOS
SKIP_REAL_EXECUTION=1 npm run dev

# Windows PowerShell
$env:SKIP_REAL_EXECUTION=1; npm run dev
```

In mock mode each step is logged to the main process console instead
of driving the real mouse / keyboard.

## License

MIT
