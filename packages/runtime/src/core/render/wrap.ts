/**
 * 文本折行 + 变高项高度预计算。
 *
 * 为什么要有：`list` 只支持定高（`widgets/list.ts` 的 `itemH`），`label` 是单行省略号
 * （`ellipsize()` 超宽截断加 `…`）—— 聊天消息必须按文本换行变高，这两条路都不通。
 * 折行放在 `core/render`（纯计算、不碰 canvas），布局期与绘制期共用同一套口径。
 *
 * **折行一律按估算，两期用同一个 measure**：折行是布局决策（决定行数 → 决定项高），
 * 必须与绘制一致。用真 `measureText` 折行看似更准，但布局期拿不到 ctx，两期结果必然不同
 * —— 要么少算行数导致溢出容器，要么多算留下一块白。所以默认估算（`estimateTextWidth`），
 * 真实字宽的偏差交给绘制期 `TextStyle.maxWidth`（透传 `fillText` 第四参）横向压缩兜住：
 * 最坏是被压窄，不会溢出。
 *
 * `measure` 仍可注入（测试要构造确定性的宽度，`RenderService.measureText` 也能传），
 * 但**同一个界面的布局期与绘制期必须传同一个**，否则又回到两期不一致。
 */

import type { TextStyle } from './contract';
import { estimateTextWidth } from '../ui/components';

/** 文字宽度测量。与 `RenderService.measureText` 同签名，可互换。 */
export type MeasureFn = (text: string, style?: TextStyle) => number;

/** `TextStyle.size` 的默认值（与 render 契约一致）。 */
const DEFAULT_FONT = 16;
/** 不传 lineHeight 时的行高倍数（与 `TextStyle.lineHeight` 的注释一致）。 */
const LINE_HEIGHT_RATIO = 1.2;

/** 默认测量：等宽估算（CJK 1 字宽 / ASCII 0.55 字宽），与布局期同口径。 */
const defaultMeasure: MeasureFn = (text, style) => estimateTextWidth(text, style?.size ?? DEFAULT_FONT);

/** CJK / 全角标点：按字符边界断行。 */
const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;

const isCjk = (ch: string): boolean => CJK.test(ch);

/** 西文可断点：空格 / 制表符 / 连字符**之后**。 */
const isBreakableAfter = (ch: string): boolean => ch === ' ' || ch === '\t' || ch === '-';

/**
 * 在 `rest` 里找最长的能放下的前缀长度（**二分**）。
 *
 * 前缀宽度随长度单调不减，所以可以二分；逐字符累加在长文本上是 O(n²)。
 */
