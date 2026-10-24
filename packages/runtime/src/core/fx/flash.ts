/**
 * 全屏特效：闪白 / 闪色（T23）。
 *
 * 最简单也最常用的「受击 / 抽卡 / 通关」反馈：整屏铺一层纯色，alpha 由游戏 tween。
 * 参数全部钳制：`alpha<=0` 不画（不留空转的 save/restore）。
 */

import type { Ctx2D } from '../../platform/contract';
import { clamp01, isDrawableViewport } from './util';

/** 闪屏参数。 */
export interface FlashOptions {
  /** 颜色（默认纯白） */
  readonly color?: string;
  /** 透明度 0..1（0 = 不画） */
  readonly alpha: number;
}

export const drawFlash = (
  ctx: Ctx2D,
  viewport: { readonly width: number; readonly height: number },
  opts: FlashOptions,
): void => {
  const alpha = clamp01(opts.alpha, 0);
  if (!(alpha > 0) || !isDrawableViewport(viewport)) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = opts.color ?? '#ffffff';
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  ctx.restore();
};
