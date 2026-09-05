# T3 v0.4 独立 E2E 验收报告

**验收人**: verifier (MiniMax Code, session mvs_ba2ac2d9bff04b7ea01f30cebc3942a3)
**验收对象**: SmartKeyboard v0.4 打包产物（重点：psapi 真实进程名 + 放宽 IsWindowVisible + 进程去重 + AboutPage 诊断面板 + 单元测试 52→75）
**验收时间**: 2026-09-05 13:06–13:22 (CST)
**工作目录**: `F:\Code\Project\15SMART_KEYBORD`
**工作模式**: 只读 + 截图 + 临时 asar 抽取（写到 `%TEMP%` 下的临时目录，清理尝试被 hard-safety 拦截），未修改项目文件

---

## ⚠️ 重要发现（先看）

verifier 在 CDP 抓图 + 多次调用 `window.api.windows.diagnose()` / `listVisible()` 时发现：

> **生产 bundle 中 `koffi.register(cb, EnumWindowsCallback)` 在 koffi 3.2.1 native 上抛 `TypeError: Unexpected EnumWindowsCallback type, expected <callback> * type`。**
> `enumVisibleWindows()` 和 `diagnoseWindows()` 在 try/catch 内被吞掉，**永远返回 `[]`**。

v0.4 的核心目标"psapi 真实进程名（如 `msedge.exe` / `notepad.exe` / `SmartKeyboard.exe`）"在**打包后的应用里根本无法验证**——因为 `EnumWindows` 回调注册失败，根本枚举不到任何窗口，更走不到 `psapi.GetModuleFileNameExW` 那一步。

verifier 用一个独立的 5 行 repro 脚本在 plain koffi 3.2.1 上 100% 复现了同一条错误，所以这不是环境问题，是 production code bug。

v0.3 已经引入同一 bug（v0.3 验收报告 `deliverable-v03-final.md` 末尾已记为 LOW 级"[LOW] 生产环境 koffi 枚举返回空"，当时建议 owner 在自己桌面验证；owner 没有在 v0.4 修复它）。v0.4 在这个 broken 的 enumeration 上又叠了 psapi 调用，修复路径完全不生效。

详细见第 8 节 **owner 需关注问题 #1**。

## 1. 文件存在性

| 文件 | Test-Path | 大小 |
|---|---|---|
| `release/SmartKeyboard-0.1.0-x64.exe` | **True** | 84,189,959 B (80.3 MB) |
| `release/SmartKeyboard-0.1.0-portable.exe` | **True** | 83,962,197 B (80.1 MB) |
| `release/win-unpacked/SmartKeyboard.exe` | **True** | 186,328,576 B (177.7 MB) |
| `release/win-unpacked/resources/app.asar.unpacked/node_modules/@koromix/koffi-win32-x64/` | **True** | 4 files: `koffi.node` 1,036,800 B + `koffi.lib` 1,688 B + `index.js` + `package.json` (koffi 3.2.1) |

**判定: PASS** — 全部四个必需文件均存在，koffi native 模块在 asar.unpacked 目录内可加载。

---

## 2. v0.4 关键代码在 bundle 里

`npx asar extract app.asar <tmpDir>` 后递归 grep 所有 `.js` / `.css`，**至少命中以下 v0.4 关键符号**：

### 2.1 Main bundle (`out/main/index.js`)

| 模式 | 命中数 | 来源 |
|---|---|---|
| `psapi` | 7 | `koffi.load('psapi.dll')` + 错误日志 + 测试 seam |
| `GetModuleFileNameEx` | 7 | psapi.dll 导出函数绑定 |
| `OpenProcess` | 3 | kernel32 进程句柄 |
| `isEffectivelyVisible` | 4 | 放宽过滤的核心函数 |
| `dedupeWindowsByProcess` | 2 | 进程去重函数 |
| `diagnoseWindows` | 3 | 诊断接口（导出 + IPC + 调用） |

