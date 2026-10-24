/**
 * 按下状态追踪（T17）：按钮三状态里的「什么时候算 pressed」。
 *
 * 为什么要有这一层：`button` 组件能画 normal / pressed / disabled 三种样子，但
 * 「当前按的是哪个按钮」是**交互状态**，不是布局也不是绘制。以前这活在每个游戏里各写一份
 * （记一个 `pressedName` 变量 + 手判边界），结果三家手感和 bug 都不一样。
 *
 * 命中判定**复用** `hit.ts`（`pickHit` / `hitTest`），这里只做状态机，不再写第二套命中。
 * 规则（写死，单测逐条锁住）：
 * - 只有 `hit === 'self'` 的元素能被按下；`block`（遮罩）吃掉点击但不产生 pressed，
 *   `none` 直接穿透（`pickHit` 本来就是这么跳的）；
 * - 按下期间**移出原元素即取消**，移回来不恢复（标准按钮手感）；
 * - 多点只认第一个 `pointerId`，第二个按下被忽略；`up` 的 id 必须与按下时一致；
 * - 任何坏输入（空表 / NaN 坐标 / 元素从布局里消失）都不崩，退化成 IDLE。
 *
 * 纯函数：不碰 canvas、不改入参、无全局状态。
 */

import type { HitEntry, HitPoint } from './hit';
import { pickHit } from './hit';

/** 按下状态。 */
export interface PressState {
  /** 当前按住的组件名；null = 没按住任何东西 */
  readonly pressed: string | null;
  /** 哪个指针按的（多点保护）；null = 没按住 */
  readonly pointerId: number | null;
}

/** 空闲状态。 */
export const IDLE_PRESS: PressState = { pressed: null, pointerId: null };

/** 坐标可用（有限数）；NaN / Infinity 一律当成坏输入。 */
const finitePoint = (point: HitPoint): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

/** 是否有指针正按着东西。 */
const isHolding = (state: PressState): boolean => state.pressed !== null && state.pointerId !== null;

/**
 * 按下：命中 `self` 元素才进入 pressed。
 *
 * 已按住时忽略（多点保护）；坐标或 pointerId 非法时原样返回（不产生半截状态）。
 */
export const pressDown = (
  state: PressState,
  entries: readonly HitEntry[],
  point: HitPoint,
  pointerId: number,
): PressState => {
  if (isHolding(state)) return state;
  if (!Number.isFinite(pointerId) || !finitePoint(point)) return state;
  const hit = pickHit(entries, point);
  // block：吃掉点击但没有动作，不进入 pressed；none：pickHit 已跳过
  if (hit === null || hit.hit !== 'self') return state;
  return { pressed: hit.name, pointerId };
};

/**
 * 移动：按住期间**离开原元素即取消**（`pressed` 元素从布局消失也算离开）。
 *
 * 用 `pickHit` 而不是「查原矩形」：指针滑到盖在上面的遮罩 / 另一个按钮上时，
 * 已经不算「还在按这个按钮」了；用原矩形判会漏掉浮层挡住的场景。
 * 空闲状态下 move 是空操作。
 */
export const pressMove = (state: PressState, entries: readonly HitEntry[], point: HitPoint): PressState => {
  if (!isHolding(state)) return state;
  if (!finitePoint(point)) return IDLE_PRESS; // 坏坐标当「指针状态不明」，宁可按取消
  const hit = pickHit(entries, point);
  return hit !== null && hit.name === state.pressed ? state : IDLE_PRESS;
};

/**
 * 松开：松手点仍在 pressed 元素内才算「激活」。
 *
 * `pointerId` 不匹配时**不改变状态**（别的指针的 up 不能打断当前按住）；
 * 无论是否激活，本次 up 都会清空按住状态。
 */
export const pressUp = (
  state: PressState,
  entries: readonly HitEntry[],
  point: HitPoint,
  pointerId: number,
): { readonly state: PressState; readonly activated: string | null } => {
  if (!isHolding(state)) return { state: IDLE_PRESS, activated: null };
  if (pointerId !== state.pointerId) return { state, activated: null };
  const hit = finitePoint(point) ? pickHit(entries, point) : null;
  // block / none 落在松手点上都算「没在目标按钮上」
  const activated = hit !== null && hit.hit === 'self' && hit.name === state.pressed ? state.pressed : null;
  return { state: IDLE_PRESS, activated };
};
