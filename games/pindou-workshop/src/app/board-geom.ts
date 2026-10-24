/**
 * 自绘区几何（纯函数）：render.ts 与 game.ts 共用同一份。
 *
 * T63：区域来自 `.ui` 的 `boardArea`，内部用 runtime 的 `splitRows` / `gridOf` 切分
 * （比例按总和归一化、最后一格自动收口）。以前在内部手算 y 导致 440×956 上色块池
 * 溢出屏幕、按钮被压住 —— 现在没有任何一处按 viewport 算。
 *
 * 四段权重：[盘面 0.6, 临时位 0.1, 色块池 0.25]（第四段道具条是 `.ui` 的一条真按钮带）。
 */

import { gridOf, splitRows } from './deps';
import { GRID } from './levels';

/** 触摸目标下限（px，仅提示，不参与几何硬约束） */
export const TOUCH_MIN = 40;
/** 描边宽 */
export const STROKE = 1;
/** 豆子高光比例 */
export const HILIGHT = 0.18;
/** 色块池块间距 */
export const POOL_GAP = 4;
/** 临时位格间距 */
export const SLOT_GAP = 6;
/** 自绘区三段权重（比例，不是百分比；总和不必是 1） */
export const AREA_RATIOS = [0.6, 0.1, 0.25] as const;

export interface AreaRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface BoardGeom {
  /** 盘面：GRID×GRID 正方形（在盘面带内居中） */
  readonly cell: number;
  readonly bx: number;
  readonly by: number;
  readonly size: number;
  /** 临时位（一行，左对齐） */
  readonly slotCell: number;
  readonly slotX: number;
  readonly slotY: number;
  /** 色块池（自适应列数，整块在池子带内居中） */
  readonly poolCell: number;
  readonly poolX: number;
  readonly poolY: number;
  readonly poolCols: number;
  /** 三段带矩形（测试拿它们做重叠断言） */
  readonly bands: { readonly play: AreaRect; readonly slot: AreaRect; readonly pool: AreaRect };
}

/** 盘面带 → 正方形网格：边长取带内短边，居中放置 */
const squareOf = (band: AreaRect): AreaRect => {
  const size = Math.max(0, Math.min(band.w, band.h));
  return { x: band.x + (band.w - size) / 2, y: band.y + (band.h - size) / 2, w: size, h: size };
};

/** 按「块能塞进带」反解列数：每个 cols 算一次格边，取最大者（保证最后一行完整可见） */
const fitPool = (area: AreaRect, count: number): { cell: number; cols: number } => {
  let best = { cell: 0, cols: 1 };
  const maxCols = Math.max(1, Math.min(14, count));
  for (let cols = 1; cols <= maxCols; cols += 1) {
    const rows = Math.ceil(count / cols);
    const cw = (area.w - (cols - 1) * POOL_GAP) / cols;
    const ch = (area.h - (rows - 1) * POOL_GAP) / rows;
    const cell = Math.min(cw, ch);
    if (cell > best.cell) best = { cell, cols };
  }
  return { cell: Math.max(0, best.cell), cols: best.cols };
};

/**
 * 由 `boardArea` 推出全部几何。
 * `pieceCount` = 还没归位的色块数（决定池子几行）；`slots` = 临时位格数。
 */
export const boardGeomOf = (area: AreaRect, pieceCount: number, slots: number): BoardGeom => {
  const bands = splitRows(area, AREA_RATIOS);
  const playBand = bands[0] ?? area;
  const slotBand = bands[1] ?? area;
  const poolBand = bands[2] ?? area;

  const board = squareOf(playBand);
  const cell = board.w / GRID;

  const count = Math.max(1, slots);
  const slotCell = Math.max(
    0,
    Math.min(slotBand.h, (slotBand.w - (count - 1) * SLOT_GAP) / count, cell || slotBand.h),
  );
  const slotX = slotBand.x;
  const slotY = slotBand.y + (slotBand.h - slotCell) / 2;

  const pool = fitPool(poolBand, Math.max(1, pieceCount));
  const rows = Math.ceil(Math.max(1, pieceCount) / pool.cols);
  const blockW = pool.cols * pool.cell + (pool.cols - 1) * POOL_GAP;
  const blockH = rows * pool.cell + (rows - 1) * POOL_GAP;
  const poolX = poolBand.x + (poolBand.w - blockW) / 2;
  const poolY = poolBand.y + (poolBand.h - blockH) / 2;

  return {
    cell, bx: board.x, by: board.y, size: board.w,
    slotCell, slotX, slotY,
    poolCell: pool.cell, poolX, poolY, poolCols: pool.cols,
    bands: { play: playBand, slot: slotBand, pool: poolBand },
  };
};

/** 盘面每格的矩形（行优先）：用 runtime 的 gridOf 切，不再自己乘 cell 下标 */
export const boardCells = (g: BoardGeom): readonly AreaRect[] =>
  gridOf({ x: g.bx, y: g.by, w: g.size, h: g.size }, GRID, GRID);

/** 指针 → 盘面格下标（越界 null） */
export const gridAt = (g: BoardGeom, x: number, y: number): number | null => {
  if (g.cell <= 0) return null;
  const c = Math.floor((x - g.bx) / g.cell);
  const r = Math.floor((y - g.by) / g.cell);
  if (c < 0 || c >= GRID || r < 0 || r >= GRID) return null;
  return r * GRID + c;
};

/** 指针 → 临时位序号 */
export const slotAt = (g: BoardGeom, slots: number, x: number, y: number): number | null => {
  if (g.slotCell <= 0) return null;
  if (y < g.slotY || y > g.slotY + g.slotCell) return null;
  const k = Math.floor((x - g.slotX) / (g.slotCell + SLOT_GAP));
  return k >= 0 && k < slots ? k : null;
};

/** 第 k 个待取块的锚点（与 render 同源） */
export const poolPos = (g: BoardGeom, k: number): { readonly x: number; readonly y: number; readonly s: number } => ({
  x: g.poolX + (k % g.poolCols) * (g.poolCell + POOL_GAP),
  y: g.poolY + Math.floor(k / g.poolCols) * (g.poolCell + POOL_GAP),
  s: g.poolCell,
});

/** 第 k 个临时位的锚点 */
export const slotPos = (g: BoardGeom, k: number): { readonly x: number; readonly y: number; readonly s: number } => ({
  x: g.slotX + k * (g.slotCell + SLOT_GAP),
  y: g.slotY,
  s: g.slotCell,
});

/** 指针 → 待取块序号（只在池子里找） */
export const poolAt = (g: BoardGeom, count: number, x: number, y: number): number | null => {
  if (g.poolCell <= 0) return null;
  const c = Math.floor((x - g.poolX) / (g.poolCell + POOL_GAP));
  const r = Math.floor((y - g.poolY) / (g.poolCell + POOL_GAP));
  if (c < 0 || c >= g.poolCols || r < 0) return null;
  const k = r * g.poolCols + c;
  return k >= 0 && k < count ? k : null;
};

/** 熨烫页：boardArea 切成 [盘面, 温度条] */
export const ironGeomOf = (
  area: AreaRect,
): { readonly cell: number; readonly bx: number; readonly by: number; readonly size: number; readonly bar: AreaRect } => {
  const [playBand, bar] = splitRows(area, [0.85, 0.15]);
  const board = squareOf(playBand ?? area);
  return { cell: board.w / GRID, bx: board.x, by: board.y, size: board.w, bar: bar ?? area };
};
