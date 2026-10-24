/**
 * 命中判定用的小工具（T38 从 `game.ts` 抽出）：布局快照 → 命中条目 / 点第几项。
 *
 * 抽出来的原因有两个：
 * 1. `game.ts` 要接滚轮，行数已经贴上限（单文件 ≤300）；
 * 2. 「点第几项 / 第几格」本来就是纯几何，放独立文件能脱开事件逐条断言。
 *
 * 这里的滚动位一律从**布局后的 props** 读（`scrollTop`）：布局层已经把
 * `state.scrolls[name]` 注入进去了，所以「画出来的」和「点到的」用的是同一份值，
 * 不会出现命中和绘制各读一个状态（T35 之前踩过的坑）。
 */

import { cellWidth, gridIndexAt, listIndexAt } from './deps';
import type { HitEntry } from './deps';
import { ITEM_GAP, ITEM_H, ITEMS } from './inventory';
// 只取类型：`import type` 被擦除，不会有运行时循环依赖
import type { ScreenLayout } from './layout';
import { numberPropOf } from './scrollables';

/** 一个点（逻辑像素）。 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * 把 `ScreenLayout` 组装成命中层要的条目。
 *
 * `layer` 直接用 `meta.layerIndex`（base=0 / overlay=1），`index` 用同层内的声明序：
 * 与 `paintOrder` 同源，所以 `pickHit` 的逆序遍历严格等于「从最上面往下找」。
 */
export const hitEntriesOf = (view: ScreenLayout): HitEntry[] => {
  const entries: HitEntry[] = [];
  for (const name of view.paintOrder) {
    const rect = view.rects[name];
    const meta = view.meta[name];
    if (rect === undefined || meta === undefined) continue;
    entries.push({ name, rect, hit: meta.hit, layer: meta.layerIndex, index: meta.index });
  }
  return entries;
};

/**
 * 列表里点到第几项：交给 core 的 `listIndexAt`（几何换算不重复实现）。
 *
 * `itemH` / `gap` 必须与 `inventory.ui` 里的静态 style 一致（组件画的和命中的是同一套几何）。
 */
export const listIndexAtPoint = (view: ScreenLayout, point: Point): number | null => {
  const rect = view.rects['list'];
  if (rect === undefined) return null;
  const scrollTop = numberPropOf(view.props['list'] ?? {}, 'scrollTop', 0);
  return listIndexAt(point, rect, scrollTop, {
    itemH: ITEM_H,
    gap: ITEM_GAP,
    count: ITEMS.length,
  });
};

/**
 * 网格里点到第几格：交给 core 的 `gridIndexAt`。
 *
 * `cellW` 必须用 `grid.ts` 的 `cellWidth()` 算（与绘制同源）——自己推一遍
 * `(w - gap×(cols-1))/cols` 就是「看得见点不到」的来源。
 */
export const gridIndexAtPoint = (view: ScreenLayout, point: Point): number | null => {
  const rect = view.rects['grid'];
  if (rect === undefined) return null;
  const props = view.props['grid'] ?? {};
  const cols = numberPropOf(props, 'cols', 4);
  const cellH = numberPropOf(props, 'cellH', 56);
  const gapX = numberPropOf(props, 'gapX', 8);
  const gapY = numberPropOf(props, 'gapY', 8);
  const scrollTop = numberPropOf(props, 'scrollTop', 0);
  return gridIndexAt(point, rect, scrollTop, {
    cols,
    cellW: cellWidth(rect.w, cols, gapX),
    cellH,
    gapX,
    gapY,
    count: ITEMS.length,
  });
};