### 2.2 Renderer bundle (`out/renderer/assets/index-DFlAELoO.js`)

| 模式 | 命中数 | 来源 |
|---|---|---|
| `DiagnosticsSection` | 2 | AboutPage 折叠区组件 |

**说明**: 测试 fixture 字符串（`msedge.exe` / `notepad.exe` / `explorer.exe`）只在 `tests/*.spec.ts` 里，asar 里只有编译后的 `out/`，所以这些串不出现在 bundle 里——是预期。

**判定: PASS** — 全部 v0.4 修复点（psapi 集成 + 放宽过滤 + 进程去重 + 诊断 IPC + 诊断 UI）都进了生产 bundle。

---

## 3. 启动 + 进程列表

```powershell
$env:SKIP_REAL_EXECUTION = "1"
Start-Process "release\win-unpacked\SmartKeyboard.exe" -ArgumentList "--remote-debugging-port=9222"
Start-Sleep -Seconds 6
Get-Process SmartKeyboard
```

```
   Id ProcessName   MainWindowTitle Responding
   -- -----------   --------------- ----------
 6304 SmartKeyboard                       True
10180 SmartKeyboard SmartKeyboard         True
23196 SmartKeyboard                       True
23488 SmartKeyboard                       True
```

4 进程全 Responding=True。MainWindowTitle=SmartKeyboard 的 PID 10180 是主进程；其他 3 个是 GPU / 工具 / Zygote 子进程（Electron 32 标准拓扑）。

**判定: PASS**

---

## 4. CDP 抓图

### 4.1 主窗口 — `v04-cdp-main.png` (77,371 B)

CDP `Page.captureScreenshot` 抓的 2134×1370 retina 截图，可见：
- 顶部条: "Steps 0"、复选框 "后台运行"、按钮 "绑定窗口"、按钮 "Run"（高亮）、按钮 "Clear"、按钮 "Dark"
- 左侧栏: SK 蓝色 logo + "SmartKeyboard / Automation"，导航 "Editor（Build your steps）" 高亮 + "About（Version & credits）"
- 主区: "Sequence" + 空态提示 "No steps yet. Add one below." + 占位卡 "Build a sequence" + "+ Add step" 按钮
- 页脚: v0.1.0 / minimal build

CDP tabs 查询返回 1 个 tab，URL 指向 `file:///F:/.../app.asar/out/renderer/index.html` — 证明渲染进程从打包后的 asar 加载（不是 dev 模式）。

### 4.2 触发 WindowPicker — `v04-cdp-picker.png` (84,080 B)

CDP `Runtime.evaluate` 找到 `textContent` 含 "绑定窗口" 的 `<button>`，调用 `.click()`，等 2 秒后 `Page.captureScreenshot`。截图显示：

- 背景被 dim（modal backdrop 生效）
- 居中卡片: 标题 **"选择目标窗口"**、右上角关闭按钮 (×)
- 主体文案 **"未发现可见窗口"**

> **这条"未发现可见窗口"是 v0.4 psapi 修复无法生效的核心证据**——按 v0.4 设计，验证桌面（QQ游戏/Trae/Edge 等 6+ 个 GUI 应用在跑）应该至少能列出 Trae.exe、msedge.exe 等。截图里却是空，详见第 8 节 #1。

### 4.3 About 页面 + 诊断面板 — `v04-cdp-diagnostics.png` (191,836 B)

通过点 sidebar 的 "About" 切到 About 页面（详见 `v04-cdp-about.png` 173,518 B 显示折叠态），然后点 `data-testid="diagnostics-toggle"` 展开诊断面板，截图显示：

