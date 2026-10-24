/**
 * 网格可见行窗口（T31）：纯函数、**O(1)**，不遍历任何一项。
 *
 * 为什么单独成文件：`grid` 组件在 draw 里要「一千项只画看得见的几行」，
 * 这个换算只跟 `scrollTop / cols / cellH / gapY / viewH` 有关，跟 count 无关。
 * 抽成纯函数能脱离 canvas 单测，也让 `list`（一维）和 `grid`（二维）的**滚动口
 * 径完全一致** —— 两者都复用 `listWindow`，不会一个 clamp 了另一个没 clamp。
 *
 * 与 `listWindow` 的对应关系：行数 = `ceil(count / cols)`、行高 = `cellH`、
 * 行间距 = `gapY`。所以 `rowStart` / `rowEnd` / `offsetY` / `totalH` 的语义
 * 直接继承 `listWindow`（floor / ceil、offsetY ≤ 0、末尾不留 gap）。
 *
 * 坐标系约定：`offsetY` 是**窗口首行（rowStart）**的顶边相对视口顶的偏移，恒 ≤ 0。
 * 第 `row` 行的 y = `box.y + offsetY + (row - rowStart) * (cellH + gapY)`。
 */

import { listWindow } from './list-window';

/** 一次网格窗口换算的结果。 */
export interface GridWindow {
  /** 第一条可见行（含） */
  readonly rowStart: number;
  /** 最后一条可见行（不含） */
  readonly rowEnd: number;
  /** 首行相对视口顶的偏移（≤ 0） */
  readonly offsetY: number;
  /** 内容总高（行高 + 行间距，不含末尾 gap） */
  readonly totalH: number;
}

/** 换算入参。 */
export interface GridWindowOptions {
  /** 期望滚动位置（会被钳制到合法范围） */
  readonly scrollTop: number;
  /** 总项数 */
  readonly count: number;
  /** 列数（<= 0 视为空窗口） */
  readonly cols: number;
  /** 单元格高 */
  readonly cellH: number;
  /** 行间距（默认 0） */
  readonly gapY?: number;
  /** 视口高（网格可见区域高度） */
  readonly viewH: number;
}

/**
 * 换算网格可见行窗口。
 *
 * 边界口径（写死，单测逐条锁住）：
 * - `cols <= 0` / `count <= 0` / `cellH <= 0` / `viewH <= 0` → 空窗口
 *   `{rowStart:0, rowEnd:0, offsetY:0, totalH:0}`；
 * - **最后一行不满也算一行**：`count=10, cols=4` → 3 行（不是 2.5 行），
 *   否则最后一行永远画不出来；
 * - `scrollTop` 钳到 `[0, max(0, totalH - viewH)]`；
 * - `rowStart` 用 floor、`rowEnd` 用 ceil（部分可见的行两边都算进来），
 *   与 `listWindow` 同一口径 —— 滚动中途不会露半行空白。
 */
export const gridWindow = (opts: GridWindowOptions): GridWindow => {
  const cols = Number.isFinite(opts.cols) && opts.cols > 0 ? Math.floor(opts.cols) : 0;
  const count = Number.isFinite(opts.count) && opts.count > 0 ? Math.floor(opts.count) : 0;
  // 空窗口：任何一项非法就整体退化成空（不猜部分信息）
  if (cols === 0 || count === 0) return { rowStart: 0, rowEnd: 0, offsetY: 0, totalH: 0 };

  // 最后一行不满也计入行数（ceil）：count=10/cols=4 → 3 行
  const rows = Math.ceil(count / cols);
  const win = listWindow({
    scrollTop: opts.scrollTop,
    count: rows,
    itemH: opts.cellH,
    gap: opts.gapY,
    viewH: opts.viewH,
  });
  return { rowStart: win.start, rowEnd: win.end, offsetY: win.offsetY, totalH: win.totalH };
};
