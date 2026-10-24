/**
 * 数字键盘的几何与命中（T19）。
 *
 * 为什么单独成文件：`keypad` 组件的「画格子」和 `keypadHit` 的「点格子」**必须是同一套
 * 几何**——两处各算一遍是「看得见点不到 / 点到别的键」的经典来源（T13a 那类 bug 的兄弟）。
 * 所以网格尺寸、每格矩形、命中判定都收在这里，组件只负责画。
 *
 * 坐标约定同 `hit.ts`：左上角原点、逻辑像素、矩形**左闭右开**；格间隙里不算命中。
 */

import type { Rect } from '../contract';
import type { HitPoint } from '../hit';

/** 键盘布局参数（props + 数据）。 */
export interface KeypadOptions {
  /** 每行几个键（实测值，钳到 ≥ 1） */
  readonly cols: number;
  /** 键高（像素） */
  readonly keyH: number;
  /** 键间距（像素，钳到 ≥ 0） */
  readonly gap: number;
  /** 键位文字（`del` / `ok` 之类就是普通字符串） */
  readonly keys: readonly string[];
}

/** 换算后的网格尺寸。 */
export interface KeypadMetrics {
  readonly cols: number;
  readonly gap: number;
  readonly keyH: number;
  /** 单格宽（由 box 宽均分：`(w - gap×(cols-1)) / cols`） */
  readonly keyW: number;
  /** 行数（最后一排可以不满） */
  readonly rows: number;
}

/** 网格换算（纯函数，容错到「不崩」）。 */
export const keypadMetrics = (box: Rect, opts: KeypadOptions): KeypadMetrics => {
  const cols = Number.isFinite(opts.cols) && opts.cols > 0 ? Math.floor(opts.cols) : 1;
  const gap = Number.isFinite(opts.gap) && opts.gap > 0 ? opts.gap : 0;
  const keyH = Number.isFinite(opts.keyH) && opts.keyH > 0 ? opts.keyH : 1;
  const keyW = (box.w - gap * (cols - 1)) / cols;
  const rows = Math.max(1, Math.ceil(opts.keys.length / cols));
  return { cols, gap, keyH, keyW, rows };
};

/** 第 `index` 个键的矩形（越界也返回框外矩形，调用方自己按 count 过滤）。 */
export const keypadCell = (box: Rect, opts: KeypadOptions, index: number): Rect => {
  const m = keypadMetrics(box, opts);
  const col = index % m.cols;
  const row = Math.floor(index / m.cols);
  return {
    x: box.x + col * (m.keyW + m.gap),
    y: box.y + row * (m.keyH + m.gap),
    w: m.keyW,
    h: m.keyH,
  };
};

/**
 * 命中：返回按到的键。
 *
 * 返回 null 的四种情况（单测逐条锁住）：点在 box 外 / 落在键与键的间隙里 /
 * 落在行间间隙里 / 落在最后一行不满的空位（`index >= keys.length`）。
 */
export const keypadHit = (
  box: Rect,
  opts: KeypadOptions,
  point: HitPoint,
): { readonly index: number; readonly key: string } | null => {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  if (!(box.w > 0) || !(box.h > 0)) return null;
  const m = keypadMetrics(box, opts);
  if (!(m.keyW > 0)) return null;
  const relX = point.x - box.x;
  const relY = point.y - box.y;
  if (relX < 0 || relY < 0 || relX >= box.w) return null;
  const totalH = m.rows * m.keyH + (m.rows - 1) * m.gap;
  if (relY >= totalH) return null;

  const stepX = m.keyW + m.gap;
  const col = Math.floor(relX / stepX);
  if (col >= m.cols) return null;
  if (relX - col * stepX >= m.keyW) return null; // x 落在列间隙
  const stepY = m.keyH + m.gap;
  const row = Math.floor(relY / stepY);
  if (relY - row * stepY >= m.keyH) return null; // y 落在行间隙

  const index = row * m.cols + col;
  if (index >= opts.keys.length) return null; // 最后一行的空位
  const key = opts.keys[index];
  return key === undefined ? null : { index, key };
};
