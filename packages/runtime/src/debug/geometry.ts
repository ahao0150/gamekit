/**
 * 绘制记录的「取值」工具：矩阵投影、资源名、颜色、安全数字。
 *
 * 拆出来的原因很实际：recorder.ts 主逻辑（拦截、切帧、环形缓冲）已经 250 行，
 * 再放这些纯函数就超了 AGENTS 铁律 2 的 300 行上限。这里全部是纯函数，
 * 不碰记录器状态，也便于单独测试。
 */

import type { Ctx2D, DrawRect } from './contract';

/** 变换矩阵的最小结构（`DOMMatrix` 的子集；mock ctx 也能满足）。 */
export interface MatrixLike {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: MatrixLike = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** 坐标保留 2 位小数：diff 时噪声少，又不丢亚像素信息。 */
export const round = (v: number): number => Math.round(v * 100) / 100;

/**
 * 取当前变换矩阵。
 *
 * 为什么要乘矩阵：游戏画九宫格、按钮和动效时会先 `translate` / `scale`，
 * `drawImage` 收到的是局部坐标；不换算的话记录里会全是「0,0」，
 * 和布局树永远对不上。mock / 老实现没有 `getTransform` 时按单位矩阵处理。
 */
export function matrixOf(ctx: Ctx2D): MatrixLike {
  const raw = (ctx as unknown as { getTransform?: () => MatrixLike }).getTransform;
  if (typeof raw !== 'function') return IDENTITY;
  try {
    const m = raw.call(ctx);
    return Number.isFinite(m.a) && Number.isFinite(m.e) ? m : IDENTITY;
  } catch {
    return IDENTITY;
  }
}

/** 把局部矩形按矩阵变换成屏幕坐标的**轴对齐包围盒**（旋转时略大于真实矩形）。 */
export function project(m: MatrixLike, x: number, y: number, w: number, h: number): DrawRect {
  const xs = [x, x + w, x, x + w];
  const ys = [y, y, y + h, y + h];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 4; i += 1) {
    const px = xs[i] ?? 0;
    const py = ys[i] ?? 0;
    const tx = m.a * px + m.c * py + m.e;
    const ty = m.b * px + m.d * py + m.f;
    if (tx < minX) minX = tx;
    if (ty < minY) minY = ty;
    if (tx > maxX) maxX = tx;
    if (ty > maxY) maxY = ty;
  }
  return { x: round(minX), y: round(minY), w: round(maxX - minX), h: round(maxY - minY) };
}

/**
 * 从图片对象上尽量取一个人类能认的资源标识。
 *
 * 游戏绘制时传的是 `asset.native`（HTMLImageElement），不带资源 key，
 * 所以退化到 `src` 的文件名 —— 验收时能认出「这是 bg-warehouse.webp」就够。
 */
export function assetNameOf(image: unknown): string | undefined {
  if (typeof image !== 'object' || image === null) return undefined;
  const keyed = image as { key?: unknown; src?: unknown; currentSrc?: unknown };
  if (typeof keyed.key === 'string' && keyed.key.length > 0) return keyed.key;
  const src =
    typeof keyed.src === 'string' ? keyed.src : typeof keyed.currentSrc === 'string' ? keyed.currentSrc : '';
  if (src.length === 0) return undefined;
  const cut = (src.split('?')[0] ?? src).replace(/\\/g, '/');
  const parts = cut.split('/');
  return parts[parts.length - 1] ?? undefined;
}

/** 颜色值：渐变色对象序列化没意义，只记字符串色值。 */
export const colorOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** 数字参数取安全值：NaN 是 Canvas 静默不画的元凶，记录时按 0 处理但保留可读性。 */
export const numAt = (args: unknown[], i: number): number => {
  const v = args[i];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};
