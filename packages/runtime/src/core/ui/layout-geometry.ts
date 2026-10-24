/**
 * 布局的几何工具（T33 抽出）。
 *
 * 从 `layout.ts` 拆出来是为了守 AGENTS 铁律 2（单文件 ≤ 300 行）：
 * v0.6 的 `at` 任意定位加进去之后，`layout.ts` 放不下了。
 *
 * 这里只有「数字兜底 + 长度解析 + 内边距 / 内缩」这类纯计算，**没有布局语义**；
 * 布局语义（切带、一维流、overlay 求解）仍然只在 `layout.ts` 里。
 */

import type { Insets, Rect } from './contract';
import type { LayoutViewport, Length, LengthInsets } from './layout-spec';

/** 数字兜底：NaN / Infinity 一律当 0（画不出来比画错位置更难查）。 */
export const num = (v: number): number => (Number.isFinite(v) ? v : 0);

/** 统一保留两位小数：避免 0.30000000000000004 这种值进 rects。 */
export const round2 = (v: number): number => Math.round(num(v) * 100) / 100;

/** 长度解析：像素直取，百分比乘基数（水平基数=视口宽，垂直基数=视口高）。 */
export const resolveLength = (length: Length | undefined, basis: number): number => {
  if (length === undefined) return 0;
  if (typeof length === 'number') return num(length);
  return num(basis * length.r);
};

/** 把 number / LengthInsets 统一成 Insets（百分比按各自方向取基数）。 */
export const toInsets = (padding: number | LengthInsets | undefined, viewport: LayoutViewport): Insets => {
  if (padding === undefined) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof padding === 'number') {
    const n = num(padding);
    return { top: n, right: n, bottom: n, left: n };
  }
  return {
    top: resolveLength(padding.top, viewport.height),
    right: resolveLength(padding.right, viewport.width),
    bottom: resolveLength(padding.bottom, viewport.height),
    left: resolveLength(padding.left, viewport.width),
  };
};

/** 内缩一个矩形（四边同时内缩，返回左上角与尺寸）。 */
export const deflate = (rect: Rect, insets: Insets): { x: number; y: number; w: number; h: number } => ({
  x: rect.x + insets.left,
  y: rect.y + insets.top,
  w: Math.max(0, rect.w - insets.left - insets.right),
  h: Math.max(0, rect.h - insets.top - insets.bottom),
});

/** 布局求解的共享上下文（各求解函数往里写 rect / 错误）。 */
export interface Ctx {
  readonly rects: Record<string, Rect>;
  readonly regions: Record<string, Rect>;
  readonly errors: string[];
  /** 视口尺寸：百分比长度取基数用（v0.3） */
  readonly viewport: LayoutViewport;
}
