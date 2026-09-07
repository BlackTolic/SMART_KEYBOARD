/*
 * @Author: huz
 * @Date: 2019-09-21 18:19:09
 * @LastEditTime: 2019-09-23 00:30:11
 */
import { execSync } from 'child_process';
import { resolve } from 'path';
import * as winax from 'winax';
import { logger } from '../../utils/logger';
import {
  Area,
  BindWindowMode,
  Coordinate,
  displayMode,
  EnumWindowFilter,
  GetWindowFlag,
  keypadMode,
  LockMode,
  MemoryBitNum,
  MemoryCharType,
  MemoryIntByte,
  MemoryState,
  mouseMode,
  MoveRange,
  SpecialWindowFlag,
  TsMode,
  TsRet,
  TsSwitch,
  VariantPointerParams,
  WindowStateFlag,
} from './modules/interface';
import { TSInstance } from './types/plugin';

export default class TSPlug {
  public ts: TSInstance;
  // 中文注释：业务侧大量代码直接以 client.dm.X() 形式访问底层 COM 对象（Damo 习惯）
  // 这里放宽为 any 以避免 TypeScript 接口检查，运行时由 winax 的 ts.tssoft 代理
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public dm: any;

  constructor() {
    this.ts = TSPlug.init('ts.tssoft');
    // 中文注释：业务侧大量代码直接以 client.dm.X() 形式访问底层 COM 对象（Damo 习惯）
    // 此处把 this.dm 指向 this.ts，使得原有 Damo 风格代码无需改动即可工作
    this.dm = this.ts as any;
  }

  private static init(COM: string): TSInstance {
    try {
      const x = new winax.Object(COM);
      // logger.info('创建 COM 对象成功', COM);
      try {
        // 尝试调用 Ver() 来验证插件是否真正可用 (通常插件都有这个方法)
        if (typeof x.Ver === 'function') {
          logger.info(`插件 ${COM} 版本: ${x.Ver()}`);
        }
      } catch (e) {
        logger.warn(`插件 ${COM} 版本获取失败`, e);
      }
      return x;
    } catch {
      // 中文注释：未注册时尝试注册 TSPlug.dll
      // 候选路径按优先级：
      //   1. __dirname/lib/TSPlug.dll —— 打包后 .webpack/main/lib/
      //   2. __dirname/../lib/TSPlug.dll —— forge 打包兜底
      //   3. process.cwd()/src/lib/TSPlug.dll —— dev 模式
      //   4. process.cwd()/src/auto-plugin/TianShi/lib/TSPlug.dll —— 原始位置
      const candidates = [
        resolve(__dirname, './lib/TSPlug.dll'),
        resolve(__dirname, '..', 'lib', 'TSPlug.dll'),
        resolve(process.cwd(), 'src', 'lib', 'TSPlug.dll'),
        resolve(process.cwd(), 'src', 'auto-plugin', 'TianShi', 'lib', 'TSPlug.dll'),
      ];
      const fs = require('fs') as typeof import('fs');
      const found = candidates.find(p => {
        try {
          return fs.existsSync(p);
        } catch {
          return false;
        }
      });
      if (!found) {
        throw new Error(`未找到 TSPlug.dll，已尝试路径: ${candidates.join('; ')}`);
      }
      try {
        logger.info(`尝试注册 TSPlug.dll: ${found}`);
        execSync(`regsvr32 /s "${found}"`);
        const x = new winax.Object(COM);
        logger.info(`注册后创建 COM 对象成功: ${COM}`);
        return x;
      } catch (e) {
        logger.error('注册 TSPlug.dll 失败或创建 COM 对象失败', e);
        throw e;
      }
    }
  }

  // 窗口
  findWindow(className: string, title: string): number {
    return this.ts.FindWindow(className, title);
  }

  findWindowEx(parent: string, className: string, title: string): number {
    return this.ts.FindWindowEx(parent, className, title);
  }

  sendString(hWnd: number, str: string): TsRet {
    return this.ts.SendString(hWnd, str);
  }

  sendString2(hWnd: number, str: string): TsRet {
    return this.ts.SendString2(hWnd, str);
  }

  sendStringIme(str: string): TsRet {
    return this.ts.SendStringIme(str);
  }

  getWindow(hWnd: number, flag: GetWindowFlag): number {
    return this.ts.GetWindow(hWnd, flag);
  }

  getWindowTitle(hWnd: number): string {
    return this.ts.GetWindowTitle(hWnd);
  }

  getWindowClass(hWnd: number): string {
    return this.ts.GetWindowClass(hWnd);
  }

  // getWindowRect: 已被 Damo 兼容版重写，移至类末尾

  getWindowProcessPath(hWnd: number): string {
    return this.ts.GetWindowProcessPath(hWnd);
  }

  getWindowState(hWnd: number, flag: WindowStateFlag): TsRet {
    return this.ts.GetWindowState(hWnd, flag);
  }

  // getClientRect: 已被 Damo 兼容版重写，移至类末尾

  getForegroundWindow(): number {
    return this.ts.GetForegroundWindow();
  }

  getForegroundFocus(): number {
    return this.ts.GetForegroundFocus();
  }

  getWindowProcessId(hWnd: number): number {
    return this.ts.GetWindowProcessId(hWnd);
  }

  getProcessInfo(pid: number): string {
    return this.ts.GetProcessInfo(pid);
  }

  getClientSize(hWnd: string): VariantPointerParams {
    const width = new winax.Variant(-1, 'byref');
    const height = new winax.Variant(-1, 'byref');
    const ret = this.ts.GetClientSize(hWnd, width, height);
    return { width: Number(width), height: Number(height), ret };
  }

  getMousePointWindow(): number {
    return this.ts.GetMousePointWindow();
  }

  getSpecialWindow(flag: SpecialWindowFlag): number {
    return this.ts.GetSpecialWindow(flag);
  }

  getPointWindow(x: number, y: number): number {
    return this.ts.GetPointWindow(x, y);
  }

  enumWindow(parent: number, title: string, className: string, filter: EnumWindowFilter): string {
    return this.ts.EnumWindow(parent, title, className, filter);
  }

