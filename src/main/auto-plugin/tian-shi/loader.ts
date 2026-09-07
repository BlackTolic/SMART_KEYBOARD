// TSPlug 加载器（adapter 层）
//
// 天使插件（TSPlug.dll）是商业闭源软件，本项目仅作为本地开发使用：
//   - dll 必须在 .gitignore 里（公开仓库不能分发）
//   - 运行时检测 dll 存在性，不存在则 fallback 到 nut-js
//   - release 模式 dll 路径通过 process.resourcesPath 找（user 手动放）
//
// 集成风险：调用 dll 不构成"分发"，但 release 包里如果带 dll 就违规。
// 我们的策略：dll 完全不进入 release 流程，public release 用户自己装 dll。
//
// 这个文件是 simulator 调用 dll 的唯一入口，约束：
//   1. 顶层不能 import 天使 wrapper（会触发 winax 静态 import，
//      而 winax 不是生产依赖，公开 release 用户的机器上没有）。
//      所以 wrapper 用动态 import() 加载，加载失败 → 标记 unavailable。
//   2. initTSPlug() 异步初始化，幂等，多次调用只初始化一次。
//   3. isTSPlugAvailable() 同步检查：实例已就绪才返回 true。
//      simulator 走的是同步分支：每步都先问"有 TSPlug 吗？"，有就用，
//      没有就 nut-js。这种模式要求 init 必须在第一次 run 之前完成，
//      所以 main/index.ts 在 app ready 后 await initTSPlug()。
//   4. 一旦 unavailable，进程内永远 unavailable（避免每次 step 都重试）。
//      dev 模式下 dll 路径变化需要重启主进程。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// wrapper 的实际类型用 any：wrapper 是用户提供的本地封装，TS 类型不一定完整。
// 我们只暴露 simulator 用到的几个方法（keyPressChar / moveTo / 等），其他不暴露。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSPlugInstance = any;

export interface TSPlugStatus {
  available: boolean;
  version: string | null;
  error: string | null;
  source: 'wrapper' | 'unavailable';
}

interface LoaderState {
  instance: TSPlugInstance | null;
  version: string | null;
  initError: string | null;
  // 三态：'idle'（未初始化）/ 'in_progress'（动态 import 进行中）/
  //       'done'（已确定 available 或 unavailable）
  phase: 'idle' | 'in_progress' | 'done';
  initPromise: Promise<boolean> | null;
}

const state: LoaderState = {
  instance: null,
  version: null,
  initError: null,
  phase: 'idle',
  initPromise: null
};

// ----- 路径解析 ------------------------------------------------------------
//
// dev 模式：源码路径 __dirname 往上找。
//   layout: src/main/auto-plugin/tian-shi/loader.ts
//   dll:    src/auto-plugin/tian-shi/lib/TSPlug.dll
//   path:   ../../../../auto-plugin/tian-shi/lib/TSPlug.dll
// release 模式：asar 化后 dll 找不到 → 返回 null → 走 fallback。
//   即使用户把 dll 放到 process.resourcesPath，我们也不自动注册：
//   注册是用户主动行为，loader 只负责"有没有"。

function getDllPathDev(): string {
  // 这里只可能在 Electron 主进程跑，import.meta.url 可用。
  const here = path.dirname(fileURLToPath(import.meta.url));
  // here 可能是 src/main/auto-plugin/tian-shi/（dev）或 out/main/auto-plugin/tian-shi/（build）。
  // 往上 3 级到 src/（dev）或 out/（build），再 append auto-plugin/tian-shi/lib/TSPlug.dll。
  //   dev:  src/main/auto-plugin/tian-shi/loader.ts → ../../../ → src/ → auto-plugin/tian-shi/lib/TSPlug.dll
  //   build: out/main/auto-plugin/tian-shi/loader.js → ../../../ → out/ → auto-plugin/tian-shi/lib/TSPlug.dll
  //   实际 dll 不会被打进 out/，所以 build 路径下 dll 永远不存在（fallback）。
  // vitest 加载时 import.meta.url 也是 src/main/auto-plugin/tian-shi/loader.ts，
  // 所以测试环境也能找到 dll（如果用户机器上有的话）。
  return path.resolve(here, '..', '..', '..', 'auto-plugin', 'tian-shi', 'lib', 'TSPlug.dll');
}

