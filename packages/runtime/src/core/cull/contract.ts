/**
 * 视口剔除契约（纯函数）。
 *
 * 为什么要进 core：平台跳跃关卡的横向长度是屏幕的 3–4 倍，
 * 不做剔除就会「每帧给看不见的敌人算巡逻、给看不见的金币算动画」。
 * 更隐蔽的是**更新剔除**：只剔渲染不剔更新时，敌人离屏期间计时器照走，
 * 等它进屏时已经「凭空出现在半路而且正在动」，玩家一眼看出破绽。
 *
 * 三条约定（测试钉住）：
 * - 边挨着算相交（避免 1px 缝里实体闪没）；
 * - `w <= 0` 或 `h <= 0` 一律不可见（防「0 宽实体永远可见」的 bug）；
 * - NaN 坐标判为不可见，不崩。
 */

export interface CullRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** AABB 相交（边挨着也算相交）。 */
export type Intersects = (a: CullRect, b: CullRect) => boolean;

/** 视口外扩 margin 的激活窗口。 */
export type ActiveWindow = (view: CullRect, margin: number) => CullRect;

/** 是否落在窗口内（含 margin 扩展）。 */
export type IsVisible = (rect: CullRect, view: CullRect, margin?: number) => boolean;

export interface PartitionResult<T> {
  readonly visible: readonly T[];
  readonly hidden: readonly T[];
}

/** 按可见性分区，保持原顺序；`rectOf` 由调用方给。 */
export type PartitionByVisibility = <T>(
  items: readonly T[],
  rectOf: (item: T) => CullRect,
  view: CullRect,
  margin: number,
) => PartitionResult<T>;