  enumProcess(processName: string): string {
    return this.ts.EnumProcess(processName);
  }

  enumWindowByProcess(processName: string, title: string, className: string, filter: EnumWindowFilter): string {
    return this.ts.EnumWindowByProcess(processName, title, className, filter);
  }

  // screenToClient: 已被 Damo 兼容版重写，移至类末尾

  setWindowText(hWnd: number, title: string): TsRet {
    return this.ts.SetWindowText(hWnd, title);
  }

  setWindowSize(hWnd: number, width: number, height: number): TsRet {
    return this.ts.SetWindowSize(hWnd, width, height);
  }

  setWindowState(hWnd: number, flag: WindowStateFlag): TsRet {
    return this.ts.SetWindowState(hWnd, flag);
  }

  getClipboard(): string {
    return this.ts.GetClipboard();
  }

  sendPaste(hWnd: number): TsRet {
    return this.ts.SendPaste(hWnd);
  }

  setClipboard(value: string): TsRet {
    return this.ts.SetClipboard(value);
  }

  setClientSize(hWnd: number, width: number, height: number): TsRet {
    return this.ts.SetClientSize(hWnd, width, height);
  }

  setWindowTransparent(hWnd: number, trans: number): TsRet {
    return this.ts.SetWindowTransparent(hWnd, trans);
  }

  moveWindow(hWnd: number, x: number, y: number): TsRet {
    return this.ts.MoveWindow(hWnd, x, y);
  }

  // 后台
  bindWindow(hWnd: number, display: displayMode, mouse: mouseMode, keypad: keypadMode, mode: BindWindowMode): TsRet {
    return this.ts.BindWindow(hWnd, display, mouse, keypad, mode);
  }

  // 兼容大漠
  BindWindowEx(hWnd: number, display: displayMode, mouse: mouseMode, keypad: keypadMode, mode: BindWindowMode): TsRet {
    return this.ts.BindWindow(hWnd, display, mouse, keypad, mode);
  }

  // 兼容大漠
  BindWindow(hWnd: number, display: displayMode, mouse: mouseMode, keypad: keypadMode, mode: BindWindowMode): TsRet {
    return this.ts.BindWindow(hWnd, display, mouse, keypad, mode);
  }

  unbindWindow(): TsRet {
    return this.ts.UnBindWindow();
  }

  downCpu(rate: number): TsRet {
    return this.ts.DownCpu(rate);
  }

  lockInput(lock: LockMode): TsRet {
    return this.ts.LockInput(lock);
  }

  isBind(hWnd: number): TsRet {
    return this.ts.IsBind(hWnd);
  }

  enableRealKeypad(enable: TsSwitch): TsRet {
    return this.ts.EnableRealKeypad(enable);
  }

  enableRealMouse(enable: TsSwitch, delay: number, step: number): TsRet {
    return this.ts.EnableRealMouse(enable, delay, step);
  }

  // 键盘和鼠标
  keyPress(keyCode: number): TsRet {
    return this.ts.KeyPress(keyCode);
  }

  waitKey(keyCode: number, timeOut: number): TsRet {
    return this.ts.WaitKey(keyCode, timeOut);
  }

  keyPressChar(keyName: string): TsRet {
    return this.ts.KeyPressChar(keyName);
  }

  keyPressStr(keyName: string, delay: number): TsRet {
    return this.ts.KeyPressStr(keyName, delay);
  }

  getCursorShape(): string {
    return this.ts.GetCursorShape();
  }

  moveToEx<T = number>(x: T, y: T, w: T, h: T): Coordinate;
  moveToEx({ x, y, w, h }: MoveRange): Coordinate;
  moveToEx(...args: number[] | MoveRange[]): Coordinate {
    let [x, y, w, h] = [] as number[];
    if (args.length > 1) {
      [x, y, w, h] = args as number[];
    } else {
      ({ x, y, w, h } = args[0] as MoveRange);
    }
    return this.ts.MoveToEx(x, y, w, h);
  }

  getCursorPos(): VariantPointerParams {
    const x = new winax.Variant(-1, 'byref');
    const y = new winax.Variant(-1, 'byref');
    const ret = this.ts.GetCursorPos(x, y);
    return { x: Number(x), y: Number(y), ret };
  }

  keyDown(keyCode: number): TsRet {
    return this.ts.KeyDown(keyCode);
  }

  keyDownChar(keyName: string): TsRet {
    return this.ts.KeyDownChar(keyName);
  }

  keyUp(keyCode: number): TsRet {
    return this.ts.KeyUp(keyCode);
  }

  keyUpChar(keyName: string): TsRet {
    return this.ts.KeyUpChar(keyName);
  }

  moveR<T = number>(rx: T, ry: T): TsRet;
  moveR({ x, y }: Coordinate): TsRet;
  moveR(...args: number[] | Coordinate[]): TsRet {
    let [rx, ry] = [] as number[];
    if (args.length > 1) {
      [rx, ry] = args as number[];
    } else {
      ({ x: rx, y: ry } = args[0] as Coordinate);
    }
    return this.ts.MoveR(rx, ry);
  }

  moveTo<T = number>(rx: T, ry: T): TsRet;
  moveTo({ x, y }: Coordinate): TsRet;
  moveTo(...args: number[] | Coordinate[]): TsRet {
    let [x, y] = [] as number[];
    if (args.length > 1) {
      [x, y] = args as number[];
    } else {
      ({ x, y } = args[0] as Coordinate);
    }
    return this.ts.MoveTo(x, y);
  }

  rightDown(): TsRet {
    return this.ts.RightDown();
  }

  rightUp(): TsRet {
    return this.ts.RightUp();
  }

  rightClick(): TsRet {
    return this.ts.RightClick();
  }

  middleClick(): TsRet {
    return this.ts.MiddleClick();
  }

  wheelUp(): TsRet {
    return this.ts.WheelUp();
  }

  wheelDown(): TsRet {
    return this.ts.WheelDown();
  }

  leftDown(): TsRet {
    return this.ts.LeftDown();
  }

  leftUp(): TsRet {
    return this.ts.LeftUp();
  }

