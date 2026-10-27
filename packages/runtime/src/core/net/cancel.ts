/**
 * 取消源：一个**不依赖 `AbortController`** 的最小实现。
 *
 * 为什么自己造：小游戏没有 `AbortController`，而三端必须共用同一个取消类型 ——
 * 否则业务侧写取消就要平台分支（AGENTS §2-5 禁）。
 *
 * 两条约定（测试钉着）：
 * 1. **幂等**：同一次取消只通知一次，重复 `abort()` 无效；
 * 2. **迟到注册也拿到通知**：已取消之后才 `onAbort()` 的，注册时立刻同步调一次
 *    —— 否则「先取消、后发请求」这条最常见的时序会静默漏掉。
 */

import type { CancelSignal, CancelSource } from './contract';

export const createCancel = (): CancelSource => {
  const listeners = new Set<() => void>();
  let aborted = false;

  const signal: CancelSignal = {
    get aborted(): boolean {
      return aborted;
    },
    onAbort(cb: () => void): () => void {
      if (aborted) {
        // 已经取消：立刻通知，注册本身不再留下任何东西
        cb();
        return () => {
          // 已经触发过，退订是空操作
        };
      }
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };

  const abort = (): void => {
    if (aborted) return;
    aborted = true;
    // 先快照再清空：回调里再 abort() 也不会重入，且这轮回调不会漏掉后面注册的
    const pending = [...listeners];
    listeners.clear();
    for (const cb of pending) {
      try {
        cb();
      } catch {
        // 单个回调抛错不该打断其余订阅者
      }
    }
  };

  return { signal, abort };
};
