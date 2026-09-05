// v0.4.1 HOTFIX: real koffi integration test.
//
// The previous unit test suite mocked koffi entirely, which meant
// a TypeError thrown by koffi.register() (because the production
// code passed a raw `koffi.proto(...)` instead of a pointer to it)
// was invisible to the tests. As a result enumVisibleWindows
// silently returned [] for an entire minor release cycle.
//
// This file does NOT mock koffi. It calls the real koffi 3.2.1
// bindings against the actual user32 / kernel32 / psapi DLLs.
//
// On Windows the tests will see the developer's real desktop
// (explorer, browser, IDE, ...). On other platforms or under
// headless CI without a desktop session, EnumWindows may return
// false / 0 windows; in that case the tests are still expected to
// *not throw*, so we only fail hard if koffi.register itself
// rejects the type — that is the exact bug we are guarding
// against.

import { describe, it, expect } from 'vitest';
import { enumVisibleWindows, diagnoseWindows } from '../src/main/window';

const isWin = process.platform === 'win32';
const itIfWindows = isWin ? it : it.skip;

describe('window: real koffi smoke (v0.4.1 hotfix)', () => {
  itIfWindows(
    'enumVisibleWindows does not throw TypeError from koffi.register',
    async () => {
      // If the v0.4.1 hotfix regresses, koffi.register throws
      // "Unexpected EnumWindowsCallback type, expected <callback> * type".
      // enumVisibleWindows now rethrows after logging, so this
      // assertion would fail with that exact message.
      let result: Awaited<ReturnType<typeof enumVisibleWindows>>;
      try {
        result = await enumVisibleWindows();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Unexpected EnumWindowsCallback type')) {
          throw new Error(
            `v0.4.1 koffi.register hotfix regressed: ${msg}. ` +
              'Did you forget koffi.pointer(EnumWindowsCallback)?'
          );
        }
        // Any other error is treated as a non-Windows / headless
        // environment quirk and skipped on CI.
        if (process.env.CI) return;
        throw err;
      }
      expect(Array.isArray(result)).toBe(true);
    },
    30_000
  );

  itIfWindows(
    'diagnoseWindows does not throw TypeError from koffi.register',
    async () => {
      let result: Awaited<ReturnType<typeof diagnoseWindows>>;
      try {
        result = await diagnoseWindows();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Unexpected EnumWindowsCallback type')) {
          throw new Error(
            `v0.4.1 koffi.register hotfix regressed: ${msg}.`
          );
        }
        if (process.env.CI) return;
        throw err;
      }
      expect(Array.isArray(result)).toBe(true);
    },
    30_000
  );

  itIfWindows(
    'enumVisibleWindows returns at least one entry on a real desktop session',
    async () => {
      // On a developer / end-user machine there are always many
      // windows (SmartKeyboard itself + Explorer + browser +
      // chat apps). A return of [] means the enumerate failed
      // silently, which is exactly the v0.4 bug.
      const list = await enumVisibleWindows();
      if (process.env.CI) {
        // CI may not have a desktop session; we just want no throw.
        expect(Array.isArray(list)).toBe(true);
        return;
      }
      expect(list.length).toBeGreaterThan(0);
    },
    30_000
  );
});
