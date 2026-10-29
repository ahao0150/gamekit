/**
 * UI 锚点布局实现。
 *
 * 全部是纯函数：不读 canvas、不写全局状态，输入父矩形 + 属性，输出子矩形。
 * 因此「十几种屏型 × 全部 widget」可以在 Node 里直接枚举断言（见 index.test.ts）。
 *
 * 三种定位模式：
 * - 固定尺寸：`size.kind === 'fixed'`，逻辑像素宽高；
 * - 比例尺寸：`size.kind === 'ratio'`，父矩形的比例宽高；
 * - 四边拉伸：`margin`，位置与尺寸都由四边内缩决定（anchor / pivot 不参与）。
 *
 * 越界不在这里自动修正——`computeRect` 只做几何，收口用 `clampInside`、判定用
 * `isInside`。这样布局错误会被测试直接测出来，而不是被悄悄夹回去。
 */

import type {
  ClampInside,
  ComputeRect,
  CreateUi,
  Insets,
  IsInside,
  Rect,
  UiService,
  Vec2,
  WidgetProps,
  WidgetSize,
} from './contract';

/** 矩形边界比较的浮点容差：ratio 尺寸会带小数，1e-6 内算「贴边」 */
export const EPSILON = 1e-6;

/** 非有限值（NaN / Infinity）回落到 fallback，防污染下游绘制 */
const finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

/** 尺寸类数值：负值与非法值一律当 0（负宽高没有意义） */
const nonNegative = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

interface Size {
  readonly w: number;
  readonly h: number;
}

const toPoint = (v: Vec2): Vec2 => ({ x: finite(v.x, 0), y: finite(v.y, 0) });

const baseSize = (size: WidgetSize | undefined, parent: Size): Size => {
  if (size === undefined) return { w: 0, h: 0 };
  if (size.kind === 'ratio') {
    return {
      w: nonNegative(parent.w * finite(size.w, 0)),
      h: nonNegative(parent.h * finite(size.h, 0)),
    };
  }
  return { w: nonNegative(size.w), h: nonNegative(size.h) };
};

/** 夹取尺寸：先 minSize 再 maxSize（两者冲突时以 maxSize 为准） */
const clampSize = (size: Size, props: WidgetProps): Size => {
  let w = size.w;
  let h = size.h;
  if (props.minSize !== undefined) {
    w = Math.max(w, nonNegative(props.minSize.x));
    h = Math.max(h, nonNegative(props.minSize.y));
  }
  if (props.maxSize !== undefined) {
    const maxW = finite(props.maxSize.x, Number.POSITIVE_INFINITY);
    const maxH = finite(props.maxSize.y, Number.POSITIVE_INFINITY);
    w = Math.min(w, maxW < 0 ? 0 : maxW);
    h = Math.min(h, maxH < 0 ? 0 : maxH);
  }
  return { w, h };
};

export const computeRect: ComputeRect = (parent, props) => {
  const { size, margin } = props;
  if (size !== undefined && margin !== undefined) {
    throw new Error('WidgetProps.size 与 WidgetProps.margin 互斥，只能给一个');
  }

  const parentSize: Size = { w: nonNegative(parent.w), h: nonNegative(parent.h) };
  const originX = finite(parent.x, 0);
  const originY = finite(parent.y, 0);

  // 四边拉伸：anchor / pivot 不参与，位置与尺寸都由 margin 决定
  if (margin !== undefined) {
    const left = nonNegative(margin.left);
    const top = nonNegative(margin.top);
    const right = nonNegative(margin.right);
    const bottom = nonNegative(margin.bottom);
    const clamped = clampSize(
      {
        w: Math.max(0, parentSize.w - left - right),
        h: Math.max(0, parentSize.h - top - bottom),
      },
      props,
    );
    return { x: originX + left, y: originY + top, w: clamped.w, h: clamped.h };
  }

  const clamped = clampSize(baseSize(size, parentSize), props);
  const anchor = toPoint(props.anchor);
  const pivot = toPoint(props.pivot);
  const offset = props.offset === undefined ? { x: 0, y: 0 } : toPoint(props.offset);
  return {
    x: originX + anchor.x * parentSize.w + offset.x - pivot.x * clamped.w,
    y: originY + anchor.y * parentSize.h + offset.y - pivot.y * clamped.h,
    w: clamped.w,
    h: clamped.h,
  };
};

export const isInside: IsInside = (rect, parent) =>
  rect.x >= parent.x - EPSILON &&
  rect.y >= parent.y - EPSILON &&
  rect.x + rect.w <= parent.x + parent.w + EPSILON &&
  rect.y + rect.h <= parent.y + parent.h + EPSILON;

const clampValue = (value: number, lo: number, hi: number): number =>
  hi < lo ? lo : Math.min(Math.max(value, lo), hi);

export const clampInside: ClampInside = (rect, parent) => {
  const parentW = nonNegative(parent.w);
  const parentH = nonNegative(parent.h);
  const w = Math.min(nonNegative(rect.w), parentW);
  const h = Math.min(nonNegative(rect.h), parentH);
  return {
    x: clampValue(rect.x, parent.x, parent.x + parentW - w),
    y: clampValue(rect.y, parent.y, parent.y + parentH - h),
    w,
    h,
  };
};

/** 四边内缩（九宫格面板的可用区也算这个），负内缩当 0。 */
export const insetRect = (rect: Rect, insets: Insets): Rect => {
  const left = nonNegative(insets.left);
  const top = nonNegative(insets.top);
  return {
    x: rect.x + left,
    y: rect.y + top,
    w: Math.max(0, nonNegative(rect.w) - left - nonNegative(insets.right)),
    h: Math.max(0, nonNegative(rect.h) - top - nonNegative(insets.bottom)),
  };
};

export const createUi: CreateUi = (): UiService => ({ computeRect, isInside, clampInside });

// 自绘区域的切分原语：`splitRects` 之类的问题不该让游戏自己拿 viewport 算。
// 见 split.ts 文件头（为什么需要、权重写法、非法参数直接抛错）。
export { findOverlaps, gridOf, ratiosSum, splitCols, splitRows } from './split';
export type { Ratios } from './split';

// 滚动交互状态机（拖动 / 惯性 / 边界钳制）：见 scroll.ts 文件头为什么是纯函数。
// 注意与 `widgets/scroll.ts` 的**组件** `scroll` 不同名、不冲突：这里全是纯函数与状态类型。
export { IDLE_SCROLL, scrollClamp, scrollDragEnd, scrollDragMove, scrollDragStart, scrollTick } from './scroll';
export type { ScrollState } from './scroll';
