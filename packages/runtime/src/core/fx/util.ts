/**
 * 特效库的小工具（T23）：参数钳制 + 颜色加透明度 + 矩形可用性。
 *
 * 为什么集中一处：7 个特效每个都要「alpha 钳到 0..1、负数不画、坏参数不崩」——
 * 各写一遍必然出现「这个特效钳了、那个漏了」。钳制口径必须只有一份。
 */

import type { Rect } from '../ui/contract';

/** 1% 的浮点容差：`progress` 这类值经过多次运算后 0.9999999 应该当 1。 */
const EPSILON = 1e-6;

/** 钳到 [0, 1]；NaN / Infinity 回落 fallback。 */
export const clamp01 = (value: number, fallback = 1): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, 0), 1);
};

/** 钳到 [0, ∞)；NaN 回落 fallback。 */
export const nonNegative = (value: number, fallback = 0): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
};

/** 进度是否已经到底（容忍浮点误差）。 */
export const isComplete = (progress: number): boolean => progress >= 1 - EPSILON;

/** 进度是否还是 0（容忍浮点误差）。 */
export const isIdle = (progress: number): boolean => progress <= EPSILON;

/** 矩形可画（宽高都 > 0），坏尺寸不画负矩形。 */
export const isDrawableRect = (rect: Rect): boolean => rect.w > 0 && rect.h > 0;

/** 视口可画。 */
export const isDrawableViewport = (viewport: { readonly width: number; readonly height: number }): boolean =>
  viewport.width > 0 && viewport.height > 0;

/**
 * 给颜色加透明度：支持 `#rgb` / `#rrggbb` / `rgb()` / `rgba()`。
 *
 * 为什么需要：径向渐变的透明度必须靠颜色本身（`addColorStop(1, 'transparent')` 会
 * 从黑渐变，边缘发灰），所以得把十六进制/`rgb()` 转成带 alpha 的 `rgba()`。
 * 其余格式（主题里偶尔会有 `currentColor` 之类）原样返回，由 `globalAlpha` 兜底。
 */
export const withAlpha = (color: string, alpha: number): string => {
  const raw = color.trim();
  const a = Math.min(Math.max(Number.isFinite(alpha) ? alpha : 0, 0), 1);
  if (raw.startsWith('#')) {
    const hex = raw.slice(1);
    const full = hex.length === 3 ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}` : hex;
    if (full.length !== 6) return raw;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    if (![r, g, b].every((v) => Number.isFinite(v))) return raw;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (raw.startsWith('rgb(')) return `rgba(${raw.slice(4, -1)}, ${a})`;
  if (raw.startsWith('rgba(')) {
    const parts = raw.slice(5, -1).split(',').slice(0, 3).join(',');
    return `rgba(${parts}, ${a})`;
  }
  return raw;
};

/** 确定性伪随机（0..1）：同一个 seed 永远同一个值，特效可复现、可测、不碰 Math.random。 */
export const hash01 = (seed: number): number => {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};
