/**
 * 轮播的吸附状态机（T21）。
 *
 * 和 `scroll` 同源不同尾：拖动跟手一样（硬钳制），但**松手要吸附到整页**，不能停在
 * 任意位置。规则（写死，单测逐条断言）：
 * - `|offset| > pageW / 3` → 翻页；`|velocity| > 500 px/s` → 翻页（快速轻扫）；
 *   都不满足 → 回弹到当前页；
 * - **速度优先**：松手瞬间速度够大时，按速度方向翻页并**吞掉位移**
 *   （例：往前拖了 200px 但手是往回甩 800px/s → 回上一页）；
 * - `loop: true` 时 `next/prev` 回绕（最后一页 → 0、第一页 → count-1）；
 *   `loop: false` 到边界不动。`carouselRelease` / `carouselDragMove` **不带 loop**：
 *   松手翻页到边界一律回弹（loop 的翻页请走 `carouselNext` / `carouselPrev`）；
 * - 拖动时 offset 允许超出 ±pageW（方便看到下一页），但硬钳到 `[-pageW, pageW]`，不做橡皮筋。
 *
 * `offset` 的语义（关键）：**相对 `index` 那一页的偏移**（正 = 内容左移、露出下一页）。
 * 所以翻页时 `index` 立即更新，同时把 `offset` 换算成相对新 index 的值——
 * 换算前后视觉位置不变（`旧 index×pageW + 旧 offset === 新 index×pageW + 新 offset`），
 * `carouselTick` 只需要把 offset 收敛到 0，不会在吸附中途「跳一页」。
 *
 * 纯函数：不碰 canvas、不改入参、无全局状态。
 */

/** 轮播状态。 */
export interface CarouselState {
  /** 当前页索引（吸附对齐的页，始终在 [0, count-1]） */
  readonly index: number;
  /** 相对 index 的偏移（0 = 对齐；正 = 内容左移、露出下一页） */
  readonly offset: number;
  /** 是否正在拖动 */
  readonly dragging: boolean;
  /** 速度（px/秒，松手翻页判定用） */
  readonly velocity: number;
}

/** 空闲状态。 */
export const IDLE_CAROUSEL: CarouselState = { index: 0, offset: 0, dragging: false, velocity: 0 };

/** 快速轻扫阈值（px/秒）：超过它就按方向翻页。 */
const FLING_VELOCITY = 500;
/** 吸附收敛系数：与 scroll 同一套指数衰减思路（每 60fps 一帧保留 0.92）。 */
const SNAP_FRICTION = 0.92;
/** 吸附收敛到这么大就归零（像素），保证「最终严格 0」。 */
const SNAP_EPSILON = 0.5;
/** dt 上限（秒），防切后台回来一次跳完。 */
const MAX_DT = 1;

const finiteOr = (value: number, fallback: number): number => (Number.isFinite(value) ? value : fallback);

/** index 钳到 [0, count-1]；count <= 0 时 0。 */
const clampIndex = (index: number, count: number): number => {
  if (!(count > 0)) return 0;
  const safe = Math.floor(finiteOr(index, 0));
  return Math.min(Math.max(safe, 0), count - 1);
};

/** 只有一页（或没有）时谈不上翻页。 */
const canMove = (count: number): boolean => count > 1;

/** 目标索引：loop 回绕、否则钳到两端。 */
const resolveIndex = (target: number, count: number, loop: boolean): number => {
  if (!(count > 0)) return 0;
  if (loop) return ((target % count) + count) % count;
  return Math.min(Math.max(target, 0), count - 1);
};

/** 开始拖动：进入 dragging，速度清零。 */
export function carouselDragStart(state: CarouselState): CarouselState {
  return { index: finiteOr(state.index, 0), offset: finiteOr(state.offset, 0), dragging: true, velocity: 0 };
}

/**
 * 拖动中移动：跟手 `offset += delta`，硬钳到 `[-pageW, pageW]`。
 *
 * 不判 loop 边界（签名没有 loop）：拖到尽头会露出一点空白，松手后回弹。
 * 非拖动状态原样返回（防止漏了 `dragStart` 时手势乱翻页）。
 */
