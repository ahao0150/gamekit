/**
 * 命中判定的纯函数层（T13a）。
 *
 * 为什么要有这一层：命中判定曾经写在游戏里、按 `components` 的**声明顺序**找第一个
 * 命中 —— 结果是「视觉在上、命中在下」；全屏半透明遮罩吃不掉点击，会穿透到底层按钮。
 * 正确语义只有一条：**谁画在上面，谁先接点击**。所以绘制顺序与命中顺序必须是严格逆序，
 * 两者都从同一组 `(layer, index)` 推出来，不各写一套。
 *
 * `HitMode`（对应 `.ui` 未来的 `put ... hit self|block|none`）：
 * - `self`：自己接点击 → 调用方执行该元素的 action；
 * - `block`：**吃掉这次点击、但自己没有动作**（遮罩 / 装饰面板 / loading 层）。
 *   `pickHit` 返回它即表示「到此为止」：调用方不执行 action，也不继续往下找；
 * - `none`：可见但不可点，点击穿透到下面的元素。
 *
 * 坐标约定：左上角原点、逻辑像素、矩形**左闭右开**（右下边界不命中）。
 */

import type { Rect } from './contract';

/** 命中语义。 */
export type HitMode = 'self' | 'block' | 'none';

/** 参与命中排序的一个元素。 */
export interface HitEntry {
  readonly name: string;
  /** 组件矩形（`core/ui/contract` 的 Rect，逻辑像素） */
  readonly rect: Rect;
  readonly hit: HitMode;
  /** 层号：小的先画（在底），大的后画（在上） */
  readonly layer: number;
  /** 同层内的声明顺序：大的后画、在上 */
  readonly index: number;
}

/** 一个逻辑坐标点。 */
export interface HitPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * 单矩形命中：左闭右开；宽或高 <= 0 一律不命中（零尺寸元素不该吃点击）。
 * 未定义矩形、NaN 坐标同样返回 false —— 判据层不能把坏数据传成「命中」。
 */
export const hitTest = (rect: Rect | undefined, point: HitPoint): boolean => {
  if (rect === undefined) return false;
  if (!(rect.w > 0) || !(rect.h > 0)) return false;
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.w &&
    point.y >= rect.y &&
    point.y < rect.y + rect.h
  );
};

/**
 * 绘制顺序：`layer` 升序、同层 `index` 升序。返回新数组，不改入参。
 *
 * 显式按两个键比较（不依赖引擎的 sort 是否稳定）：顺序要能被测试逐项断言。
 */
export const sortForPaint = (entries: readonly HitEntry[]): readonly HitEntry[] =>
  [...entries].sort((a, b) => (a.layer === b.layer ? a.index - b.index : a.layer - b.layer));

/**
 * 命中：绘制顺序的**逆序**（最上面的先试），跳过 `hit='none'`，返回第一个命中的元素。
 *
 * 返回 `hit='block'` 的元素表示它吃掉了这次点击但没有动作 —— 调用方什么都不做，
 * 不要再往下找（这就是「遮罩不吃穿透」的判据）。
 */
export const pickHit = (entries: readonly HitEntry[], point: HitPoint): HitEntry | null => {
  const order = sortForPaint(entries);
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const entry = order[i];
    if (entry === undefined || entry.hit === 'none') continue;
    if (hitTest(entry.rect, point)) return entry;
  }
  return null;
};
