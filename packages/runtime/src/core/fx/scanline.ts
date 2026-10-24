/**
 * 全屏特效：扫描线 / CRT 条纹（T23）。
 *
 * 从 y=0 开始按 `gap + thickness` 的节拍画半透明横条：条纹数量
 * `≈ ceil(viewport.height / (gap + thickness))`（与验收口径一致）。
 *
 * 参数钳制：`thickness` 不超过 `gap`（否则条纹会连成一片）、`alpha<=0` 不画、
 * 最后一次条纹按剩余高度裁（不画出视口外）。
 */

import type { Ctx2D } from '../../platform/contract';
import { clamp01, isDrawableViewport, nonNegative } from './util';

/** 扫描线参数。 */
export interface ScanlineOptions {
  /** 条纹间距（像素，>0） */
  readonly gap: number;
  /** 条纹厚度（像素，0..gap） */
  readonly thickness: number;
  /** 透明度 0..1 */
  readonly alpha: number;
  /** 条纹颜色（默认纯黑） */
  readonly color?: string;
}

export const drawScanline = (
  ctx: Ctx2D,
  viewport: { readonly width: number; readonly height: number },
  opts: ScanlineOptions,
): void => {
  const gap = nonNegative(opts.gap, 0);
  const alpha = clamp01(opts.alpha, 0);
  // 间距 <= 0 是非法参数（否则条纹会连成整屏填充）：不画
  if (!(gap > 0) || !(alpha > 0) || !isDrawableViewport(viewport)) return;
  const thickness = Math.min(nonNegative(opts.thickness, 0), gap);
  if (!(thickness > 0)) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = opts.color ?? '#000000';
  const pitch = gap + thickness;
  for (let y = 0; y < viewport.height; y += pitch) {
    const height = Math.min(thickness, viewport.height - y);
    ctx.fillRect(0, y, viewport.width, height);
  }
  ctx.restore();
};
