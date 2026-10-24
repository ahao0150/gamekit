/**
 * 滚动交互的纯函数状态机（T20）。
 *
 * 为什么要有这一层：滚动是**每帧都要算**的东西（拖动、惯性、边界），写在各游戏里
 * 很容易出现「拉到底还能再拉」「松手后越界一帧」「dt 一变就跳飞」这类 bug。
 * 抽成纯函数后，所有数值都能在单测里逐条断言。
 *
 * 明确不做的事（写死，别偷偷加）：
 * - **不做回弹**（拉过头再弹回来）：那是额外状态机 + 弹簧参数，对 AI 不划算；
 *   以后要就加可选 props，不要改这里的默认语义。
 */

/** 滚动状态。 */
export interface ScrollState {
  /** 当前滚动位置（像素，0 = 顶部/最左） */
  readonly offset: number;
  /** 惯性速度（px/秒，正 = 继续往正方向滚） */
  readonly velocity: number;
  /** 是否正在被拖动（拖动期间不跑惯性） */
  readonly dragging: boolean;
}

/** 空闲状态。 */
export const IDLE_SCROLL: ScrollState = { offset: 0, velocity: 0, dragging: false };

/** 每帧（60fps 一帧）的速度保留系数；0.92 ≈ 0.4 秒衰减到 4%。 */
const FRICTION = 0.92;
/** 一帧的秒数（衰减与位移都按 60fps 口径折算）。 */
const FRAME_SECONDS = 1 / 60;
/** 速度低于这个值直接停住（px/秒）：避免永远算不完的无穷小尾巴。 */
const STOP_VELOCITY = 5;
/** dt 上限（秒）：防止切后台回来 dt 巨大时一次跳太远。 */
const MAX_DT = 1;

/** 可滚动距离：内容比视口小就是 0（没有滚动空间）。 */
const maxOffset = (contentSize: number, viewSize: number): number =>
  Number.isFinite(contentSize) && Number.isFinite(viewSize) ? Math.max(0, contentSize - viewSize) : 0;

/** 钳到 `[0, max(0, contentSize - viewSize)]`；NaN 当 0。 */
export const scrollClamp = (offset: number, contentSize: number, viewSize: number): number => {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(offset, 0), maxOffset(contentSize, viewSize));
};

/** 开始拖动：进入 dragging，速度清零（跟手期间不算惯性）。 */
export function scrollDragStart(state: ScrollState): ScrollState {
  return { offset: Number.isFinite(state.offset) ? state.offset : 0, velocity: 0, dragging: true };
}

/**
 * 拖动中移动：**跟手**，`offset += delta` 并硬钳制。
 *
 * 非拖动状态直接返回原状态（防止漏掉 `dragStart` 时手势乱滚）。
 */
export function scrollDragMove(
  state: ScrollState,
  delta: number,
  contentSize: number,
  viewSize: number,
): ScrollState {
  if (!state.dragging) return state;
  const offset = Number.isFinite(state.offset) ? state.offset : 0;
  const step = Number.isFinite(delta) ? delta : 0;
  return { offset: scrollClamp(offset + step, contentSize, viewSize), velocity: 0, dragging: true };
}

/**
 * 结束拖动：`dragging = false`，**保留当前 velocity** 进入惯性。
 *
 * 末速由调用方决定（`scrollDragMove` 不知道时间间隔，算不出速度）：游戏可以在最后
 * 一次 move 之后用 `{ ...state, velocity: v }` 传进来，或在 `dragEnd` 前自行赋值。
 */
export function scrollDragEnd(state: ScrollState): ScrollState {
  if (!state.dragging) return state;
  return {
    offset: Number.isFinite(state.offset) ? state.offset : 0,
    velocity: Number.isFinite(state.velocity) ? state.velocity : 0,
    dragging: false,
  };
}

/**
 * 惯性推进一帧（`dt` 单位秒）。
 *
 * 模型：速度按 60fps 口径**指数衰减**（`v ×= 0.92^(dt×60)`），位移用该区间内的积分
 * （`v × (1/60) × (1 - decay) / (1 - 0.92)`）。好处：
 * - `dt` 再大位移也有上界 `v/60/(1-0.92) ≈ v × 0.208`，不会跳飞；
 * - `dt` 很小时退化成「一帧走 v/60」，与 60fps 一致。
 * 到边界立刻停（`velocity = 0`），不做回弹。
 */
export function scrollTick(state: ScrollState, dt: number, contentSize: number, viewSize: number): ScrollState {
  const offset = Number.isFinite(state.offset) ? state.offset : 0;
  const velocity = Number.isFinite(state.velocity) ? state.velocity : 0;
  // 拖动期间不跑惯性（否则会「边拖边飘」）
  if (state.dragging) return { offset: scrollClamp(offset, contentSize, viewSize), velocity: 0, dragging: true };

  const seconds = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_DT) : 0;
  if (seconds === 0) return { offset: scrollClamp(offset, contentSize, viewSize), velocity, dragging: false };

  const decay = Math.pow(FRICTION, seconds * 60);
  const distance = (velocity * FRAME_SECONDS * (1 - decay)) / (1 - FRICTION);
  const next = offset + distance;
  const clamped = scrollClamp(next, contentSize, viewSize);
  if (clamped !== next) return { offset: clamped, velocity: 0, dragging: false }; // 撞到边界：停住

  const nextVelocity = velocity * decay;
  return {
    offset: clamped,
    velocity: Math.abs(nextVelocity) < STOP_VELOCITY ? 0 : nextVelocity,
    dragging: false,
  };
}