function getDllPathRelease(): string | null {
  // process.resourcesPath 只在 Electron 主进程可用；TS 单元测试环境没有。
  const rp = (process as unknown as { resourcesPath?: string }).resourcesPath;
  if (!rp) return null;
  return path.join(rp, 'TSPlug.dll');
}

function findDllPath(): string | null {
  // dev 模式优先（项目自身源代码路径）。release 模式（process.resourcesPath）
  // 只在 Electron 主进程有意义。
  const devPath = getDllPathDev();
  try {
    if (fs.existsSync(devPath)) return devPath;
  } catch {
    // 忽略，落到 release 路径
  }
  const relPath = getDllPathRelease();
  if (relPath) {
    try {
      if (fs.existsSync(relPath)) return relPath;
    } catch {
      // 忽略
    }
  }
  return null;
}

// ----- 加载入口 ------------------------------------------------------------

/**
 * 异步初始化 TSPlug。幂等：多次调用复用同一个 Promise。
 * 在 Electron 主进程 app ready 后调用一次（main/index.ts），
 * 等 Promise resolve 后再注册 IPC。
 *
 * 返回 true 表示 dll + COM 初始化成功，false 表示不可用（dll 缺失、
 * winax 缺失、注册失败等任一环节出错）。
 */
export function initTSPlug(): Promise<boolean> {
  if (state.phase === 'in_progress' && state.initPromise) {
    return state.initPromise;
  }
  if (state.phase === 'done') {
    return Promise.resolve(state.instance !== null);
  }
  state.phase = 'in_progress';
  state.initPromise = (async () => {
    // 第一步：先看 dll 在不在。在就不一定能用（还要 winax + 注册），不在则一定不能用。
    const dllPath = findDllPath();
    if (!dllPath) {
      state.initError = 'TSPlug.dll not found (expected src/auto-plugin/tian-shi/lib/TSPlug.dll in dev)';
      state.phase = 'done';
      console.log(`[tian-shi] unavailable: ${state.initError}`);
      return false;
    }

    // 第二步：动态加载 wrapper。loader 故意用 await import() 跳过模块顶层 winax 引用，
    // 这样 TSPlug 用不到的 release 机器上根本不会触发 winax 加载。
    try {
      // 相对路径相对当前 loader.ts；构建时 rollup 会把 import() 编译成同位置 require。
      // 注意：必须用 .js 后缀（即使源是 .ts），electron-vite 会做对应的编译映射。
      //
      // 这里用变量路径而不是字面量路径，是为了让 tsc 编译期不解析到 wrapper 文件
      // （wrapper 在 src/auto-plugin/ 下，不在 tsconfig.node.json 的 include 范围，
      // 而且它依赖的 winax 包也没装）。运行时由 electron-vite + Node 真实加载。
      const wrapperPath = '../../../auto-plugin/tian-shi/index.js';
      const mod = await import(wrapperPath);
      const TSPlugCtor: new () => TSPlugInstance =
        (mod as { default?: new () => TSPlugInstance }).default ??
        (mod as unknown as new () => TSPlugInstance);
      const inst = new TSPlugCtor();
      // 探测可用性：调 Ver() 拿版本号。返回空串 / 抛错都算不可用。
      let ver = '';
      try {
        if (typeof inst.Ver === 'function') {
          ver = String(inst.Ver() ?? '');
        }
      } catch (e) {
        state.initError = `TSPlug.Ver() threw: ${e instanceof Error ? e.message : String(e)}`;
        state.phase = 'done';
        console.log(`[tian-shi] unavailable: ${state.initError}`);
        return false;
      }
      if (!ver) {
        state.initError = 'TSPlug.Ver() returned empty (dll not registered or COM init failed)';
        state.phase = 'done';
        console.log(`[tian-shi] unavailable: ${state.initError}`);
        return false;
      }
      state.instance = inst;
      state.version = ver;
      state.phase = 'done';
      console.log(`[tian-shi] TSPlug loaded v${ver} (dll=${dllPath})`);
      return true;
    } catch (e) {
      state.initError = e instanceof Error ? e.message : String(e);
      state.phase = 'done';
      console.log(`[tian-shi] unavailable: ${state.initError}`);
      return false;
    }
  })();
  return state.initPromise;
}

