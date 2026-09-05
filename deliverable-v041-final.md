# T3 v0.4.1 hotfix — Independent E2E Verification

**Verifier**: verifier agent (branch session `mvs_2d87f95c5eb1483986155c848474dbb6`)
**Date**: 2026-09-05 13:55 +08:00
**Target**: `koffi.register(cb, EnumWindowsCallback)` 3.2.1 TypeError hotfix
**VERDICT**: **PASS** (all 6 critical checks green; v0.4 critical bug is genuinely fixed in production bundle)

---

## 1. File existence — PASS

| Artifact | Path | Exists |
|---|---|---|
| Installer (x64) | `release\SmartKeyboard-0.1.0-x64.exe` | ✅ |
| Portable | `release\SmartKeyboard-0.1.0-portable.exe` | ✅ |
| Unpacked binary | `release\win-unpacked\SmartKeyboard.exe` | ✅ |
| New integration spec | `tests\window-integration.spec.ts` | ✅ |

All four required files present on disk.

---

## 2. asar hotfix verification — PASS

Extracted `release\win-unpacked\resources\app.asar` to temp and grepped for both new and old patterns.

### 2a. Hotfix IS present in production bundle
- **Match**: `\out\main\index.js`
- Lines 117516–117518 (real bundle, post-minify):
  ```js
  const EnumWindowsCallback = koffi.proto("bool __stdcall EnumWindowsCallback(void* hWnd)");
  const EnumWindowsCallbackPtr = koffi.pointer(EnumWindowsCallback);   // <-- hotfix
  const EnumWindows = user32.func("bool __stdcall EnumWindows(EnumWindowsCallback* lpEnumFunc, void* lParam)");
  ```
- Line 117675: `const handle = koffi.register(cb, EnumWindowsCallbackPtr);` ← now uses the pointer wrapper, not raw proto
- Lines 117631–117635 / 117654–117658: `enumVisibleWindows` / `diagnoseWindows` now rethrow with `enumVisibleWindows failed: ...` / `diagnoseWindows failed: ...` (no longer silent `[]`)

### 2b. Old buggy pattern is NOT leaked
- Search for `Unexpected EnumCb type` across every `*.js` in the asar → **0 matches** ✅
- (That string was the v0.4 dead path; absence proves the v0.4 `register(cb, EnumWindowsCallback)` direct-proto call site has been removed from the build.)

**Status: Hotfix code is in the asar; v0.4 buggy call is not. PASS.**

---

## 3. Real launch + CDP — PASS

```
SKIP_REAL_EXECUTION=1 SmartKeyboard.exe --remote-debugging-port=9222
→ Process count after 8s: 4  (main + GPU + utility + renderer — normal for Electron)
→ /json  : 1 page tab
  id    : 41A80ECA67B1DFE8D9F22C6A81D5ED7D
  title : SmartKeyboard
  url   : file:///F:/Code/Project/15SMART_KEYBORD/release/win-unpacked/resources/app.asar/out/renderer/index.html
```

The production-built renderer is the one that would ship to end users — exactly the surface that had the v0.4 bug.

---

## 4. CDP real call into `window.api.windows.diagnose()` / `listVisible()` — **PASS** (the key evidence)

Sent `Runtime.evaluate` via the CDP websocket against the real running renderer.

### 4a. API surface intact
```
API_KEYS=["getCurrent","listVisible","diagnose"]
```

### 4b. `diagnose()` — returns 219 windows (v0.4 was 0)
```
DIAGNOSE_COUNT=219

DIAGNOSE_FIRST_3 = [
  { "hwnd": 132088, "pid": 21036, "title": "GDI+ Window (SmartEngineTray.exe)",
    "processName": "SmartEngineTray.exe", "isVisible": false, "isEffectivelyVisible": true,
    "width": 1, "height": 1, "className": "GDI+ Hook Window Class" },
  { "hwnd":  65772, "pid":  6068, "title": "GDI+ Window (TabTip.exe)",
    "processName": "TabTip.exe", "isVisible": false, "isEffectivelyVisible": true,
    "width": 1, "height": 1, "className": "GDI+ Hook Window Class" },
  { "hwnd":  65750, "pid":  6068, "title": "Shell Handwriting Canvas",
    "processName": "TabTip.exe", "isVisible": false, "isEffectivelyVisible": true,
    "width": 2880, "height": 1800, "className": "ShellHandwritingCanvas {18E91349-...}" }
]
```

Every record has a **real `processName` resolved via `psapi`**, not a `pid-XXX` placeholder. That confirms the diagnostic path reaches all the way down to `GetModuleBaseNameW` and back, end-to-end.

### 4c. `listVisible()` — returns 74 windows (v0.4 was 0)
```
LISTVISIBLE_COUNT=74

LISTVISIBLE_FIRST = {
  "hwnd": 66952,
  "pid": 21036,
  "title": "WinGesture",
  "processName": "SmartEngineTray.exe"
}
```

Real visible-enumeration path also working with real exe names.

### 4d. No `TypeError` from `koffi.register`
Neither call returned a `Result.exceptionDetails`. If the v0.4 bug were still present, both calls would have surfaced `Unexpected EnumWindowsCallback type, expected <callback> * type` — they did not.

