/**
 * mock 的滚轮控制面（T36）。
 *
 * 为什么单独一个文件：`mock/index.ts` 已经贴着 300 行上限（AGENTS 铁律 2），
 * 而滚轮是「可注入 + 可订阅」的一小块独立能力，和 `mock/keyboard.ts` 同一套做法。
 *
 * 与 wx / tt 的关键区别：mock **恒有** onWheel。它不是真实宿主，没有「这台设备
 * 有没有滚轮」可言 —— 测试与离线验收需要随时造一条滚轮事件，所以它永远在。
 */

import type { OnWheel, Unsubscribe, WheelEvent, WheelListener } from '../contract';

/** mock 的滚轮控制面：订阅（契约成员）+ 手动触发（测试专用）。 */
export interface MockWheelControls {
  /**
   * 契约成员：与真实平台同一套语义（坐标是画布逻辑坐标、delta 是像素）。
   *
   * 声明成可选：`PlatformAdapter.onWheel` 本身就是可选的，同一属性在两处必须
   * 同形，否则 `MockAdapter extends PlatformAdapter, MockWheelControls` 直接冲突
   * （TS2320）。mock 的实现**恒挂**它，所以运行时一定有。
   */
  onWheel?: OnWheel;
  /** 造一条滚轮事件发给所有订阅者。time 省略时用 0。 */
  emitWheel(x: number, y: number, deltaX: number, deltaY: number, time?: number): void;
}

export const createMockWheel = (): MockWheelControls => {
  const listeners = new Set<WheelListener>();
  return {
    onWheel: (cb: WheelListener): Unsubscribe => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    emitWheel(x, y, deltaX, deltaY, time = 0): void {
      const event: WheelEvent = { x, y, deltaX, deltaY, time };
      for (const cb of [...listeners]) cb(event);
    },
  };
};