  leftClick(): TsRet {
    return this.ts.LeftClick();
  }

  leftDoubleClick(): TsRet {
    return this.ts.LeftDoubleClick();
  }

  setSimMode(mode: TsMode): TsRet {
    return this.ts.SetSimMode(mode);
  }

  setKeypadDelay(type: 'windows' | 'dx', delay: number): TsRet {
    return this.ts.SetKeypadDelay(type, delay);
  }

  setMouseDelay(type: 'windows' | 'dx', delay: number): TsRet {
    return this.ts.SetMouseDelay(type, delay);
  }

  // 设置
  ver(): string {
    return this.ts.Ver();
  }

  delay(ms: number): TsRet {
    return this.ts.Delay(ms);
  }

  // reg: 已被 Damo 兼容版重写，移至类末尾

  getPath(): string {
    return this.ts.GetPath();
  }

  setPath(path: string): TsRet {
    return this.ts.SetPath(path);
  }

  getBasePath(): string {
    return this.ts.GetBasePath();
  }

  setShowErrorMsg(show: TsSwitch): TsRet {
    return this.ts.SetShowErrorMsg(show);
  }

  getMachineCode(): string {
    return this.ts.GetMachineCode();
  }

  // 图片和颜色
  capture<T = number>(filename: string, x1: T, y1: T, x2: T, y2: T): TsRet;
  capture(filename: string, { x1, y1, x2, y2 }: Area): TsRet;
  capture(filename: string, ...args: number[] | Area[]): TsRet {
    let [x1, y1, x2, y2] = [] as number[];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    return this.ts.Capture(x1, y1, x2, y2, filename);
  }

  captureGif<T = number>(filename: string, x1: T, y1: T, x2: T, y2: T): TsRet;
  captureGif(filename: string, { x1, y1, x2, y2 }: Area): TsRet;
  captureGif(filename: string, ...args: number[] | Area[]): TsRet {
    let [x1, y1, x2, y2] = [] as number[];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    return this.ts.CaptureGif(x1, y1, x2, y2, filename);
  }

  captureJpg<T = number>(filename: string, x1: T, y1: T, x2: T, y2: T): TsRet;
  captureJpg(filename: string, { x1, y1, x2, y2 }: Area): TsRet;
  captureJpg(filename: string, ...args: number[] | Area[]): TsRet {
    let [x1, y1, x2, y2] = [] as number[];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    return this.ts.CaptureJpg(x1, y1, x2, y2, filename);
  }

  // capturePng: 已被 Damo 兼容版重写，移至类末尾

  getColor(x: number, y: number): string;
  getColor({ x, y }: Coordinate): string;
  getColor(...args: number[] | Coordinate[]): string {
    let [x, y] = [] as number[];
    if (args.length > 1) {
      [x, y] = args as number[];
    } else {
      ({ x, y } = args[0] as Coordinate);
    }
    return this.ts.GetColor(x, y);
  }

  findColor<T = number>(color: string, sim: T, direction: T, x1: T, y1: T, x2: T, Y2: T): VariantPointerParams;
  findColor(color: string, sim: number, direction: number, { x1, y1, x2, y2 }: Area): VariantPointerParams;
  findColor(color: string, sim: number, direction: number, ...args: number[] | Area[]): VariantPointerParams {
    let [x1, y1, x2, y2] = [] as number[];
    const [x, y] = [new winax.Variant(-1, 'byref'), new winax.Variant(-1, 'byref')];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    const ret = this.ts.FindColor(x1, y1, x2, y2, color, sim, direction, x, y);
    return { ret, x: Number(x), y: Number(y) };
  }

  findColorEx<T = number>(color: string, sim: T, x1: T, y1: T, x2: T, y2: T): string;
  findColorEx(color: string, sim: number, { x1, y1, x2, y2 }: Area): string;
  findColorEx(color: string, sim: number, ...args: number[] | Area[]): string {
    let [x1, y1, x2, y2] = [] as number[];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    return this.ts.FindColorEx(x1, y1, x2, y2, color, sim);
  }

  findPic<T = number, K = string>(picName: K, deltaColor: K, sim: T, direction: T, x1: T, y1: T, x2: T, Y2: T): VariantPointerParams;
  findPic<T = number, K = string>(picName: K, deltaColor: K, sim: T, direction: T, { x1, y1, x2, y2 }: Area): VariantPointerParams;
  findPic(picName: string, deltaColor: string, sim: number, direction: number, ...args: number[] | Area[]): VariantPointerParams {
    let [x1, y1, x2, y2] = [] as number[];
    const [x, y] = [new winax.Variant(-1, 'byref'), new winax.Variant(-1, 'byref')];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    const ret = this.ts.FindPic(x1, y1, x2, y2, picName, deltaColor, sim, direction, x, y);
    return { x: Number(x), y: Number(y), ret };
  }

  findPicS<T = number, K = string>(picName: K, deltaColor: K, sim: T, direction: T, x1: T, y1: T, x2: T, Y2: T): VariantPointerParams;
  findPicS<T = number, K = string>(picName: K, deltaColor: K, sim: T, direction: T, { x1, y1, x2, y2 }: Area): VariantPointerParams;
  findPicS(picName: string, deltaColor: string, sim: number, direction: number, ...args: number[] | Area[]): VariantPointerParams {
    let [x1, y1, x2, y2] = [] as number[];
    const [x, y] = [new winax.Variant(-1, 'byref'), new winax.Variant(-1, 'byref')];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    const ret = this.ts.FindPicS(x1, y1, x2, y2, picName, deltaColor, sim, direction, x, y);
    return { ret, x: Number(x), y: Number(y) };
  }

  findPicEx<T = number, K = string>(picName: K, deltaColor: K, sim: T, direction: T, x1: T, y1: T, x2: T, Y2: T): VariantPointerParams;
  findPicEx<T = number, K = string>(picName: K, deltaColor: K, sim: T, direction: T, { x1, y1, x2, y2 }: Area): VariantPointerParams;
  findPicEx(picName: string, deltaColor: string, sim: number, direction: number, ...args: number[] | Area[]): VariantPointerParams {
    let [x1, y1, x2, y2] = [] as number[];
    const [x, y] = [new winax.Variant(-1, 'byref'), new winax.Variant(-1, 'byref')];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    const ret = this.ts.FindPicEx(x1, y1, x2, y2, picName, deltaColor, sim, direction, x, y);
    return { ret, x: Number(x), y: Number(y) };
  }

