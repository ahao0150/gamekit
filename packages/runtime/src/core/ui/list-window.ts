/**
 * 虚拟列表的可见窗口（T16）：纯函数、**O(1)**，不遍历任何一项。
 *
 * 为什么单独成文件：`list` 组件在 draw 里要「一万项只画看得见的 8 项」，
 * 这个换算只跟 `scrollTop / itemH / gap / viewH` 四个数有关，跟 count 无关——
 * 一旦写成遍历（哪怕 `filter`）就会在长列表上每帧烧掉几毫秒，手机端直接掉帧。
 * 抽成纯函数也让它能脱离 canvas 单测（团队规则：纯函数必须可测且不依赖 DOM）。
 *
 * 坐标系约定：`offsetY` 是**窗口首项（start）**的顶边相对视口顶的偏移，恒 ≤ 0
 * （项顶在视口上方时为负）。第 i 项的 y =
 * `offsetY + (i - start) * (itemH + gap)`。
 *
 * `start` 取「包含滚动位置的那一项」：有 gap 时 top 可能落在两顶之间的空隙里，
 * 此时 start 这一项已经整项滚出视口（多带 1 项，画在视口外被裁掉），
 * 这是为了守住 `offsetY ≤ 0` 且滚动时不跳项。
 */

/** 一次换算的结果。 */
export interface ListWindow {
  /** 第一个可见项（含） */
  readonly start: number;
  /** 最后一个可见项（不含） */
  readonly end: number;
  /** 第一项可见项相对视口顶的偏移（≤ 0） */
  readonly offsetY: number;
  /** 全部项总高（含项间 gap，不含末尾 gap） */
  readonly totalH: number;
}

/** 换算入参。 */
export interface ListWindowOptions {
  /** 期望滚动位置（会被钳制到合法范围） */
  readonly scrollTop: number;
  /** 项数 */
  readonly count: number;
  /** 单项高 */
  readonly itemH: number;
  /** 项间距（默认 0） */
  readonly gap?: number;
  /** 视口高（列表可见区域高度） */
  readonly viewH: number;
}

/** 钳到 [lo, hi]；NaN / Infinity 一律回落到 lo（越界不崩）。 */
const clamp = (value: number, lo: number, hi: number): number => {
  if (!Number.isFinite(value)) return lo;
  return Math.min(Math.max(value, lo), hi);
};

/**
 * 换算可见窗口。
 *
 * 边界口径（写死，单测逐条锁住）：
 * - `count <= 0` / `itemH <= 0` / `viewH <= 0` → 空窗口 `{start:0, end:0, offsetY:0, totalH:0}`；
 * - `scrollTop` 钳到 `[0, max(0, totalH - viewH)]`，负数与超大值都是「滚到端头」；
 * - `start` 用 floor、`end` 用 ceil：**部分可见的项两边都算进来**，
 *   保证「画出来的项」覆盖满视口，不会在滚动中途露出半项空白。
 */
export const listWindow = (opts: ListWindowOptions): ListWindow => {
  const count = Number.isFinite(opts.count) && opts.count > 0 ? Math.floor(opts.count) : 0;
  const itemH = Number.isFinite(opts.itemH) && opts.itemH > 0 ? opts.itemH : 0;
  const viewH = Number.isFinite(opts.viewH) && opts.viewH > 0 ? opts.viewH : 0;
  if (count === 0 || itemH === 0 || viewH === 0) return { start: 0, end: 0, offsetY: 0, totalH: 0 };

  const gap = typeof opts.gap === 'number' && Number.isFinite(opts.gap) && opts.gap > 0 ? opts.gap : 0;
  const pitch = itemH + gap; // 项前进一个位置的步长
  const totalH = count * itemH + (count - 1) * gap; // 末尾不留 gap
  const top = clamp(opts.scrollTop, 0, Math.max(0, totalH - viewH));

  // 两次除法 + 取整：与 count 无关，10000 项与 10 项一样快。
  //
  // start 用 floor（= 「包含滚动位置的那一项」），**不做 gap 修正**：
  // top 落在两项之间的 gap 里时，floor 出来的那一项可能已完全滚出视口，
  // 但这样 offsetY 恒 ≤ 0（契约），且滚动中途不会出现「突然跳一项」的抖动；
  // 多带的那 1 项画在视口外被 canvas 裁掉，代价可以忽略。gap = 0 时
  // floor 就是第一个真正相交的项（对拍测试锁住这条）。
  const start = Math.min(count, Math.floor(top / pitch));
  const end = Math.min(count, Math.ceil((top + viewH) / pitch));
  return { start, end, offsetY: start * pitch - top, totalH };
};
