/**
 * 视口剔除实现：一次遍历、两个数组 push，不产生中间对象。
 *
 * 纯函数、无状态：调用方每帧传当前可见矩形（来自 camera.visible）。
 */

import type {
  ActiveWindow,
  CullRect,
  Intersects,
  IsVisible,
  PartitionByVisibility,
  PartitionResult,
} from './contract';

/** 合法矩形：四个分量有限且宽高为正（否则一律不可见）。 */
const isValid = (rect: CullRect): boolean =>
  Number.isFinite(rect.x) && Number.isFinite(rect.y)
  && Number.isFinite(rect.w) && Number.isFinite(rect.h)
  && rect.w > 0 && rect.h > 0;

export const intersects: Intersects = (a, b) => {
  if (!isValid(a) || !isValid(b)) return false;
  // 边挨着算相交：用 <= / >= 而不是 < / >
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
};

/** margin 负数当 0、NaN 当 0（宁可少剔，也不要算出负数窗口把实体全藏了）。 */
const safeMargin = (margin: number): number =>
  Number.isFinite(margin) && margin > 0 ? margin : 0;

export const activeWindow: ActiveWindow = (view, margin) => {
  const m = safeMargin(margin);
  return { x: view.x - m, y: view.y - m, w: view.w + m * 2, h: view.h + m * 2 };
};

export const isVisible: IsVisible = (rect, view, margin = 0) =>
  intersects(rect, activeWindow(view, margin));

export const partitionByVisibility: PartitionByVisibility = <T>(
  items: readonly T[],
  rectOf: (item: T) => CullRect,
  view: CullRect,
  margin: number,
): PartitionResult<T> => {
  const visible: T[] = [];
  const hidden: T[] = [];
  const window = activeWindow(view, margin);
  for (const item of items) {
    if (intersects(rectOf(item), window)) visible.push(item);
    else hidden.push(item);
  }
  return { visible, hidden };
};

export type { ActiveWindow, CullRect, Intersects, IsVisible, PartitionByVisibility, PartitionResult } from './contract';