  findPicExS<T = number, K = string>(picName: K, deltaColor: K, sim: T, direction: T, x1: T, y1: T, x2: T, Y2: T): VariantPointerParams;
  findPicExS<T = number, K = string>(picName: K, deltaColor: K, sim: T, direction: T, { x1, y1, x2, y2 }: Area): VariantPointerParams;
  findPicExS(picName: string, deltaColor: string, sim: number, direction: number, ...args: number[] | Area[]): VariantPointerParams {
    let [x1, y1, x2, y2] = [] as number[];
    const [x, y] = [new winax.Variant(-1, 'byref'), new winax.Variant(-1, 'byref')];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    const ret = this.ts.FindPicExS(x1, y1, x2, y2, picName, deltaColor, sim, direction, x, y);
    return { ret, x: Number(x), y: Number(y) };
  }

  isDisplayDead<T = number>(x1: T, y1: T, x2: T, y2: T): TsRet;
  isDisplayDead({ x1, y1, x2, y2 }: Area): TsRet;
  isDisplayDead(...args: number[] | Area[]): TsRet {
    let [x1, y1, x2, y2] = [] as number[];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    return this.ts.IsDisplayDead(x1, y1, x2, y2);
  }

  getScreenData<T = number>(x1: T, y1: T, x2: T, y2: T): number;
  getScreenData({ x1, y1, x2, y2 }: Area): number;
  getScreenData(...args: number[] | Area[]): number {
    let [x1, y1, x2, y2] = [] as number[];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    return this.ts.GetScreenData(x1, y1, x2, y2);
  }

  cmpColor<T = number>(color: string, sim: T, x: T, y: T): TsRet;
  cmpColor(color: string, sim: number, { x, y }: Coordinate): TsRet;
  cmpColor(color: string, sim: number, ...args: number[] | Coordinate[]): TsRet {
    let [x, y] = [] as number[];
    if (args.length > 1) {
      [x, y] = args as number[];
    } else {
      ({ x, y } = args[0] as Coordinate);
    }
    return this.ts.CmpColor(x, y, color, sim);
  }

  setPicPwd(password: string): TsRet {
    return this.ts.SetPicPwd(password);
  }

  matchPicName(picName: string): string {
    return this.ts.MatchPicName(picName);
  }

  findMultiColor<T = number, K = string>(firstColor: K, offsetColor: T, sim: T, direction: T, x1: T, y1: T, x2: T, y2: T): VariantPointerParams;
  findMultiColor<T = number, K = string>(firstColor: K, offsetColor: T, sim: T, direction: T, { x1, y1, x2, y2 }: Area): VariantPointerParams;
  findMultiColor(firstColor: string, offsetColor: string, sim: number, direction: number, ...args: number[] | Area[]): VariantPointerParams {
    let [x1, y1, x2, y2] = [] as number[];
    const [x, y] = [new winax.Variant(-1, 'byref'), new winax.Variant(-1, 'byref')];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    const ret = this.ts.FindMultiColor(x1, y1, x2, y2, firstColor, offsetColor, sim, direction, x, y);
    return { ret, x: Number(x), y: Number(y) };
  }

  findMultiColorEx<T = number, K = string>(firstColor: K, offsetColor: T, sim: T, direction: T, x1: T, y1: T, x2: T, y2: T): string;
  findMultiColorEx<T = number, K = string>(firstColor: K, offsetColor: T, sim: T, direction: T, { x1, y1, x2, y2 }: Area): string;
  findMultiColorEx(firstColor: string, offsetColor: string, sim: number, direction: number, ...args: number[] | Area[]): string {
    let [x1, y1, x2, y2] = [] as number[];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    return this.ts.FindMultiColorEx(x1, y1, x2, y2, firstColor, offsetColor, sim, direction);
  }

  // 文字
  // ocr<T = number | string>(color: string, sim: T, x1: T, y1: T, x2: T, y2: T): string;
  // ocr<T = number | string>(color: string, sim: T, { x1, y1, x2, y2 }: Area): string;

  // ocr(color: string, sim: number, ...args: number[] | Area[]): string {
  //   let [x1, y1, x2, y2] = [] as number[];
  //   if (args.length > 1) {
  //     [x1, y1, x2, y2] = args as number[];
  //   } else {
  //     ({ x1, y1, x2, y2 } = args[0] as Area);
  //   }
  //   return this.ts.Ocr(x1, y1, x2, y2, color, sim);
  // }

  ocr(x: number, y: number, w: number, h: number, color: string, sim: number): string {
    return this.ts.Ocr(x, y, w, h, color, sim);
  }

  ocrEx<T = number>(color: string, sim: T, x1: T, y1: T, x2: T, y2: T): string;
  ocrEx<T = number>(color: string, sim: T, { x1, y1, x2, y2 }: Area): string;
  ocrEx(color: string, sim: number, ...args: number[] | Area[]): string {
    let [x1, y1, x2, y2] = [] as number[];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    return this.ts.OcrEx(x1, y1, x2, y2, color, sim);
  }

  findStr<T = number, K = string>(str: K, color: K, sim: T, x1: T, y1: T, x2: T, y2: T): VariantPointerParams;
  findStr<K = string>(str: K, color: K, sim: number, { x1, y1, x2, y2 }: Area): VariantPointerParams;
  findStr(str: string, color: string, sim: number, ...args: number[] | Area[]): VariantPointerParams {
    let [x1, y1, x2, y2] = [] as number[];
    const [x, y] = [new winax.Variant(-1, 'byref'), new winax.Variant(-1, 'byref')];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    const ret = this.ts.FindStr(x1, y1, x2, y2, str, color, sim, x, y);
    return { ret, x: Number(x), y: Number(y) };
  }