/**
 * 同步检查 TSPlug 是否可用。init 完成后才返回 true。
 * simulator 在每步执行前调用，O(1) 只读 state。
 */
export function isTSPlugAvailable(): boolean {
  return state.phase === 'done' && state.instance !== null;
}

/**
 * 取 TSPlug 实例。不可用时抛错。
 * simulator 调用前应先用 isTSPlugAvailable() 探测。
 */
export function getTSPlug(): TSPlugInstance {
  if (!state.instance) {
    throw new Error(`TSPlug not available: ${state.initError ?? 'init in progress or failed'}`);
  }
  return state.instance;
}

/**
 * 状态报告：用于 IPC / 诊断面板展示。
 * 不会抛错，状态不安全也返回 snapshot。
 */
export function getTSPlugStatus(): TSPlugStatus {
  if (state.phase !== 'done') {
    return { available: false, version: null, error: null, source: 'unavailable' };
  }
  if (state.instance) {
    return {
      available: true,
      version: state.version,
      error: null,
      source: 'wrapper'
    };
  }
  return {
    available: false,
    version: null,
    error: state.initError,
    source: 'unavailable'
  };
}

// ----- 绑定辅助 ------------------------------------------------------------
//
// TSPlug 的后台键鼠模拟靠 BindWindow(hwnd, display, mouse, keypad, mode)。
// 绑定后键鼠消息直接进目标窗口的 message queue，不依赖 OS 前台焦点。
// 漏掉 UnBindWindow 会让目标进程一直持着独占 hook，对其他键鼠工具
// （包括我们自己的前台 nut-js 路径）产生干扰，所以必须 try/finally。

export interface BindOptions {
  // 'normal' = 前台抓图；'gdi' / 'dx' 系列 = 后台抓图
  display?: 'normal' | 'gdi' | 'gdi2' | 'dx' | 'dx2';
  // 'normal' = Win32 鼠标消息；'windows' / 'dx' = 后台/驱动级
  mouse?: 'normal' | 'windows' | 'windows2' | 'dx' | 'dx2';
  // 同 mouse
  keypad?: 'normal' | 'windows' | 'windows2' | 'dx' | 'dx2';
  // 0 = Normal 绑定（前台 + 后台都能用）
  mode?: 0 | 1 | 101 | 201 | 203;
}

const DEFAULT_BIND: Required<BindOptions> = {
  display: 'normal',
  mouse: 'normal',
  keypad: 'normal',
  mode: 0
};

/**
 * 在已绑定的 hwnd 上跑一段代码。BindWindow 失败也不抛错，
 * 直接跑 fn（让 fn 自己决定怎么退化），但日志会 warn。
 */
export async function withBoundHwnd<T>(
  hwnd: number | null | undefined,
  fn: (ts: TSPlugInstance) => Promise<T> | T,
  opts: BindOptions = {}
): Promise<T> {
  if (!hwnd || hwnd <= 0) {
    // 没有 hwnd：直接调 fn，TSPlug 走"全局"模式（前台 OS 焦点）。
    return fn(getTSPlug());
  }
  const ts = getTSPlug();
  const o = { ...DEFAULT_BIND, ...opts };
  let bound = false;
  try {
    const ret = ts.BindWindow(hwnd, o.display, o.mouse, o.keypad, o.mode);
    // TSPlug.BindWindow 返回 0 = 失败，1 = 成功（TsRet 枚举）
    if (ret === 0) {
      console.warn(`[tian-shi] BindWindow(hwnd=0x${hwnd.toString(16)}) failed, running without binding`);
    } else {
      bound = true;
    }
  } catch (e) {
    console.warn(`[tian-shi] BindWindow threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    return await fn(ts);
  } finally {
    if (bound) {
      try {
        ts.UnBindWindow();
      } catch (e) {
        console.warn(`[tian-shi] UnBindWindow threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}

// ----- 测试钩子 ------------------------------------------------------------
//
// 测试要能 reset state（防止多个 spec 互相影响）。生产代码不调用。

/** @internal 仅供测试用：重置 loader 内部状态。 */
export function __resetTSPlugForTests(): void {
  state.instance = null;
  state.version = null;
  state.initError = null;
  state.phase = 'idle';
  state.initPromise = null;
}
