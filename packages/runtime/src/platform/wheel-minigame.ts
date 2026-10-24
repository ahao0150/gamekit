/**
 * 小游戏端（wx / tt）的滚轮订阅装配（T36）。
 *
 * 为什么抽出来：微信和抖音的滚动 API 形状相同（`onWheel` / 可选 `offWheel`），
 * 差别只在**事件字段的可能缺失**。两份适配器各写一遍「懒注册 + 引用计数 + 退订」
 * 必然漂（一边漏 offWheel 是最常见的写法错误），所以这段只在 platform/ 里写一遍。
 *
 * 三条语义（wx / tt 共用，测试逐条钉）：
 * 1. 宿主没有 `onWheel`（手机端 / 老基础库）→ 返回 `null`，适配器**不暴露**这个成员：
 *    「成员在不在」就是能力信号，业务用 `platform.onWheel?.(...)` 判断；
 * 2. **懒注册**：第一个订阅者到来才调 `onWheel`，没人订阅时不占用宿主回调槽；
 * 3. **引用计数退订**：最后一个订阅者解绑时才调 `offWheel`（宿主没提供就跳过，
 *    此时平台侧会一直持有那一个回调 —— 那就一直留着，反正它只转发给空集合）。
 */

import type { OnWheel, WheelEvent } from './wheel-contract';

/** wx / tt 的滚轮 API 形状（字段名由各自 api.ts 的类型保证）。 */
export interface MiniWheelSource<E> {
  readonly onWheel?: ((cb: (res: E) => void) => void) | undefined;
  readonly offWheel?: ((cb?: (res: E) => void) => void) | undefined;
}

/**
 * 造一个小游戏端的 `onWheel`；宿主没有这个 API 时返回 null。
 *
 * `map` 负责把平台事件字段映射成契约事件（缺失字段填 0，绝不留 undefined/NaN）。
 */
export const createMiniWheel = <E>(
  source: MiniWheelSource<E>,
  map: (res: E) => WheelEvent,
): OnWheel | null => {
  const register = source.onWheel;
  if (typeof register !== 'function') return null;

  const listeners = new Set<(event: WheelEvent) => void>();
  let handler: ((res: E) => void) | null = null;
  /**
   * 注册代次：每次重新注册 +1。宿主的 `offWheel` 不保证真把回调摘掉
   * （部分基础库只是空实现），所以旧回调必须能识别「我过期了」并自行静默 ——
   * 否则一次退订再订阅就会让同一条滚轮事件被投递两次（滚动速度翻倍）。
   */
  let generation = 0;

  return (cb) => {
    listeners.add(cb);
    if (handler === null) {
      const gen = (generation += 1);
      const fn = (res: E): void => {
        if (gen !== generation) return;
        const event = map(res);
        for (const each of [...listeners]) each(event);
      };
      handler = fn;
      register(fn);
    }
    return () => {
      listeners.delete(cb);
      if (listeners.size > 0 || handler === null) return;
      source.offWheel?.(handler);
      handler = null;
    };
  };
};