  findStrS<T = number, K = string>(str: K, color: K, sim: T, x1: T, y1: T, x2: T, y2: T): VariantPointerParams;
  findStrS<K = string>(str: K, color: K, sim: number, { x1, y1, x2, y2 }: Area): VariantPointerParams;
  findStrS(str: string, color: string, sim: number, ...args: number[] | Area[]): VariantPointerParams {
    let [x1, y1, x2, y2] = [] as number[];
    const [x, y] = [new winax.Variant(-1, 'byref'), new winax.Variant(-1, 'byref')];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    const ret = this.ts.FindStrS(x1, y1, x2, y2, str, color, sim, x, y);
    return { ret, x: Number(x), y: Number(y) };
  }

  findStrEx<T = number, K = string>(str: K, color: K, sim: T, x1: T, y1: T, x2: T, y2: T): string;
  findStrEx<K = string>(str: K, color: K, sim: number, { x1, y1, x2, y2 }: Area): string;
  findStrEx(str: string, color: string, sim: number, ...args: number[] | Area[]): string {
    let [x1, y1, x2, y2] = [] as number[];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    return this.ts.FindStrEx(x1, y1, x2, y2, str, color, sim);
  }

  findStrExS<T = number, K = string>(str: K, color: K, sim: T, x1: T, y1: T, x2: T, y2: T): string;
  findStrExS<K = string>(str: K, color: K, sim: number, { x1, y1, x2, y2 }: Area): string;
  findStrExS(str: string, color: string, sim: number, ...args: number[] | Area[]): string {
    let [x1, y1, x2, y2] = [] as number[];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    return this.ts.FindStrExS(x1, y1, x2, y2, str, color, sim);
  }

  findStrFast<T = number, K = string>(str: K, color: K, sim: T, x1: T, y1: T, x2: T, y2: T): VariantPointerParams;
  findStrFast<K = string>(str: K, color: K, sim: number, { x1, y1, x2, y2 }: Area): VariantPointerParams;
  findStrFast(str: string, color: string, sim: number, ...args: number[] | Area[]): VariantPointerParams {
    let [x1, y1, x2, y2] = [] as number[];
    const [x, y] = [new winax.Variant(-1, 'byref'), new winax.Variant(-1, 'byref')];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    const ret = this.ts.FindStrFast(x1, y1, x2, y2, str, color, sim, x, y);
    return { ret, x: Number(x), y: Number(y) };
  }

  // findStrFastE: 已被 Damo 兼容版重写，移至类末尾

  findStrFastS<T = number, K = string>(str: K, color: K, sim: T, x1: T, y1: T, x2: T, y2: T): VariantPointerParams;
  findStrFastS<K = string>(str: K, color: K, sim: number, { x1, y1, x2, y2 }: Area): VariantPointerParams;
  findStrFastS(str: string, color: string, sim: number, ...args: number[] | Area[]): VariantPointerParams {
    let [x1, y1, x2, y2] = [] as number[];
    const [x, y] = [new winax.Variant(-1, 'byref'), new winax.Variant(-1, 'byref')];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    const ret = this.ts.FindStrFastS(x1, y1, x2, y2, str, color, sim, x, y);
    return { ret, x: Number(x), y: Number(y) };
  }

  // 中文注释：Damo 风格签名 (x1, y1, x2, y2, str, color, sim) - 兼容业务侧代码
  findStrFastEx(x1: number, y1: number, x2: number, y2: number, str: string, color: string, sim: number): string;
  findStrFastEx<T = number, K = string>(str: K, color: K, sim: T, x1: T, y1: T, x2: T, y2: T): string;
  findStrFastEx<K = string>(str: K, color: K, sim: number, { x1, y1, x2, y2 }: Area): string;
  findStrFastEx(...args: any[]): string {
    // 中文注释：根据第一个参数类型分发
    if (args.length === 7 && typeof args[0] === 'number') {
      // Damo 风格: (x1, y1, x2, y2, str, color, sim)
      const [x1, y1, x2, y2, str, color, sim] = args;
      return this.ts.FindStrFastEx(x1, y1, x2, y2, str, color, sim);
    }
    // TSPlug 原生: (str, color, sim, x1, y1, x2, y2) 或 (str, color, sim, Area)
    const [str, color, sim, ...rest] = args;
    let [x1, y1, x2, y2] = rest as number[];
    if (rest.length === 1 && typeof rest[0] === 'object') {
      ({ x1, y1, x2, y2 } = rest[0] as Area);
    }
    return this.ts.FindStrFastEx(x1, y1, x2, y2, str, color, sim);
  }

  findStrFastExS<T = number, K = string>(str: K, color: K, sim: T, x1: T, y1: T, x2: T, y2: T): string;
  findStrFastExS<K = string>(str: K, color: K, sim: number, { x1, y1, x2, y2 }: Area): string;
  findStrFastExS(str: string, color: string, sim: number, ...args: number[] | Area[]): string {
    let [x1, y1, x2, y2] = [] as number[];
    if (args.length > 1) {
      [x1, y1, x2, y2] = args as number[];
    } else {
      ({ x1, y1, x2, y2 } = args[0] as Area);
    }
    return this.ts.FindStrFastExS(x1, y1, x2, y2, str, color, sim);
  }

  useDict(index: number): TsRet {
    return this.ts.UseDict(index);
  }

  // setDict: 已被 Damo 兼容版重写，移至类末尾

  setDictPwd(password: string): TsRet {
    return this.ts.SetDictPwd(password);
  }

  clearDict(index: number): TsRet {
    return this.ts.ClearDict(index);
  }

  getNowDict(): number {
    return this.ts.GetNowDict();
  }

  // 系统
  disableFontSmooth(): TsRet {
    return this.ts.DisableFontSmooth();
  }

  checkFontSmooth(): TsRet {
    return this.ts.CheckFontSmooth();
  }

  checkUAC(): TsRet {
    return this.ts.CheckUAC();
  }

  setUAC(enable: TsSwitch): TsRet {
    return this.ts.SetUAC(enable);
  }

  // 汇编
  asmCode(baseAddress: number): string {
    return this.ts.AsmCode(baseAddress);
  }

