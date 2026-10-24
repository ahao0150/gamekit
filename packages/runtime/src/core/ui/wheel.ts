/**
 * 滚轮 → 滚动位的语义函数（T36，core 纯函数）。
 *
 * 为什么单独一个文件而不是塞进 `scroll.ts`：`scroll.ts` 是**拖动手势**的状态机
 * （跟手 / 惯性 / 边界），滚轮是**离散增量**，两者唯一共用的东西就是「钳制口径」。
 * 共用 `scrollClamp` 就够了，硬塞进同一个文件只会让两套语义互相污染
 * （比如给滚轮也加个 velocity 状态）。
 *
 * 三条语义（测试逐条钉）：
 * 1. `deltaY` 正 → 向下滚（scrollTop 变大）；负 → 向上；
 * 2. 结果一律钳到 `[0, maxScroll]`，`maxScroll <= 0` 时恒 0（内容比视口短 = 没得滚）；
 * 3. 脏输入（NaN / Infinity）不传染：返回钳制后的当前值，绝不产出 NaN。
 */

import { scrollClamp } from './scroll';

/** 滚轮一格的默认速度乘子（1 = 事件里的像素原样用）。 */
export const DEFAULT_WHEEL_SPEED = 1;

export interface WheelScrollInput {
  /** 当前滚动位（像素） */
  readonly offset: number;
  /** 本帧累计的滚轮增量（像素；正 = 向下/向右） */
  readonly delta: number;
  /** 可滚动内容总尺寸（像素） */
  readonly contentSize: number;
  /** 视口尺寸（像素） */
  readonly viewSize: number;
  /**
   * 速度乘子：滚轮一格 100px 在手机上偏快，游戏可以调小；
   * 触摸板惯性滚动也可以调大。默认 1。
   */
  readonly speed?: number;
}

/**
 * 滚轮增量 → 新的滚动位。
 *
 * 复用 `scroll.ts` 的 `scrollClamp`：钳制口径只有一套，
 * 拖动和滚轮到边界的行为必须完全一致（否则「拖到底」和「滚到底」差几个像素）。
 */
export const scrollByWheel = (input: WheelScrollInput): number => {
  const speed = input.speed === undefined || !Number.isFinite(input.speed) ? DEFAULT_WHEEL_SPEED : input.speed;
  const delta = Number.isFinite(input.delta) ? input.delta * speed : 0;
  const offset = Number.isFinite(input.offset) ? input.offset : 0;
  return scrollClamp(offset + delta, input.contentSize, input.viewSize);
};

/**
 * 把一帧里收到的多条滚轮事件合并成一个增量。
 *
 * 为什么需要：一次滑动可能在一帧内触发 3~5 条 wheel 事件（浏览器按设备回报率发），
 * 逐条改状态也能对，但「一帧一次状态更新」更省、也更好断言。
 * 非有限值（NaN / Infinity）直接丢弃 —— 一条脏事件不该毁掉整帧。
 */
export const sumWheelDeltas = (deltas: readonly number[]): number => {
  let total = 0;
  for (const delta of deltas) {
    if (Number.isFinite(delta)) total += delta;
  }
  return total;
};