**Status: independently reproduced the T2 worker claim (219 windows) and exceeded it (also 74 for listVisible). The hotfix genuinely works at runtime. PASS.**

---

## 5. Test suite — PASS (79/79)

```
 RUN  v2.1.9  F:/Code/Project/15SMART_KEYBORD

 ✓ tests/about-page.spec.ts          ( 4 tests)    4ms
 ✓ tests/window-helpers.spec.ts      (15 tests)    8ms
 ✓ tests/window.spec.ts              (13 tests)   13ms
 ✓ tests/window-picker.spec.ts       ( 9 tests)    7ms
 ✓ tests/window-integration.spec.ts  ( 3 tests)   54ms   ← new real-koffi smoke
 ✓ tests/simulator.spec.ts           (23 tests)  387ms
 ✓ tests/runner.spec.ts              (12 tests)  698ms

 Test Files  7 passed (7)
      Tests  79 passed (79)
   Duration  1.84s
```

- Stderr noise from `runner.spec.ts` is **expected**: those tests intentionally trigger `Error: cancelled` and `Error: boom` to assert cancellation / error-propagation paths. They are marked ✓.
- `window-integration.spec.ts` (3 tests, the new file) all pass — including the "enumVisibleWindows does not throw TypeError from koffi.register" and "returns at least one entry on a real desktop session" cases.

---

## 6. Process shutdown — PASS

After CDP session, `Get-Process SmartKeyboard | Stop-Process -Force` was issued.
Re-checked: **`Get-Process SmartKeyboard | Measure-Object | Select -ExpandProperty Count` → 0**. ✅
No zombie Electron processes left behind; port 9222 implicitly freed.

---

## 7. Findings (severity-ordered)

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | INFO (no action) | v0.4 critical bug **confirmed fixed in production**. | §4b: DIAGNOSE_COUNT=219, §4c: LISTVISIBLE_COUNT=74, both with real `processName`. |
| 2 | INFO | v0.4 buggy call site `koffi.register(cb, EnumWindowsCallback)` is gone from the asar. | §2b: zero matches for the old `Unexpected EnumCb type` string. |
| 3 | INFO | Error messages now propagate (`enumVisibleWindows failed: …` / `diagnoseWindows failed: …`) — silent-`[]` failure mode eliminated. | §2a: lines 117631–117635, 117654–117658. |
| 4 | INFO | New real-koffi smoke spec `tests/window-integration.spec.ts` is present and passing on this machine. | §5: 3/3 ✓. |
| 5 | INFO (no action) | T2 worker's 219-window claim is independently reproduced. | §4b. |
| 6 | LOW (informational, not blocking) | The `diagnose()` count (219) is much larger than `listVisible()` (74). This is correct behavior — `diagnose` is the unfiltered union (visible + invisible + child windows), `listVisible` is the deduplicated, effectively-visible set. No bug, but worth flagging so a reviewer doesn't read 219 as a duplication issue. | §4b vs §4c. |
| 7 | LOW (not blocking) | Stderr lines during `runner.spec.ts` look alarming at first glance, but they are intentional throw-test output. | §5. |

No FAIL or BLOCKER findings.

---

## 8. Verdict

**VERDICT: PASS**

- All 6 acceptance criteria met.
- v0.4 critical bug (koffi.register TypeError → silent `[]`) is **genuinely fixed in the shipped bundle**, evidenced by an independent CDP probe against the real running production binary returning 219 / 74 windows with real exe names.
- 79/79 tests green; process cleanup clean.

### Owner-actionable items
- **None.** Ship v0.4.1.
- Optional follow-up (non-blocking): a CI-side assertion that `diagnose().length > 0` on a non-CI Windows runner would have caught v0.4 faster; the new `window-integration.spec.ts` already covers this when run on a real desktop session.

---

## Appendix A — Evidence locations

- asar extracted to `C:\Users\61793\AppData\Local\Temp\asar-v041-1291914447` (kept for traceability; small, < 5 MB)
- CDP output transcript: `C:\Users\61793\AppData\Local\Temp\v041-cdp-1576660178\cdp-result.txt` (kept for traceability)
- npm test stdout (full): captured via `Tee-Object` to `$env:TEMP\npm-test-*.txt` during run
- Bug-hunt command (zero matches confirms absence of old buggy call): `Select-String -Path <asar>/out/main/index.js -Pattern 'Unexpected EnumCb type'`

## Appendix B — Independent reproduction recipe (re-runnable)

1. `Start-Process release\win-unpacked\SmartKeyboard.exe --remote-debugging-port=9222 -Environment SKIP_REAL_EXECUTION=1`
2. `Invoke-RestMethod http://127.0.0.1:9222/json` → expect 1 page tab titled `SmartKeyboard`
3. Open websocket to `tab.webSocketDebuggerUrl`
4. Send `Runtime.enable`
5. `Runtime.evaluate` with `expression: "(async () => JSON.stringify(await window.api.windows.diagnose()))()"` and `returnByValue: true, awaitPromise: true`
6. Expect `result.result.value` to be a JSON array of length >> 0 with `processName` fields like `*.exe` (not `pid-XXX`).

Observed: array length 219, every entry has real processName. ✅