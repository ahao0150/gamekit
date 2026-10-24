/**
 * UI 锚点布局契约。
 *
 * 为什么布局必须是纯函数：HUD 越界是过往最痛的 bug——按钮在 16:9 上正常、
 * 在 19.5:9 上被刘海吃掉。这类 bug 用截图只能撞运气，用纯函数可以在 Node 里
 * 直接把「十种屏型 × 全部 widget」枚举一遍断言。
 *
 * 为什么不用 Canvas 的 `measureText`：布局层不碰 ctx。文本宽度需要测量时，
 * 由调用方注入 `measureText`，布局函数本身仍然是纯的。
 *
 * 为什么尺寸有两种表达：固定像素适合图标/按钮，比例适合全屏遮罩/进度条。
 * 互斥使用（给 `size` 就不给 `margin`，反之亦然），实现里直接打回。
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** 矩形，逻辑像素，左上角原点。 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 四边内缩，逻辑像素。 */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * 尺寸。二选一：
 * - `{ kind: 'fixed', w, h }`：固定逻辑像素；
 * - `{ kind: 'ratio', w, h }`：相对父矩形的比例（0..1）。
 */
export type WidgetSize =
  | { readonly kind: 'fixed'; readonly w: number; readonly h: number }
  | { readonly kind: 'ratio'; readonly w: number; readonly h: number };

/**
 * 布局属性。
 *
 * - `anchor`：定位点在父矩形内的比例坐标（0,0 = 左上，1,1 = 右下）；
 * - `pivot`：自身矩形上哪个点对齐到 anchor（0,0 = 自身左上，1,1 = 自身右下）；
 * - `offset`：在 anchor 基础上的逻辑像素偏移（右/下为正）；
 * - `size` 与 `margin` 互斥：给 `margin` 表示四边拉伸、忽视 anchor/pivot。
 */
export interface WidgetProps {
  readonly anchor: Vec2;
  readonly pivot: Vec2;
  readonly offset?: Vec2;
  readonly size?: WidgetSize;
  readonly margin?: Insets;
  /** 尺寸下限（在 size/margin 之后应用） */
  readonly minSize?: Vec2;
  /** 尺寸上限（在 size/margin 之后应用） */
  readonly maxSize?: Vec2;
}

/**
 * 纯函数：根据父矩形与属性算出子矩形。
 * 不依赖 canvas、不读写全局状态，可在 Node 里任意枚举屏型。
 */
export type ComputeRect = (parent: Rect, props: WidgetProps) => Rect;

/** 矩形是否完整落在父矩形内（含边界）。 */
export type IsInside = (rect: Rect, parent: Rect) => boolean;

/** 把矩形夹回父矩形内（用于「越界就收回来」的兜底）。 */
export type ClampInside = (rect: Rect, parent: Rect) => Rect;

/** 九宫格四边切片（逻辑像素）。渲染层据此把一张图拉伸成面板。 */
export interface Slice9Insets {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface UiService {
  readonly computeRect: ComputeRect;
  readonly isInside: IsInside;
  readonly clampInside: ClampInside;
}

export type CreateUi = () => UiService;