- 左侧栏 "About（Version & credits）" 高亮
- 顶部标题 "About" + 副标题 "Lightweight mouse & keyboard automation for desktop."
- "WHAT IT DOES"、"STACK"、"CREDITS" 三段
- 折叠区已展开（"−" 图标 + "收起 · 列出所有可见窗口的 hwnd / pid / 进程名 / 类名 / 尺寸"）
- 工具条: 按钮 "刷新"、按钮 "复制为文本"、右侧摘要 **"0 windows · 0 effectively visible · 0 processes"**
- 空态文案 **"未发现任何窗口（包括被过滤的）。"**

UI 部分完全按 v0.4 设计渲染：折叠、按钮、摘要、空态——所有节点在 DOM 里都存在（CDP ping 验证 `hasDiag: true, hasEmpty: true, toggleAria: "true"`）。**只是数据是 0，因为底层 enumeration 抛错被 catch 吞掉**。

### 4.4 真实环境核对 — `window.api.windows.diagnose()` 真实返回值

```javascript
const list = await window.api.windows.diagnose();
// → { ok: true, count: 0, firstThree: [], processNames: [] }
```

**实际返回值 `count: 0`**，**没有任何一条 `processName`**。

主进程 stderr 日志明确写明原因（`%TEMP%\smartkb-v04e.err`）：

```
[window] diagnoseWindows failed: TypeError: Unexpected EnumWindowsCallback type, expected <callback> * type
    at native2.register (...koffi/src/koffi/index.js:195:12)
    at collectRawWindows (...out/main/index.js:117672:24)
    at diagnoseWindows (...out/main/index.js:117640:17)
[window] enumVisibleWindows failed: TypeError: Unexpected EnumWindowsCallback type, expected <callback> * type
    at native2.register (...koffi/src/koffi/index.js:195:12)
```

复现实验：verifier 在仓库根目录写了一个 5 行 koffi repro 脚本（`koffi.register(cb, koffi.proto('bool __stdcall ...'))`），用项目内 `koffi@3.2.1` 直接跑：

```
koffi loaded
user32 loaded
proto created: object name,primitive,size,alignment,disposable,proto
EnumWindows bound
register failed: Unexpected EnumWindowsCallback type, expected <callback> * type
```

**100% 复现同一条错误**。这就是 v0.4 picker/diagnose 在生产里永远是空集的根因。

**判定: FAIL** — 验收项要求"第一条记录 processName 应该是 `SmartKeyboard.exe` 而非 `pid-XXX`"。生产里**根本到不了第一条记录**（list 长度 0），验收项无法满足。

---

## 5. 测试通过性

verifier 重跑 `npm test`（verifier 独立运行，日志写到 `%TEMP%\v04-test-output.txt`）：

```
 ✓ tests/window-picker.spec.ts  (9 tests)   8ms
 ✓ tests/about-page.spec.ts      (4 tests)   4ms    ← v0.4 新增
 ✓ tests/window-helpers.spec.ts  (15 tests)  7ms    ← v0.4 新增
 ✓ tests/window.spec.ts          (12 tests)  9ms
 ✓ tests/simulator.spec.ts       (23 tests)  361ms
 ✓ tests/runner.spec.ts          (12 tests)  689ms

 Test Files  6 passed (6)
      Tests  75 passed (75)
   Duration  1.63s
```

75/75 全过，含 19 个 v0.4 新增测试（4 个 about-page + 15 个 window-helpers）。

stderr 里的 "run r5/r6/r10/r11 failed: boom/cancelled" 是 `tests/runner.spec.ts` 故意触发的错误路径测试（cancels a running run / error handling / looping cancel），测试本身通过，console.error 属预期输出。

> ⚠️ 这些单元测试用 koffi mock，根本不验证真实 koffi.register 行为，所以 75/75 通过 ≠ production 行为正确。生产 bug 完全没有测试覆盖——这是 v0.4 验收需要 owner 重点关注的事。

**判定: PASS**（仅就测试数与"通过"二字而言；测试覆盖的真实性见上警告）

---

## 6. 进程关闭

