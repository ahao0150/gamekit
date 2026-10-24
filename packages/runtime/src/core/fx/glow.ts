/**
 * 元素级特效：发光（T23）。
 *
 * 做法：先用 `lighter` 混合叠 `layers` 层径向渐变（外圈透明、中心亮），再画内容——
 * 内容压在光晕上，所以「发光」不会盖掉内容本身。
 *
 * 为什么用 Canvas 2D 多层渐变而不是 `ctx.shadowBlur`：阴影模糊在部分小游戏厂商的
 * 2D 上下文里性能/效果都不稳（有的实现每次 shadow 都走软件模糊），多层渐变是三端一致的。
 */

import type { Ctx2D } from '../../platform/contract';
import type { Rect } from '../ui/contract';
import { clamp01, isDrawableRect, nonNegative, withAlpha } from './util';

/** 发光参数。 */
export interface GlowOptions {
  /** 光晕颜色（`#rrggbb` / `rgb()`） */
  readonly color: string;
  /** 总亮度 0..1（默认 1）；0 = 不画光晕，只画内容 */
  readonly intensity?: number;
  /** 渐变层数（默认 3），越多边缘越柔 */
  readonly layers?: number;
  /** 光晕外扩像素（默认 0），让内容边缘外的光也有地方扩散 */
  readonly blur?: number;
}

/**
 * 画内容 + 光晕。`draw` 是内容回调（特效负责前后处理）。
 *
 * 参数全部钳制：`intensity=0` / `layers=0` / 非法矩形 → 跳过光晕但仍画内容（不吞内容）。
 */
export const drawWithGlow = (ctx: Ctx2D, rect: Rect, opts: GlowOptions, draw: () => void): void => {
  const intensity = clamp01(opts.intensity ?? 1);
  const layers = Math.floor(nonNegative(opts.layers ?? 3, 3));
  const blur = nonNegative(opts.blur ?? 0);
  if (isDrawableRect(rect) && intensity > 0 && layers > 0) {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const maxRadius = Math.max(rect.w, rect.h) / 2 + blur;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < layers; i += 1) {
      // 每层半径递增、亮度均分：叠起来中心最亮、边缘平滑衰减
      const radius = Math.max(1, (maxRadius * (i + 1)) / layers);
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, withAlpha(opts.color, intensity / layers));
      gradient.addColorStop(1, withAlpha(opts.color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(rect.x - blur, rect.y - blur, rect.w + blur * 2, rect.h + blur * 2);
    }
    ctx.restore();
  }
  draw();
};
