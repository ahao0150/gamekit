/**
 * 拖拽状态机（T22）：悬浮/可拖拽元素的通用部分。
 *
 * 拖卡牌到槽位、拖物品合成、拖角色到位置——每个游戏都手写一遍「阈值、多点、松手」
 * 就是重复劳动，而且阈值和「是否回退」这种手感细节百写百错。这里做成纯函数。
 *
 * 和 `press.ts` 的分工（重要）：
 * - `press` 回答「这次点击激活了哪个按钮」；
 * - `drag` 回答「这是不是一次拖拽、拖到了哪」。**两者互斥**：`dragEnd` 无论 active
 *   与否都会返回 result（`active: false` = 这其实是一次点击），游戏侧看到
 *   `active: false` 时**不要**在这里触发点击——点击归 `press`。
 *
 * 规则（写死，单测逐条锁住）：
 * - 阈值 8px：位移 ≤ 8px 不算拖拽（还是点击），> 8px 才算；**一旦 active 就不回退**
 *   （手指抖回去也仍是拖拽，避免松手时「到底算不算拖」摇摆）；
 * - 只认白名单里的元素（`hit === 'self'` 且名字在 `draggable` 里），其余按下直接 IDLE；
 * - 多点只认第一个 `pointerId`（与 `press.ts` 同口径）；`dragEnd` 传了 id 且不匹配时无效；
 * - 任何坏输入（NaN 坐标 / 元素从布局消失）都不崩。
 *
 * 纯函数：不碰 canvas、不改入参、无全局状态。
 */

import type { HitEntry, HitPoint } from './hit';
import { pickHit } from './hit';

/** 拖拽状态。 */
export interface DragState {
  /** 被拖的元素名；null = 没在拖 */
  readonly target: string | null;
  /** 哪个指针按下的（多点保护） */
  readonly pointerId: number | null;
  /** 按下点 x */
  readonly startX: number;
  /** 按下点 y */
  readonly startY: number;
  /** 当前位移（相对按下点） */
  readonly dx: number;
  /** 当前位移（相对按下点） */
  readonly dy: number;
  /** 是否已越过阈值、判定为拖拽（一旦 true 不回退） */
  readonly active: boolean;
}

/** 空闲状态。 */
export const IDLE_DRAG: DragState = {
  target: null,
  pointerId: null,
  startX: 0,
  startY: 0,
  dx: 0,
  dy: 0,
  active: false,
};

/** 拖拽判定阈值（像素）：位移必须**大于**它才算拖拽。 */
export const DRAG_THRESHOLD = 8;

const isHolding = (state: DragState): boolean => state.target !== null && state.pointerId !== null;
const finitePoint = (point: HitPoint): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

/**
 * 按下：只接受「命中 `self` 且在 `draggable` 白名单里」的元素。
 *
 * 已按住时忽略（多点保护）；白名单外的按下直接返回 `IDLE_DRAG`
 * （返回常量而不是原状态：此时原状态本来就该是空闲，避免把脏状态带下去）。
 */
export function dragStart(
  state: DragState,
  entries: readonly HitEntry[],
  point: HitPoint,
  pointerId: number,
  draggable: readonly string[],
): DragState {
  if (isHolding(state)) return state;
  if (!Number.isFinite(pointerId) || !finitePoint(point)) return state;
  const hit = pickHit(entries, point);
  if (hit === null || hit.hit !== 'self') return IDLE_DRAG;
  if (!draggable.includes(hit.name)) return IDLE_DRAG;
  return {
    target: hit.name,
    pointerId,
    startX: point.x,
    startY: point.y,
    dx: 0,
    dy: 0,
    active: false,
  };
}

/**
 * 移动：更新 `dx/dy`；位移**大于**阈值时 `active = true`，之后不再回退。
 *
 * 用欧氏距离判阈值（斜着拖 6+6px 也算 8.49px，该算拖拽）。
 * 空闲状态 / 坏坐标原样返回（不产生半截状态）。
 */
export function dragMove(state: DragState, point: HitPoint, threshold = DRAG_THRESHOLD): DragState {
  if (!isHolding(state)) return state;
  if (!finitePoint(point)) return state;
  const dx = point.x - state.startX;
  const dy = point.y - state.startY;
  const limit = Number.isFinite(threshold) && threshold >= 0 ? threshold : DRAG_THRESHOLD;
  const active = state.active || Math.hypot(dx, dy) > limit;
  return { ...state, dx, dy, active };
}

/**
 * 松开：交回结果并把状态重置回 `IDLE_DRAG`。
 *
 * `result` **无论 active 与否都返回**：`active: false` 表示「这其实是一次点击」，
 * 游戏侧据此不要在这里触发点击（点击归 `press`）。
 *
 * `pointerId` 可选：传了且与按下时不一致 → 不结束（别的指针的 up 不能打断拖拽），
 * 返回 `{ state, result: null }`；不传视为匹配（简单用法 `dragEnd(state)`）。
 */
export function dragEnd(
  state: DragState,
  pointerId?: number,
): {
  readonly state: DragState;
  readonly result: {
    readonly target: string;
    readonly dx: number;
    readonly dy: number;
    readonly active: boolean;
    readonly point: HitPoint;
  } | null;
} {
  if (!isHolding(state)) return { state: IDLE_DRAG, result: null };
  if (pointerId !== undefined && pointerId !== state.pointerId) return { state, result: null };
  const target = state.target ?? '';
  return {
    state: IDLE_DRAG,
    result: {
      target,
      dx: state.dx,
      dy: state.dy,
      active: state.active,
      point: { x: state.startX + state.dx, y: state.startY + state.dy },
    },
  };
}