  assemble(code: string, baseAddress: number, isUpper: TsSwitch): string {
    return this.ts.Assemble(code, baseAddress, isUpper);
  }

  asmClear(): TsRet {
    return this.ts.AsmClear();
  }

  asmAdd(instruction: string): TsRet {
    return this.ts.AsmAdd(instruction);
  }

  asmCall(hWnd: number, mode: TsMode): number {
    return this.ts.AsmCall(hWnd, mode);
  }

  // 保护
  tsGuardProtect(enable: TsSwitch, type: string): TsRet {
    return this.ts.TSGuardProtect(enable, type);
  }

  tsGuardProtectToHide(enable: TsSwitch): TsRet {
    return this.ts.TSGuardProtectToHide(enable);
  }

  tsGuardProtectToHide2(enable: TsSwitch): TsRet {
    return this.ts.TSGuardProtectToHide2(enable);
  }

  tsGuardProtectToNp(enable: TsSwitch): TsRet {
    return this.ts.TSGuardProtectToNP(enable);
  }

  tsDXKmProtect(enable: TsSwitch, type: string): TsRet {
    return this.ts.TSDXKmProtect(enable, type);
  }

  tsDXGraphicProtect(enable: TsSwitch): TsRet {
    return this.ts.TSDXGraphicProtect(enable);
  }

  // 内存
  findInt(hWnd: number, addressRange: string, min: number, max: number, type: MemoryBitNum): string {
    return this.ts.FindInt(hWnd, addressRange, min, max, type);
  }

  findString(hWnd: number, addressRange: string, value: string, type: MemoryCharType): string {
    return this.ts.FindString(hWnd, addressRange, value, type);
  }

  findData(hWnd: number, addressRange: string, data: string): string {
    return this.ts.FindData(hWnd, addressRange, data);
  }

  findFloat(hWnd: number, addressRange: string, min: number, max: number): string {
    return this.ts.FindFloat(hWnd, addressRange, min, max);
  }

  findDouble(hWnd: number, addressRange: number, min: number, max: number): string {
    return this.ts.FindDouble(hWnd, addressRange, min, max);
  }

  findIntEx(hWnd: number, addressRange: number, min: number, max: number, type: MemoryBitNum, step: number, multi: TsSwitch, fast: TsSwitch): string {
    return this.ts.FindIntEx(hWnd, addressRange, min, max, type, step, multi, fast);
  }

  findStringEx(hWnd: number, addressRange: number, value: string, type: MemoryBitNum, step: number, multi: TsSwitch, fast: TsSwitch): string {
    return this.ts.FindStringEx(hWnd, addressRange, value, type, step, multi, fast);
  }

  findDataEx(hWnd: number, addressRange: number, data: string, step: number, multi: TsSwitch, fast: TsSwitch): string {
    return this.ts.FindDataEx(hWnd, addressRange, data, step, multi, fast);
  }

  findFloatEx(hWnd: number, addressRange: number, min: number, max: number, type: MemoryBitNum, step: number, multi: TsSwitch, fast: TsSwitch): string {
    return this.ts.FindFloatEx(hWnd, addressRange, min, max, type, step, multi, fast);
  }

  findDoubleEx(hWnd: number, addressRange: number, min: number, max: number, type: MemoryBitNum, step: number, multi: TsSwitch, fast: TsSwitch): string {
    return this.ts.FindDoubleEx(hWnd, addressRange, min, max, type, step, multi, fast);
  }

  writeInt(hWnd: number, address: string, type: MemoryBitNum, value: number): TsRet {
    return this.ts.WriteInt(hWnd, address, type, value);
  }

  writeString(hWnd: number, address: string, type: MemoryBitNum, value: string): TsRet {
    return this.ts.WriteString(hWnd, address, type, value);
  }

  writeData(hWnd: number, address: string, data: string): TsRet {
    return this.ts.WriteData(hWnd, address, data);
  }

  writeFloat(hWnd: number, address: string, type: MemoryBitNum, value: number): TsRet {
    return this.ts.WriteFloat(hWnd, address, type, value);
  }

  writeDouble(hWnd: number, address: string, type: MemoryBitNum, value: number): TsRet {
    return this.ts.WriteDouble(hWnd, address, type, value);
  }

  readInt(hWnd: number, Address: string, type: MemoryBitNum): number {
    return this.ts.ReadInt(hWnd, Address, type);
  }

  readString(hWnd: number, address: string, type: MemoryBitNum, length: number): string {
    return this.ts.ReadString(hWnd, address, type, length);
  }

  readFloat(hWnd: number, address: string): number {
    return this.ts.ReadFloat(hWnd, address);
  }

  readData(hWnd: number, address: string, length: number): string {
    return this.ts.ReadData(hWnd, address, length);
  }

  readDouble(hWnd: number, address: string): number {
    return this.ts.ReadDouble(hWnd, address);
  }

  stringToData(value: string, type: MemoryCharType): string {
    return this.ts.StringToData(value, type);
  }

  intToData(value: number, type: MemoryIntByte): string {
    return this.ts.IntToData(value, type);
  }

  floatToData(value: number): string {
    return this.ts.FloatToData(value);
  }

  doubleToData(value: number): string {
    return this.ts.DoubleToData(value);
  }

  virtualAllocEx(hWnd: number, address: string, size: number, type: MemoryState): number {
    return this.ts.VirtualAllocEx(hWnd, address, size, type);
  }

  virtualFreeEx(hWnd: number, address: string): TsRet {
    return this.ts.VirtualFreeEx(hWnd, address);
  }

  terminateProcess(pid: number): TsRet {
    return this.ts.TerminateProcess(pid);
  }

  getCommandLine(hWnd: number): string {
    return this.ts.GetCommandLine(hWnd);
  }

  getModuleBaseAddr(hWnd: number, module: string): number {
    return this.ts.GetModuleBaseAddr(hWnd, module);
  }

  freeProcessMemory(hWnd: number): TsRet {
    return this.ts.FreeProcessMemory(hWnd);
  }