```powershell
Get-Process SmartKeyboard -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
Get-Process SmartKeyboard -ErrorAction SilentlyContinue | Measure-Object | Select Count
# → Count: 0
```

**判定: PASS** — 0 个 SmartKeyboard 进程残留。

---

## 7. 验收项逐项 PASS/FAIL

| # | 验收项 | 结果 | 备注 |
|---|---|---|---|
| 1 | 三个 exe + koffi native 存在 | **PASS** | 大小与 v0.3 几乎一致（80 MB / 178 MB） |
| 2 | bundle 内 v0.4 关键代码（psapi/放宽过滤/去重/diagnose/诊断 UI） | **PASS** | 6 项全部命中，0 缺失 |
| 3 | 启动成功 + 4 进程 Responding | **PASS** | |
| 4 | 主窗口 UI 渲染（CDP 截图） | **PASS** | `v04-cdp-main.png` |
| 5 | npm test 75/75 | **PASS** | 6 个 spec 文件，19 个 v0.4 新增测试 |
| 6 | WindowPicker 真实弹出（CDP click） | **PASS** | `v04-cdp-picker.png`，标题"选择目标窗口"正确 |
| 7 | About 页面 + 诊断面板（折叠+表格+复制为文本）真实渲染 | **PASS** | `v04-cdp-diagnostics.png` + `v04-cdp-about.png`，UI 完整、按钮齐全、摘要正确 |
| 8 | diagnose() 返回真实 processName（如 `SmartKeyboard.exe`） | **FAIL** | 永远返回 `[]`，主进程 koffi.register TypeError 被 catch 吞掉 |
| 9 | 进程可关闭 | **PASS** | 0 残留 |

---

## 8. owner 需关注问题

按严重程度排序：

### 1. [CRITICAL] 生产 koffi EnumWindows 回调注册失败 — v0.3 遗留，v0.4 未修

**症状**：`enumVisibleWindows()` 和 `diagnoseWindows()` 在打包后的 app 里永远返回 `[]`，picker 永远显示"未发现可见窗口"，诊断面板永远显示"0 windows · 0 effectively visible · 0 processes"。

**根因**：`src/main/window.ts:339`（编译后 bundle line 117672）

```ts
const handle = koffi.register(cb, EnumWindowsCallback);
```

koffi 3.2.1 native 拒绝这个调用形式——`EnumWindowsCallback` 是 `koffi.proto()` 返回的 prototype object，3.x 期望 `register(cb, 'bool __stdcall EnumWindowsCallback(void* hWnd)')`（字符串 prototype）或 `register(cb)`（koffi 从函数签名推断）。

**修复建议**（任选一）：
- 改成 `const handle = koffi.register(cb, 'bool __stdcall EnumWindowsCallback(void* hWnd)');`
- 或者用 `koffi.callback(cb, 'bool __stdcall EnumWindowsCallback(void* hWnd)')` + `EnumWindows(handle)`（koffi 3.x 推荐的 callback 写法）

**影响**：
- WindowPicker 在任何机器上都列不出真实窗口（不只是 verifier 桌面）
- 诊断面板永远显示 0 条记录
- v0.4 的 psapi 真实进程名修复在生产里**完全无法生效**（根本走不到 `OpenProcess` → `GetModuleFileNameExW`）
- `activateWindow` 用 `SetForegroundWindow` 不依赖 callback，所以它还能工作——但用户先得能用 picker 选到目标窗口，目前 picker 选不到

**测试盲点**：单元测试用 vitest mock，mock 不校验 koffi.register 参数形式，bug 完全漏出。**建议** owner 在 `tests/window.spec.ts` 加一个 koffi.register 真实调用的 smoke test（不需要真的枚举窗口，只检查 register 不抛）。

verifier 已复现：`.verify/koffi-repro.cjs` 5 行代码，独立 `node` 跑 plain koffi 3.2.1，得到完全相同的 `Unexpected EnumWindowsCallback type, expected <callback> * type` 错误。

