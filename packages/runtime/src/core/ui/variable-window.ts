/**
 * 变高列表的窗口定位（前缀和 + 二分）。
 *
 * 为什么不改 `list-window.ts`：那是**定高**的 O(1) 换算（两次除法），一行代码就能算完，
 * 而且被定高路径独占。变高必须靠前缀和 + 二分，混进去会让定高路径也背上数组分配。
 * 两者的 `ListWindow` 形状相同，`list` 组件按「有没有 itemHeights」选其中一条。
 *
 * **构建一次、两处共用**：`buildVariableIndex()` 的前缀和同时喂给
 * `variableWindow()`（绘制）和 `listIndexAtVariable()`（命中）——
 * 命中不许另算一套，否则「点到的」和「画出的」会出现半像素级错位。
 */

import type { Rect } from './contract';

/** 变高列表的前缀和索引：`offsets[i]` = 第 i 项顶边相对内容顶的 y。 */
export interface VariableIndex {
  readonly heights: readonly number[];
  /** 与 `heights` 等长；`offsets[0] === 0` */
  readonly offsets: readonly number[];
  /** 全部项总高（含项间 gap，不含末尾 gap） */
  readonly totalH: number;
  readonly gap: number;
}

/** 变高窗口。字段与 `ListWindow` 同形，`list` 组件可共用同一套绘制循环。 */
export interface VariableWindow {
  readonly start: number;
  readonly end: number;
  readonly offsetY: number;
  readonly totalH: number;
}

const normalizeHeights = (heights: readonly number[]): readonly number[] =>
  heights.map((h) => (Number.isFinite(h) && h > 0 ? h : 0));

const normalizeGap = (gap: number): number => (Number.isFinite(gap) && gap > 0 ? gap : 0);

/**
 * 建前缀和索引。**每帧只调用一次，结果同时交给绘制与命中。**
 *
 * O(n) 一次（只加不量文字，1 万项约 0.05ms），之后所有定位都是 O(log n)。
 */
export const buildVariableIndex = (heights: readonly number[], gap = 0): VariableIndex => {
  const hs = normalizeHeights(heights);
  const g = normalizeGap(gap);
  const offsets: number[] = new Array(hs.length);
  let acc = 0;
  for (let i = 0; i < hs.length; i += 1) {
    offsets[i] = acc;
    acc += (hs[i] as number) + g;
  }
  // acc 里多加了最后一个 gap（末尾不留 gap）
  const totalH = hs.length === 0 ? 0 : acc - g;
  return { heights: hs, offsets, totalH, gap: g };
};

/** 最大 i 使 `offsets[i] <= value`；没有（value < 0）返回 -1。 */
const lastAtOrBefore = (offsets: readonly number[], value: number): number => {
  let lo = 0;
  let hi = offsets.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((offsets[mid] as number) <= value) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

/** 最小 i 使 `offsets[i] > value`；没有返回 `offsets.length`。 */
const firstAfter = (offsets: readonly number[], value: number): number => {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((offsets[mid] as number) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const clampScroll = (scrollTop: number, totalH: number, viewH: number): number => {
  if (!Number.isFinite(scrollTop)) return 0;
  return Math.min(Math.max(scrollTop, 0), Math.max(0, totalH - viewH));
};

/**
 * 换算可见窗口（O(log n)）。
 *
 * 边界口径与定高路径一致：`scrollTop` 先钳到 `[0, max(0, totalH − viewH)]`，
 * `start` 含「顶边已在视口上方的最后一项」（所以 `offsetY ≤ 0`，滚动不跳项），
 * `end` 取「顶边已在视口下沿之下」的第一项（不含）。
 */
export const variableWindow = (index: VariableIndex, scrollTop: number, viewH: number): VariableWindow => {
  const count = index.offsets.length;
  const view = Number.isFinite(viewH) && viewH > 0 ? viewH : 0;
  if (count === 0 || view === 0) return { start: 0, end: 0, offsetY: 0, totalH: index.totalH };

  const top = clampScroll(scrollTop, index.totalH, view);
  const start = Math.max(0, lastAtOrBefore(index.offsets, top));
  const end = Math.min(count, Math.max(start, firstAfter(index.offsets, top + view)));
  return { start, end, offsetY: (index.offsets[start] as number) - top, totalH: index.totalH };
};

/**
 * 命中：屏幕点 → 项下标（不在任何一项上返回 `null`）。
 *
 * 第 4 参接 `VariableIndex`（推荐，与绘制共用同一份前缀和）或裸 `heights` 数组
 * （便捷写法，内部现建一次索引 —— **别在每帧里用这种写法**）。
 * 落在项之间的 gap 上返回 `null`，不硬凑到相邻项。
 */
export const listIndexAtVariable = (
  point: { readonly x: number; readonly y: number },
  rect: Rect,
  scrollTop: number,
  heightsOrIndex: readonly number[] | VariableIndex,
  gap = 0,
): number | null => {
  const index: VariableIndex = Array.isArray(heightsOrIndex)
    ? buildVariableIndex(heightsOrIndex as readonly number[], gap)
    : (heightsOrIndex as VariableIndex);

  if (point.x < rect.x || point.x > rect.x + rect.w) return null;
  if (point.y < rect.y || point.y > rect.y + rect.h) return null;

  const top = clampScroll(scrollTop, index.totalH, rect.h);
  // 相对内容顶的 y
  const y = point.y - rect.y + top;
  if (y < 0 || y >= index.totalH) return null;

  const i = lastAtOrBefore(index.offsets, y);
  if (i < 0) return null;
  const bottom = (index.offsets[i] as number) + (index.heights[i] as number);
  if (y >= bottom) return null; // 落在项与项之间的 gap 里
  return i;
};
