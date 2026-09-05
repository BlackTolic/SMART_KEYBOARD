// Pure helpers for window enumeration.
//
// Kept in a separate `.ts` file (not coupled to koffi) so they can be
// unit-tested in the vitest node environment without mocking any
// native module. The main `window.ts` calls into these from inside
// the koffi-backed EnumWindows callback, where we already have all
// the OS-provided fields on hand.

/**
 * A window we have already partially gathered metadata for. The
 * fields are the subset that the dedupe / visibility heuristics
 * need; the final `WindowInfo` consumers see is derived from this.
 */
export interface RawWindow {
  hwnd: number;
  pid: number;
  title: string;
  // processName may be a basename like "msedge.exe" or a placeholder
  // like "pid-1234" if psapi could not resolve the image.
  processName: string;
  // True if user32::IsWindowVisible returned true.
  isVisible: boolean;
  // Window rect from GetWindowRect. width = right - left, height =
  // bottom - top. width=0 and height=0 means a hidden / minimized /
  // never-shown window.
  width: number;
  height: number;
  // Window class name from GetClassNameW. Useful for telling apart
  // game windows (e.g. "DirectX", "GLFW30", "YYGameMaker") from
  // ordinary Win32 chrome ("Notepad", "IME", "MSCTFIME UI").
  className: string;
}

/**
 * Visibility fallback for directx / DWM-fusioned windows.
 *
 * `IsWindowVisible` returns false for some legitimate cases:
 *   - DirectX 9 exclusive fullscreen games hide their host HWND
 *     from DWM (visible only inside the game process).
 *   - Some game launcher / splash windows report invisible until
 *     the renderer attaches.
 *   - Windows that are in the WS_VISIBLE state but whose rect is
 *     zero-sized (just-created, not yet laid out).
 *
 * We treat a window as "effectively visible" if EITHER:
 *   - IsWindowVisible returned true, OR
 *   - The window has a non-zero rect (width > 0 AND height > 0)
 *
 * Windows with width=0 AND height=0 are filtered out — they are
 * either fully hidden or never shown.
 */
export function isEffectivelyVisible(
  isVisible: boolean,
  width: number,
  height: number
): boolean {
  if (isVisible) return true;
  return width > 0 && height > 0;
}

/**
 * Reduce a list of raw windows to at most one entry per PID.
 *
 * A real application often has several top-level HWNDs:
 *   - Microsoft Edge: 1 per tab + the chrome shell.
 *   - Chrome: same.
 *   - DirectX games: a launcher window + the actual game window.
 *   - Electron apps: hidden splash + main + devtools.
 *
 * For the picker UI we want exactly one row per process. We pick
 * the best candidate per PID by sorting on (visible desc, area desc)
 * and taking the first.
 */
export function dedupeWindowsByProcess(list: RawWindow[]): RawWindow[] {
  const best = new Map<number, RawWindow>();
  for (const w of list) {
    if (!w.pid || w.pid <= 0) continue; // skip windows without a usable pid
    const prev = best.get(w.pid);
    if (!prev) {
      best.set(w.pid, w);
      continue;
    }
    if (isBetterCandidate(w, prev)) {
      best.set(w.pid, w);
    }
  }
  return [...best.values()];
}

function isBetterCandidate(a: RawWindow, b: RawWindow): boolean {
  // Prefer visible.
  if (a.isVisible !== b.isVisible) return a.isVisible;
  // Then larger area.
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  if (areaA !== areaB) return areaA > areaB;
  // Then longer title (more informative).
  return a.title.length > b.title.length;
}

/**
 * Format a wide-string path returned by GetModuleFileNameExW into a
 * process basename (e.g. "C:\Program Files\Edge\Application\msedge.exe"
 * -> "msedge.exe"). Returns an empty string for empty input, the
 * caller decides the fallback ("pid-NNN" placeholder).
 */
export function basenameFromPath(path: string): string {
  if (!path) return '';
  const idx = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return idx >= 0 ? path.substring(idx + 1) : path;
}

/**
 * Compose the final processName string for a window. If we have a
 * real basename, use it; otherwise fall back to "pid-{pid}" so the
 * UI can still display something stable.
 */
export function resolveProcessName(
  pid: number,
  imageBasename: string
): string {
  if (imageBasename) return imageBasename;
  if (!pid || pid <= 0) return '';
  return `pid-${pid}`;
}
