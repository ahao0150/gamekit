/**
 * 数据驱动组件的「子项」命中换算（T31 补充）：列表项 / 网格格。
 *
 * 为什么必须收进 core：同一件事以前散在游戏里各写一份 —— `ui-demo` 自己写了
 * `itemIndexAt(pointY, rect.y, offset)`，`grid` 还没有，而画格子/点格子各自推一遍
 * 公式就是「看得见点不到 / 点到隔壁」的经典来源。`keypadHit` 早就把「画与点同一套
 * 几何」做对了（T19），这里照它的原则补上列表和网格。
 *
 * 与绘制同源的口径（写死）：
 * - 列表项 `i` 的顶边 `y = rect.y - scrollTop + i × (itemH + gap)`；
 * - 网格格 `(row, col)` 的左上角 `x = rect.x + col × (cellW + gapX)`、
 *   `y = rect.y - scrollTop + row × (cellH + gapY)`；
 * - `cellW` **由调用方传入**，且必须与 `grid` 绘制时用的是同一个值
 *   （`grid.ts` 导出了 `cellWidth()`，两边共用它，不要各推一遍）。
 *
 * 边界（`keypadHit` 同款，单测逐条锁住）：
 * - 容器外（含负坐标 / NaN）→ null；
 * - 落在 `gap` 空隙里 → null（**不就近归到某一项**：点到缝里选中东西最莫名其妙）；
 * - 最后一行 / 最后一项之后的多余位置（`index >= count`）→ null；
 * - 滚动偏移正确（用 `point.y - rect.y + scrollTop` 反解到内容坐标）；
 * - 矩形左闭右开（右边界 / 下边界不命中）。
 */

import type { Rect } from './contract';
import type { HitPoint } from './hit';

/** 列表的几何参数（与 `list` 组件的 props 同源）。 */
export interface ListHitOptions {
  /** 单项高（必须 > 0） */
  readonly itemH: number;
  /** 项间距（默认 0，负数按 0） */
  readonly gap?: number;
  /** 总项数（<= 0 一律不命中） */
  readonly count: number;
}

/** 网格的几何参数（与 `grid` 组件的 props 同源）。 */
export interface GridHitOptions {
  /** 列数（必须 > 0） */
  readonly cols: number;
  /** 单元格宽（**与绘制同源**：用 `grid.ts` 的 `cellWidth()` 算） */
  readonly cellW: number;
  /** 单元格高（必须 > 0） */
  readonly cellH: number;
  /** 列间距（默认 0） */
  readonly gapX?: number;
  /** 行间距（默认 0） */
  readonly gapY?: number;
  /** 总项数（<= 0 一律不命中） */
  readonly count: number;
}

/** 坐标可用（有限数）；NaN / Infinity 一律当坏输入。 */
const finitePoint = (point: HitPoint): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

/** 点在容器内（左闭右开；宽高 <= 0 的容器不命中）。 */
const insideRect = (rect: Rect, point: HitPoint): boolean => {
  if (!(rect.w > 0) || !(rect.h > 0)) return false;
  return point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h;
};

/** 间距：非有限值 / 负数一律按 0（与组件的 `Math.max(0, numberProp(...))` 同口径）。 */
const gapOf = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * 列表：点在**第几项**？容器外 / gap 空隙 / 超出 count → null。
 *
 * 反解公式：`local = point.y - rect.y + scrollTop`，`index = floor(local / (itemH + gap))`；
 * 再检查 `local - index × pitch` 是否落在项内（`>= itemH` 就是掉进 gap 了）。
 */
export const listIndexAt = (
  point: HitPoint,
  rect: Rect,
  scrollTop: number,
  opts: ListHitOptions,
): number | null => {
  if (!finitePoint(point) || !insideRect(rect, point)) return null;
  const itemH = Number.isFinite(opts.itemH) && opts.itemH > 0 ? opts.itemH : 0;
  const count = Number.isFinite(opts.count) && opts.count > 0 ? Math.floor(opts.count) : 0;
  if (itemH === 0 || count === 0) return null;

  const scroll = Number.isFinite(scrollTop) ? scrollTop : 0;
  const local = point.y - rect.y + scroll;
  if (local < 0) return null; // 滚动位把这一行推到容器上方：内容坐标里也在第一项之前

  const pitch = itemH + gapOf(opts.gap);
  const index = Math.floor(local / pitch);
  if (local - index * pitch >= itemH) return null; // 落在项间距里
  return index < count ? index : null;
};

/**
 * 网格：点在**第几格**？容器外 / 行列间距 / 最后一行不满的空位 / 超出 count → null。
 *
 * 反解公式：`localX = point.x - rect.x`、`localY = point.y - rect.y + scrollTop`；
 * `col = floor(localX / (cellW + gapX))`、`row = floor(localY / (cellH + gapY))`；
 * 再检查两轴是否落在间距里，最后 `index = row × cols + col` 且 `< count`。
 */
export const gridIndexAt = (
  point: HitPoint,
  rect: Rect,
  scrollTop: number,
  opts: GridHitOptions,
): number | null => {
  if (!finitePoint(point) || !insideRect(rect, point)) return null;
  const cols = Number.isFinite(opts.cols) && opts.cols > 0 ? Math.floor(opts.cols) : 0;
  const cellW = Number.isFinite(opts.cellW) && opts.cellW > 0 ? opts.cellW : 0;
  const cellH = Number.isFinite(opts.cellH) && opts.cellH > 0 ? opts.cellH : 0;
  const count = Number.isFinite(opts.count) && opts.count > 0 ? Math.floor(opts.count) : 0;
  if (cols === 0 || cellW === 0 || cellH === 0 || count === 0) return null;

  const scroll = Number.isFinite(scrollTop) ? scrollTop : 0;
  const localX = point.x - rect.x;
  const localY = point.y - rect.y + scroll;
  if (localY < 0) return null;

  const pitchX = cellW + gapOf(opts.gapX);
  const pitchY = cellH + gapOf(opts.gapY);
  const col = Math.floor(localX / pitchX);
  const row = Math.floor(localY / pitchY);
  if (col >= cols) return null; // 右侧多出来的空间（容器比内容宽）
  if (localX - col * pitchX >= cellW) return null; // 落在列间距
  if (localY - row * pitchY >= cellH) return null; // 落在行间距

  const index = row * cols + col;
  return index < count ? index : null; // 最后一行不满的空位
};
