/**
 * 自绘区域的切分原语（`splitRows` / `splitCols` / `gridOf`）与重叠检测（`findOverlaps`）。
 *
 * **为什么需要**：`.ui` 由布局求解给矩形，`iaa-simple` 用 `computeRect` + `minSize/maxSize`，
 * 只有「在 canvas 上自己画」的部分完全没有约束 —— 于是游戏代码只能拿 `viewport` 手算，
 * 写出 `vp.width - 24`、`Math.max(90, vp.height * 0.16)` 这类魔法数，
 * 320×568 下必然重叠或溢出（实测两次：《快递装车员》《拼豆工坊》的盘面/色块池互相压）。
 *
 * 这里只做一件事：**把一个矩形按比例切成首尾相接、端点对齐的子矩形**。
 * 自绘代码从此只在给定区域内切分，不再碰 viewport。
 *
 * 比例按总和归一化，所以权重写法也成立：
 * `splitRows(area, [0.6, 0.1, 0.25, 0.05])` 与 `splitRows(area, [12, 2, 5, 1])` 等价
 * —— 这就是自绘版的 weight。
 *
 * 全部纯函数；参数非法**直接抛错**（静默兜底会把布局错误藏起来，正是要避免的）。
 */

import type { Rect } from './contract';

/** 比例数组：正数即可，不必和为 1（内部归一化） */
export type Ratios = readonly number[];

/** 贴边判定容差：比例切分会产生小数，1e-6 内算「相接」而不是「重叠」 */
const EPS = 1e-6;

const validateRatios = (ratios: Ratios): number => {
  if (ratios.length === 0) throw new Error('比例数组不能为空');
  let total = 0;
  for (const r of ratios) {
    if (!Number.isFinite(r) || r <= 0) throw new Error(`比例必须是正数，收到 ${String(r)}`);
    total += r;
  }
  return total;
};

interface Span {
  readonly at: number;
  readonly len: number;
}

/** 一维切分：把 `[start, start+size]` 按 ratios 切成首尾相接的区间。 */
const cutAxis = (start: number, size: number, ratios: Ratios): Span[] => {
  const total = validateRatios(ratios);
  const out: Span[] = [];
  let acc = 0;
  for (let i = 0; i < ratios.length; i += 1) {
    const from = start + (size * acc) / total;
    acc += ratios[i] as number;
    // 最后一格收口到边界：浮点累积会让下沿/右沿差零点几像素，看着像缺一条
    const to = i === ratios.length - 1 ? start + size : start + (size * acc) / total;
    out.push({ at: from, len: to - from });
  }
  return out;
};

/** 纵向切带（自上而下），返回顺序与 ratios 一致。 */
export const splitRows = (area: Rect, ratios: Ratios): readonly Rect[] =>
  cutAxis(area.y, area.h, ratios).map((s) => ({ x: area.x, y: s.at, w: area.w, h: s.len }));

/** 横向切列（自左而右），返回顺序与 ratios 一致。 */
export const splitCols = (area: Rect, ratios: Ratios): readonly Rect[] =>
  cutAxis(area.x, area.w, ratios).map((s) => ({ x: s.at, y: area.y, w: s.len, h: area.h }));

/** 在 area 内切 `cols × rows` 均匀网格，**行优先**（先第一行从左到右，再第二行）。 */
export const gridOf = (area: Rect, cols: number, rows: number): readonly Rect[] => {
  if (!Number.isInteger(cols) || cols <= 0) throw new Error(`gridOf 的 cols 必须是正整数，收到 ${String(cols)}`);
  if (!Number.isInteger(rows) || rows <= 0) throw new Error(`gridOf 的 rows 必须是正整数，收到 ${String(rows)}`);
  const xs = cutAxis(area.x, area.w, new Array<number>(cols).fill(1));
  const ys = cutAxis(area.y, area.h, new Array<number>(rows).fill(1));
  const out: Rect[] = [];
  for (const y of ys) for (const x of xs) out.push({ x: x.at, y: y.at, w: x.len, h: y.len });
  return out;
};

/** 严格相交（贴边不算重叠）。 */
const overlapPair = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w - EPS &&
  b.x < a.x + a.w - EPS &&
  a.y < b.y + b.h - EPS &&
  b.y < a.y + a.h - EPS;

/**
 * 检查一组命名矩形有没有两两重叠，返回相交的名字对（排序稳定）。
 * 空数组 = 全都不重叠。**测试里用它代替肉眼看截图**：布局重叠能被断言出来，截图不能。
 */
export const findOverlaps = (
  rects: Readonly<Record<string, Rect>>,
): readonly (readonly [string, string])[] => {
  const names = Object.keys(rects).sort();
  const out: Array<readonly [string, string]> = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = rects[names[i] as string] as Rect;
      const b = rects[names[j] as string] as Rect;
      if (overlapPair(a, b)) out.push([names[i] as string, names[j] as string]);
    }
  }
  return out;
};

/** 比例和不是 1 也照切（归一化）；这里只是给调用方一个显式断言用的诊断。 */
export const ratiosSum = (ratios: Ratios): number => ratios.reduce((a, b) => a + b, 0);