export function carouselDragMove(state: CarouselState, delta: number, pageW: number, count: number): CarouselState {
  if (!state.dragging) return state;
  const index = clampIndex(state.index, count);
  const offset = finiteOr(state.offset, 0);
  if (!(pageW > 0) || !canMove(count)) return { index, offset: 0, dragging: true, velocity: 0 };
  const next = offset + finiteOr(delta, 0);
  return {
    index,
    offset: Math.min(Math.max(next, -pageW), pageW),
    dragging: true,
    velocity: 0,
  };
}

/** 结束拖动：关 dragging、速度清零（速度由调用方在释放瞬间传给 `carouselRelease`）。 */
export function carouselDragEnd(state: CarouselState): CarouselState {
  return {
    index: finiteOr(state.index, 0),
    offset: finiteOr(state.offset, 0),
    dragging: false,
    velocity: 0,
  };
}

/**
 * 松手：算目标页并**把 offset 换算成相对目标页的偏移**（视觉位置连续）。
 *
 * 判定顺序（速度优先）：`|velocity| > 500` → 按速度方向翻页；否则按 `|offset| > pageW/3`
 * 判方向；都不满足 → 回弹。目标页超界（非 loop 的边界）→ 回弹，不发车。
 * 返回 `velocity = 0`：接下来交给 `carouselTick` 做吸附收敛。
 */
export function carouselRelease(state: CarouselState, velocity: number, pageW: number, count: number): CarouselState {
  const index = clampIndex(state.index, count);
  const offset = finiteOr(state.offset, 0);
  const speed = finiteOr(velocity, 0);
  if (!(pageW > 0) || !canMove(count)) return { index, offset: 0, dragging: false, velocity: 0 };

  const threshold = pageW / 3;
  let target = index;
  if (Math.abs(speed) > FLING_VELOCITY) target = index + (speed > 0 ? 1 : -1);
  else if (offset > threshold) target = index + 1;
  else if (offset < -threshold) target = index - 1;

  const resolved = resolveIndex(target, count, false); // 松手翻页到边界 → 回弹
  return {
    index: resolved,
    offset: offset + (index - resolved) * pageW,
    dragging: false,
    velocity: 0,
  };
}

/**
 * 吸附推进一帧：`offset` 指数收敛到 0，`|offset| < 0.5` 时严格归零。
 *
 * 拖动期间不吸附；dt 非法 / 为 0 时不动。到 0 后状态完全稳定（index 已在 release 时定好）。
 */
export function carouselTick(state: CarouselState, dt: number, pageW: number, count: number): CarouselState {
  const index = clampIndex(state.index, count);
  const offset = finiteOr(state.offset, 0);
  if (!(pageW > 0)) return { index, offset: 0, dragging: false, velocity: 0 };
  if (state.dragging) return { index, offset, dragging: true, velocity: 0 };
  if (offset === 0) return { index, offset: 0, dragging: false, velocity: 0 };
  const seconds = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_DT) : 0;
  if (seconds === 0) return { index, offset, dragging: false, velocity: 0 };
  const decay = Math.pow(SNAP_FRICTION, seconds * 60);
  const next = offset * decay;
  return {
    index,
    offset: Math.abs(next) < SNAP_EPSILON ? 0 : next,
    dragging: false,
    velocity: 0,
  };
}

/** 下一页（按钮/键盘用）：loop 时回绕，否则到边界不动。 */
export function carouselNext(state: CarouselState, count: number, loop = false): CarouselState {
  const index = clampIndex(state.index, count);
  if (!canMove(count)) return { index, offset: 0, dragging: false, velocity: 0 };
  return { index: resolveIndex(index + 1, count, loop), offset: 0, dragging: false, velocity: 0 };
}

/** 上一页（按钮/键盘用）：loop 时回绕，否则到边界不动。 */
export function carouselPrev(state: CarouselState, count: number, loop = false): CarouselState {
  const index = clampIndex(state.index, count);
  if (!canMove(count)) return { index, offset: 0, dragging: false, velocity: 0 };
  return { index: resolveIndex(index - 1, count, loop), offset: 0, dragging: false, velocity: 0 };
}
