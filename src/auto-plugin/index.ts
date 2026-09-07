import cp from 'child_process';
import TSPlug from './tian-shi';

// 中文注释：导出单例获取函数，集中管理 TianShi 插件实例（懒加载）
let __autoSingleton: TSPlug | null = null;
// 中文注释：是否已执行一次注册（手动控制，避免重复）
let __autoRegisteredOnce: boolean = false;
// 中文注释：最近一次注册返回码（便于展示或复用）
let __autoLastRegCode: number | undefined = undefined;

// 中文注释：注入注册码（天使插件只接 regCode，没有 attachCode 概念）
// 默认占位；如需真实注册码请在 main.ts 启动前覆盖
const DEFAULT_TIANSHI_REG_CODE = '';

// 中文注释：在调用 registerAutoOnce 前可通过此函数注入注册码
export const setTianShiRegCode = (code: string): void => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (TSPlug as any).__registerCode = code || DEFAULT_TIANSHI_REG_CODE;
};

export const ensureDamo = (): TSPlug => {
  // 中文注释：仅在首次调用时创建实例，后续复用，避免重复 COM 初始化
  if (!__autoSingleton) {
    __autoSingleton = new TSPlug();
    // 兜底：如果未注入注册码，使用默认空值（reg() 会容忍空实现）
    if (!(TSPlug as any).__registerCode) {
      setTianShiRegCode(DEFAULT_TIANSHI_REG_CODE);
    }
  }
  return __autoSingleton;
};

// 中文注释：判断当前进程是否以管理员运行
export const isElevated = (): boolean => {
  try {
    // fltmc 命令需要管理员权限，成功说明当前进程已提升（UAC 通过）
    cp.execSync('fltmc', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

// 中文注释：注册结果的接口类型（便于渲染或日志输出）
export interface DamoRegResult {
  // 中文注释：是否本次调用实际执行了注册（true 表示首次注册；false 表示之前已注册过）
  ran: boolean;
  // 中文注释：注册返回码（例如 1=成功，-2=非管理员等）
  code?: number;
  // 中文注释：返回码的中文说明（便于快速定位问题）
  desc?: string;
  // 中文注释：当前进程是否管理员（注册前后都可用于判断提示）
  admin?: boolean;
  // 中文注释：额外提示信息（例如"已注册无需重复"等）
  message?: string;
}

// 中文注释：注册返回码中文说明（与原 Damo 字典保持兼容）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const describeReg = (code?: number): string => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = code;
  switch (c) {
    case 1:
      return '成功';
    case 0:
      return '失败(未知错误)';
    case -1:
      return '无法连接网络/可能防火墙拦截或IP暂封';
    case -2:
      return '进程未以管理员运行(UAC 导致)';
    case 2:
      return '余额不足';
    case 3:
      return '绑定了本机器，但账户余额不足50元';
    case 4:
      return '注册码错误';
    case 5:
      return '机器或IP在黑名单/不在白名单';
    case 6:
      return '非法使用插件/系统语言非中文简体可能触发';
    case 7:
      return '帐号因非法使用被封禁';
    case 8:
      return '附加码不在白名单中';
    case 77:
      return '机器码或IP因非法使用被封禁(全局封禁)';
    case 777:
      return '同一机器码注册次数超限，暂时封禁';
    case -8:
      return '版本附加信息长度超过20';
    case -9:
      return '版本附加信息包含非法字符';
    default:
      return '未知返回码';
  }
};

// 中文注释：手动执行一次注册（兼容 Damo 命名），后续重复调用直接返回上次结果
export const registerDamoOnce = (): DamoRegResult => {
  const admin = isElevated();
  if (__autoRegisteredOnce) {
    return {
      ran: false,
      code: __autoLastRegCode,
      desc: describeReg(__autoLastRegCode),
      admin,
      message: '已注册，无需重复执行',
    };
  }
  const ts = ensureDamo();
  // 中文注释：TSPlug 的 reg() 0 参实现，调用前需注入 registerCode
  const code = ts.reg();
  __autoLastRegCode = code;
  __autoRegisteredOnce = true;
  return {
    ran: true,
    code,
    desc: describeReg(code),
    admin,
    message: '已尝试执行收费注册（天使插件）',
  };
};

// 中文注释：导出 AutoT 别名，指向 TianShi 插件
// 业务侧统一 import { AutoT } from '...' 即可，无需关心底层是 Damo 还是 TSPlug
export { TSPlug as AutoT };
export { TSPlug };
