// 最小化的 logger 模块，给 tian-shi/index.ts 这种商业 wrapper 提供 logger 对象。
//
// tian-shi wrapper 是用户提供的本地封装，原文里只 import 了 logger.info / warn / error 三个方法。
// 我们不修改 wrapper，因此提供一个最小可用的实现（统一走 console）。
//
// 命名空间按 wrapper 的 import 路径还原：`../../utils/logger` ← `src/auto-plugin/tian-shi/index.ts`
// 落到 `src/auto-plugin/utils/logger.ts`。
//
// 注意：这个文件不是项目主日志系统（项目主日志走 src/main 内 console.*）。
// 它的唯一职责是让 wrapper 能 import 通；wrapper 真正被用到时（且仅在 dev 模式 + dll + winax 都齐全时），
// 这里的 info/warn/error 会把天使插件的版本信息 / 注册返回码打到主进程 console。

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, args: unknown[]): void {
  // 用 console 输出，前缀方便和项目自己的日志区分。
  // 不做时间戳、不做文件落盘：wrapper 是本地闭源插件，它的日志我们只看不存。
  // eslint-disable-next-line no-console
  console[level]('[tian-shi]', ...args);
}

export const logger = {
  info: (...args: unknown[]): void => emit('info', args),
  warn: (...args: unknown[]): void => emit('warn', args),
  error: (...args: unknown[]): void => emit('error', args)
};