const fitPrefixLength = (rest: readonly string[], maxWidth: number, style: TextStyle | undefined, measure: MeasureFn): number => {
  const widthOf = (len: number): number => measure(rest.slice(0, len).join(''), style);
  let lo = 0;
  let hi = rest.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (widthOf(mid) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

/**
 * 折一段（不含 `\n`）文本，结果追加进 `out`。保证每行 `measure ≤ maxWidth`。
 *
 * 断行优先级：**西文空格处 → 字符边界（含 CJK）→ 单字符独占**。
 */
const wrapParagraph = (
  text: string,
  maxWidth: number,
  style: TextStyle | undefined,
  measure: MeasureFn,
  out: string[],
): void => {
  let rest = [...text];
  while (rest.length > 0) {
    const fit = fitPrefixLength(rest, maxWidth, style, measure);
    if (fit === 0) {
      // 单个字符就超宽：独占一行，绝不丢字、也不死循环
      out.push(rest[0] as string);
      rest = rest.slice(1);
      continue;
    }
    if (fit === rest.length) {
      out.push(rest.join(''));
      return;
    }
    // 在能放下的范围里往回找最后一个西文断点；遇到 CJK 就停（CJK 天然可在任意处断）
    let breakAt = 0;
    for (let i = fit; i > 0; i -= 1) {
      if (isBreakableAfter(rest[i - 1] as string)) {
        breakAt = i;
        break;
      }
      if (isCjk(rest[i] as string)) break;
    }
    const cut = breakAt > 0 ? breakAt : fit;
    const line = rest.slice(0, cut).join('').trimEnd();
    // trimEnd 只会更窄，不会破坏 ≤ maxWidth；但整行都是空格时不能产出空串行
    out.push(line.length > 0 ? line : rest.slice(0, cut).join(''));
    rest = rest.slice(cut);
  }
};

/**
 * 把文本折成若干行。
 *
 * 边界口径（单测逐条锁住）：
 * - 空串 → `[]`（不是 `['']`，否则「没有消息」会画出一个空行高的气泡）；
 * - 显式 `\n` 强制断行，连续的 `\n` 保留空行；
 * - `maxWidth <= 0`（或非有限数）→ 按 `\n` 切原样行，不做任何折行；
 * - 每行宽度（用同一个 measure 验）≤ maxWidth；单个字符就超宽时它独占一行。
 */
export const wrapText = (
  text: string,
  maxWidth: number,
  style?: TextStyle,
  measure?: MeasureFn,
): readonly string[] => {
  if (!(maxWidth > 0) || !Number.isFinite(maxWidth)) return text.split('\n');
  if (text.length === 0) return [];

  const m = measure ?? defaultMeasure;
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      out.push('');
      continue;
    }
    wrapParagraph(paragraph, maxWidth, style, m, out);
  }
  // 末尾的空段由 split 产生（如 'a\n'）——保留它，与 textLines 的逐行语义一致
  return out;
};

// ---------------------------------------------------------------------------
// 变高项高度预计算
// ---------------------------------------------------------------------------

export interface ItemHeightOptions {
  /** 左右内边距之和（可用宽度 = width − paddingX），默认 0 */
  readonly paddingX?: number;
  /** 上下内边距之和，默认 0 */
  readonly paddingY?: number;
  /** 行高；不传按 `style.size × 1.2` */
  readonly lineHeight?: number;
  readonly style?: TextStyle;
  readonly measure?: MeasureFn;
  /** 从一项里取文本；默认取字符串项本身，或对象项上的 `text` 字段 */
  readonly textOf?: (item: unknown) => string;
  /** 最少算几行（气泡至少一行高），默认 1 */
  readonly minLines?: number;
}

const defaultTextOf = (item: unknown): string => {
  if (typeof item === 'string') return item;
  if (typeof item === 'object' && item !== null) {
    const text = (item as { readonly text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
};

/**
 * 给 `list` 算变高用的高度数组：每项 = max(minLines, 折行行数) × lineHeight + paddingY。
 *
 * 游戏侧一行就能拿到：`measureItemHeights(messages, box.w, { paddingX: 32, paddingY: 16 })`
 * 然后塞进 `deps.data.itemHeights`。**组件不回调测量** —— 测量放预计算，
 * 组件只做「按前缀和定位」，1 万项也不在每帧里跑折行。
 */
export const measureItemHeights = (
  items: readonly unknown[],
  width: number,
  opts?: ItemHeightOptions,
): readonly number[] => {
  const paddingX = Number.isFinite(opts?.paddingX) ? Math.max(0, opts?.paddingX ?? 0) : 0;
  const paddingY = Number.isFinite(opts?.paddingY) ? Math.max(0, opts?.paddingY ?? 0) : 0;
  const style = opts?.style;
  const measure = opts?.measure ?? defaultMeasure;
  const textOf = opts?.textOf ?? defaultTextOf;
  const minLines = Math.max(1, Math.floor(opts?.minLines ?? 1));
  const lineHeight = opts?.lineHeight ?? (style?.lineHeight ?? (style?.size ?? DEFAULT_FONT) * LINE_HEIGHT_RATIO);
  const usable = Math.max(0, width - paddingX);

  return items.map((item) => {
    const lines = wrapText(textOf(item), usable, style, measure);
    const count = Math.max(minLines, lines.length);
    return count * lineHeight + paddingY;
  });
};