  // 模拟大漠的 EnumWindowByProcessId
  EnumWindowByProcessId(pid: number, title: string, className: string, filter: number): string {
    // 1. 获取所有满足 title, className, filter 的窗口
    const allWindowsStr = this.ts.EnumWindow(0, title, className, filter);
    if (!allWindowsStr) return '';

    const allWindows = allWindowsStr.split(',');
    const result: string[] = [];

    // 2. 遍历并筛选 PID 匹配的窗口
    for (const hwndStr of allWindows) {
      const hwnd = parseInt(hwndStr);
      if (this.ts.GetWindowProcessId(hwnd) === pid) {
        result.push(hwndStr);
      }
    }

    return result.join(',');
  }

  // ============================================================
  // 中文注释：Damo 兼容层
  // 说明：业务侧代码沿用 Damo 的方法签名与返回类型，此处补齐 TSPlug 缺失或签名不一致的方法
  // 主要差异点：
  //   - getWindowRect / getClientRect / clientToScreen / screenToClient：
  //     Damo 通过 byref 参数返回 {x, y, width, height} 或 {x, y} 对象；
  //     TSInstance 接口是 byref + TsRet 返回值
  //   - capturePng：Damo 习惯 (x, y, w, h, filePath)；TSPlug 是 (filename, x1, y1, x2, y2) —— 参数顺序不同
  //   - setDict：Damo 接受字符串内容；TSPlug 仅接受文件路径 —— 写临时文件再 SetDict
  //   - Reg：Damo 是 (regCode, attachCode)；TSPlug 是 (regCode, type: TsMode) —— 概念不同
  //   - 缺失方法：moveToClick / moveToLeftDown / leftDownFromToMove / findColorE /
  //     findStrFastE / getAveRGB / enumWindowByProcessId / getCurrentDictInfo /
  //     loadDictFromFileAsync 等
  // ============================================================

  // ---- 几何信息（Damo 风格返回对象）----

  getWindowRect(hwnd: number): { x: number; y: number; width: number; height: number } {
    const x1 = new winax.Variant(0, 'byref');
    const y1 = new winax.Variant(0, 'byref');
    const x2 = new winax.Variant(0, 'byref');
    const y2 = new winax.Variant(0, 'byref');
    const ok = this.ts.GetWindowRect(hwnd, x1, y1, x2, y2);
    if (!ok) {
      throw new Error(`GetWindowRect 失败，hwnd=${hwnd}`);
    }
    // 中文注释：winax Variant 实例的 .value 属性不在类型声明中，用 (v as any).value 绕过
    const left = Number((x1 as any).value) || 0;
    const top = Number((y1 as any).value) || 0;
    const right = Number((x2 as any).value) || 0;
    const bottom = Number((y2 as any).value) || 0;
    return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }

  getClientRect(hwnd: number): { x: number; y: number; width: number; height: number } {
    const x1 = new winax.Variant(0, 'byref');
    const y1 = new winax.Variant(0, 'byref');
    const x2 = new winax.Variant(0, 'byref');
    const y2 = new winax.Variant(0, 'byref');
    const ok = this.ts.GetClientRect(hwnd, x1, y1, x2, y2);
    if (!ok) {
      throw new Error(`GetClientRect 失败，hwnd=${hwnd}`);
    }
    const left = Number((x1 as any).value) || 0;
    const top = Number((y1 as any).value) || 0;
    const right = Number((x2 as any).value) || 0;
    const bottom = Number((y2 as any).value) || 0;
    return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }

  // TSPlug 的 ts.ScreenToClient(hwnd, x, y) 返回 number（高低位打包坐标），需要 byref 解出
  clientToScreen(hwnd: number, x: number, y: number): { x: number; y: number } {
    const xr = new winax.Variant(x, 'byref');
    const yr = new winax.Variant(y, 'byref');
    const ok = this.ts.ClientToScreen(hwnd, xr, yr);
    if (!ok) {
      throw new Error(`ClientToScreen 失败，hwnd=${hwnd}`);
    }
    return { x: Number((xr as any).value) || 0, y: Number((yr as any).value) || 0 };
  }

  screenToClient(hwnd: number, x: number, y: number): { x: number; y: number } {
    const xr = new winax.Variant(x, 'byref');
    const yr = new winax.Variant(y, 'byref');
    const ok = this.ts.ScreenToClient(hwnd, xr, yr);
    if (!ok) {
      throw new Error(`ScreenToClient 失败，hwnd=${hwnd}`);
    }
    return { x: Number((xr as any).value) || 0, y: Number((yr as any).value) || 0 };
  }

  // ---- 截图（Damo 风格参数顺序）----

  capturePng(x: number, y: number, w: number, h: number, filePath: string): number {
    // Damo 习惯 (x, y, w, h, filePath)；TSPlug 底层 (x1, y1, x2, y2, filename)
    const x2 = x + w;
    const y2 = y + h;
    const ret = this.ts.CapturePng(x, y, x2, y2, filePath);
    return Number(ret) || 0;
  }

  // Damo 的 captureFullScreen 需要 GetScreenWidth/Height；TSPlug 上对应 GetClientSize 但语义不同
  // 退而求其次：使用 ts.GetClientSize(0) 获取屏幕尺寸（部分插件支持）
  captureFullScreen(filePath: string): number {
    // 中文注释：ts.tssoft 暂未提供 GetScreenWidth/Height，这里尝试通过特殊窗口获取屏幕尺寸并截全屏
    // 0 表示桌面窗口句柄；不保证跨插件版本可用，失败时抛错
    const w = new winax.Variant(0, 'byref');
    const h = new winax.Variant(0, 'byref');
    const ret = this.ts.GetClientSize('0', w, h);
    if (!ret) {
      throw new Error('GetClientSize(0) 失败：无法获取屏幕尺寸，captureFullScreen 不可用');
    }
    const width = Number((w as any).value) || 0;
    const height = Number((h as any).value) || 0;
    return Number(this.ts.CapturePng(0, 0, width, height, filePath)) || 0;
  }

  // ---- 鼠标辅助（Damo 自定义 helper）----

