/**
 * 全屏特效：暗角（T23）。
 *
 * 一次全屏径向渐变：中心透明、四角最暗——比「四角各画一个渐变」省三次整屏填充。
 * 内圈半径取短边的 45%，保证中间亮区够大（太小会像「隧道」）。
 */

import type { Ctx2D } from '../../platform/contract';
import { clamp01, isDrawableViewport, withAlpha } from './util';

/** 暗角参数。 */
export interface VignetteOptions {
  /** 四角暗度 0..1（0 = 不画） */
  readonly strength: number;
  /** 暗角颜色（默认纯黑） */
  readonly color?: string;
}

export const drawVignette = (
  ctx: Ctx2D,
  viewport: { readonly width: number; readonly height: number },
  opts: VignetteOptions,
): void => {
  const strength = clamp01(opts.strength, 0);
  if (!(strength > 0) || !isDrawableViewport(viewport)) return;
  const color = opts.color ?? '#000000';
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const inner = Math.min(cx, cy) * 0.45;
  const outer = Math.hypot(cx, cy);
  const gradient = ctx.createRadialGradient(cx, cy, inner, cx, cy, Math.max(inner + 1, outer));
  gradient.addColorStop(0, withAlpha(color, 0));
  gradient.addColorStop(1, withAlpha(color, strength));
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  ctx.restore();
};