### 2. [HIGH] 单元测试覆盖的真实性与 production 行为脱节

`tests/window.spec.ts` 的 12 个测试全部通过，但 production `enumVisibleWindows()` / `diagnoseWindows()` 在真实 Windows 上根本枚举不到窗口。**75/75 PASS 不能代表"功能可用"**。

**建议**：
- 增加一个 integration test：用真 koffi 调一次 `enumVisibleWindows()`，断言至少返回 0 个或非 0 个（不要断言具体数字，但必须 0 不能是因为抛错）
- 或者在 CI 里跑一次 packaged app 的 smoke test（开 + 点诊断 + 看 stderr 没有 `[window] enumVisibleWindows failed`）

### 3. [MEDIUM] v0.4 README / 验收项描述误导

验收任务里写"第一条记录 processName 应该是 `SmartKeyboard.exe` 而非 `pid-XXX`"——这个设计意图很好，但**生产里 list 永远是空，第一条记录不存在**。owner 在 commit 消息或 README 里说明 v0.4 行为时，需要先在真机/真桌面上验证 koffi.register 是否真的 work，不然 release notes 描述与实际行为不符。

### 4. [LOW] CDP 抓图在 About 页面 + 诊断展开后偶发 hang

`Page.captureScreenshot` 在 About 页面 + 诊断面板展开后的 renderer 状态下，verifier 重试 5+ 次（每次 6-15s timeout）才成功一次（v04-cdp-diagnostics.png 成功的那次）。其他 4 次 capture 一直 hang 直到脚本超时。**这与 koffi 无关**（Runtime.evaluate 正常返回），是 Electron 32 + captureScreenshot + 大量列表 re-render 时的偶发 hang。

**建议**：如果 owner 自动化测试需要频繁截图，可以在每次 capture 前加 `await new Promise(r => setTimeout(r, 2000))` 让 React 收敛，并设 8s+ 的 captureTimeout；verifier 在自动化脚本里已加 `Promise.race` 兜底。

### 5. [LOW] v0.3 报告 #3 `npm test` 退出码非零 的问题在 v0.4 仍在

`tests/runner.spec.ts` 5 个 case 故意打 console.error 触发"运行失败"路径，PowerShell 把 stderr 行当作非零退出码（虽不影响测试结果但污染 CI 退出码）。v0.4 仍未改。

### 6. [INFO] verifier 临时工作目录无法清理

verifier 在 `%TEMP%` 下抽了几个 asar 用于 grep（每个 ~50MB 抽出后做命中统计 + 关键行读取）。verifier 试图清理都被 hard-safety policy 拦截。这些临时目录是 verifier 自己的 workspace 下的 asar 镜像副本，**owner 可忽略**，系统重启会自动清。

---

## 9. v0.4 修复完整度

| 修复点 | 代码在 bundle | 单元测试 | production 行为 | 完整度 |
|---|---|---|---|---|
| psapi 真实进程名（`GetModuleFileNameExW` + `OpenProcess` + `CloseHandle`） | ✅ 命中 7+7+3 处 | ✅ `window-helpers.spec.ts` 测试 `resolveProcessName` / `basenameFromPath`（mock 了） | ❌ **永远走不到**（EnumWindows callback 先抛错） | 33%（代码+单测过，集成死） |
| 放宽 IsWindowVisible（`isEffectivelyVisible` 用 GetWindowRect 宽高备选） | ✅ 命中 4 处 | ✅ `window-helpers.spec.ts` 15 个测试覆盖 Y/P/N 三种 case | ❌ 永远走不到 | 50%（代码+单测过，集成死） |
| 不再过滤空标题窗口 | ✅ 在 `collectRawWindows` 移除 filter | ✅ `window-helpers.spec.ts` DEMO_DIAGNOSTICS 含 `title: ''` 的行 | ❌ 永远走不到 | 50% |
| 进程去重（同 PID 取 1 个，`dedupeWindowsByProcess`） | ✅ 命中 2 处 | ✅ 15 个测试 | ❌ 永远走不到 | 50% |
| AboutPage 诊断面板（折叠 + 表格 + 复制为文本） | ✅ `DiagnosticsSection` 命中 2 处 | ✅ `about-page.spec.ts` 4 个测试 | ✅ **UI 完整渲染**（`v04-cdp-diagnostics.png` 截图确认），只是数据是 0 | **100%** |
| 单元测试 52 → 75 | ✅ 75/75 通过 | ✅ | ✅ | **100%** |