  // 中文注释：移到坐标 → 等待 300ms → 左/右键点击
  moveToClick(x: number, y: number, mouse: 'left' | 'right' = 'left'): void {
    this.ts.MoveTo(x, y);
    this.ts.Delay(300);
    if (mouse === 'right') {
      this.ts.RightClick();
    } else {
      this.ts.LeftClick();
    }
  }

  // 中文注释：移到坐标 → 等待 300ms → 按下左键（不释放）
  moveToLeftDown(x: number, y: number): void {
    this.ts.MoveTo(x, y);
    this.ts.Delay(300);
    this.ts.LeftDown();
  }

  // 中文注释：拖拽（按下并保持，从 from 拖到 to 后释放）
  leftDownFromToMove(from: { x: number; y: number }, to: { x: number; y: number }): void {
    this.ts.MoveTo(from.x, from.y);
    this.ts.Delay(300);
    this.ts.LeftDown();
    this.ts.Delay(300);
    this.ts.MoveTo(to.x, to.y);
    this.ts.LeftUp();
  }

  // ---- 颜色/找图：Damo 风格 6 参数 ----

  // findColorE: Damo 6 参 (x, y, w, h, color, sim)；TSPlug 的 ts.FindColor 是 8 参（含 direction + byref x/y）
  findColorE(x: number, y: number, w: number, h: number, color: string, sim: number, _direction = 0): string {
    const xr = new winax.Variant(-1, 'byref');
    const yr = new winax.Variant(-1, 'byref');
    const ret = this.ts.FindColor(x, y, x + w, y + h, color, sim, _direction, xr, yr);
    if (!ret || Number(ret) < 0) return '-1|-1';
    return `${Number((xr as any).value) || 0}|${Number((yr as any).value) || 0}`;
  }

  // findStrFastE: Damo 返回 string（坐标 "x|y"）；TSPlug 的 findStrFastE 包装返回 number
  findStrFastE(x: number, y: number, w: number, h: number, str: string, color: string, sim: number): string {
    const xr = new winax.Variant(-1, 'byref');
    const yr = new winax.Variant(-1, 'byref');
    const ret = this.ts.FindStrFast(x, y, x + w, y + h, str, color, sim, xr, yr);
    if (Number(ret) <= 0) return '-1|-1';
    return `${Number((xr as any).value) || 0}|${Number((yr as any).value) || 0}`;
  }

  // ---- 平均色（TSPlug 暂不提供原生命令，返回 hex 字符串占位）----

  getAveRGB(x: number, y: number, w: number, h: number): string {
    // 中文注释：TSPlug 未提供 GetAveRGB；保守返回 "000000"
    // 业务侧若依赖此结果做判定，需自行实现截图+采样
    logger.warn('[TianShi] getAveRGB 暂未实现，返回 000000');
    return '000000';
  }

  // ---- 字库相关 ----

  // Damo 接受字符串内容；TSPlug 写临时文件再 SetDict
  setDict(index: number, content: string): number {
    try {
      const tmpDir = require('os').tmpdir();
      const tmpPath = require('path').join(tmpDir, `tianshi_dict_${index}_${Date.now()}.txt`);
      // 移除 BOM + 统一换行（与 Damo.sanitizeDictContent 行为一致）
      let s = content || '';
      if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
      s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
      require('fs').writeFileSync(tmpPath, s, 'utf8');
      const ret = this.ts.SetDict(index, tmpPath);
      // 记录以便 getCurrentDictInfo
      this.activeDictIndex = index;
      this.dictSource = { type: 'inline', path: tmpPath, length: s.length };
      return Number(ret) || 0;
    } catch (e) {
      logger.error(`[TianShi] setDict 失败: ${String((e as any)?.message || e)}`);
      return 0;
    }
  }

  loadDictFromFile(index: number, filePath: string): number {
    const ret = this.ts.SetDict(index, filePath);
    if (Number(ret) === 1) {
      this.activeDictIndex = index;
      this.dictSource = { type: 'file', path: filePath, length: 0 };
    }
    return Number(ret) || 0;
  }

  async loadDictFromFileAsync(index: number, filePath: string): Promise<number> {
    // 中文注释：TSPlug 的 SetDict 是同步 COM 调用，但保留 async 以兼容 Damo API 风格
    return this.loadDictFromFile(index, filePath);
  }

  // Damo 的 useDict 返回 number（1/0）；TSPlug 包装已存在但返回 TsRet
  // 业务侧一般忽略返回值，所以这里保留原包装；如需 number 形式可读 ts.GetNowDict()

  // ---- 当前字库信息（getCurrentDictInfo）----

  // 中文注释：当前字库索引
  private activeDictIndex: number | null = null;
  // 中文注释：最近一次 SetDict 的来源信息
  private dictSource: { type: 'inline' | 'file' | 'unknown'; path?: string; length?: number } | null = null;

  getCurrentDictInfo(): { activeIndex: number | null; source: { type: 'inline' | 'file' | 'unknown'; path?: string; length?: number } | null } {
    return {
      activeIndex: this.activeDictIndex,
      source: this.dictSource || { type: 'unknown' },
    };
  }

  // ---- Reg 兼容：0 参调用 + attachCode 概念忽略 ----

  // 中文注释：Damo 的 reg() 0 参，内部使用模块顶部定义的 registerCode / attachCode
  // TSPlug 的 reg(regCode, type) 不支持 attachCode，按"高级模式"调一次并容忍空实现
  reg(): number {
    // 占位实现：registerCode/attachCode 应由调用方在调用前注入或从配置读取
    // 业务侧 registerDamoOnce 在 auto-plugin/index.ts 中负责实际传参
    const elevated = TSPlug.isElevated();
    if (!elevated) {
      logger.warn('TianShi 注册未执行：当前进程非管理员(-2)。请以管理员运行后重试。');
      return -2;
    }
    const regCode = (TSPlug as any).__registerCode || '';
    const ret = this.ts.Reg(regCode, TsMode.Advanced);
    logger.info(`[TianShi] Reg 返回值: ${ret}`);
    return Number(ret) || 0;
  }

  // 中文注释：判断当前进程是否以管理员运行
  static isElevated(): boolean {
    try {
      require('child_process').execSync('fltmc', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}