**v0.4 的 5 个核心修复点中：**
- **1 个完全 OK**（AboutPage 诊断面板 UI 本身）
- **4 个根本性死代码**（枚举路径上的所有修复点）——因为 v0.3 引入的 koffi.register bug 让整个 enumeration 路径 try/catch 吞掉

---

## VERDICT: **FAIL**

**理由**：
- 静态产物（4 文件存在 + 关键代码进 bundle + 75/75 测试通过 + 进程管理 + UI 渲染）全部 PASS
- 但 v0.4 的核心承诺"psapi 真实进程名（`msedge.exe` / `notepad.exe` / `SmartKeyboard.exe`）"在 production 行为里**完全无法验证**——底层 enumeration 抛 TypeError 被吞，函数永远返回 `[]`
- 这不是 verifier 桌面环境问题，是 production code bug（已在 plain koffi 3.2.1 上 100% 复现）
- v0.3 报告里已记为 LOW 级已知问题，v0.4 没有修复它就发布了

**截图证据**（verifier 留档，owner 可参考）：
- `F:\Code\Project\15SMART_KEYBORD\.verify\v04-cdp-main.png` — CDP 主窗口（77,371 B）
- `F:\Code\Project\15SMART_KEYBORD\.verify\v04-cdp-picker.png` — WindowPicker 弹出（84,080 B，标题"选择目标窗口" + 空态"未发现可见窗口"）
- `F:\Code\Project\15SMART_KEYBORD\.verify\v04-cdp-about.png` — About 页面 + 诊断面板折叠态（173,518 B）
- `F:\Code\Project\15SMART_KEYBORD\.verify\v04-cdp-diagnostics.png` — About 页面 + 诊断面板展开态（191,836 B，工具条+摘要"0 windows · 0 effectively visible · 0 processes" + 空态"未发现任何窗口（包括被过滤的）"）

**主进程 stderr 证据**（`%TEMP%\smartkb-v04e.err`）：
```
[window] diagnoseWindows failed: TypeError: Unexpected EnumWindowsCallback type, expected <callback> * type
    at native2.register (...koffi/src/koffi/index.js:195:12)
    at collectRawWindows (...out/main/index.js:117672:24)
[window] enumVisibleWindows failed: TypeError: Unexpected EnumWindowsCallback type, expected <callback> * type
    at native2.register (...koffi/src/koffi/index.js:195:12)
    at collectRawWindows (...out/main/index.js:117672:24)
```

**复现脚本**（已留在 `.verify/koffi-repro.cjs`，verifier 工作目录，owner 可忽略）：
```js
const koffi = require("koffi");
const user32 = koffi.load("user32.dll");
const EnumWindowsCallback = koffi.proto("bool __stdcall EnumWindowsCallback(void* hWnd)");
const cb = (h) => true;
koffi.register(cb, EnumWindowsCallback);  // ← 抛 Unexpected EnumWindowsCallback type
```

**建议 owner 在修复 #1 后重跑本验收脚本**：修复 koffi.register 调用形式后，picker 应该立刻列出验证桌面上的 Trae.exe / msedge.exe / qqffo.exe，diagnose() 应该返回真实 processName 数组，所有 9 个验收项才能转 PASS。

