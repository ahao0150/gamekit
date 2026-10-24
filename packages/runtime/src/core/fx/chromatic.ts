/**
 * 元素级特效：色差（T23）。
 *
 * 做法：内容画 **3 次**——先向右偏 `offset` 画一次、再向左偏 `offset` 画一次（都走
 * `lighter` 叠加），最后在原位画一次原色。视觉上是红青分色的「边缘拉伸残影」。
 *
 * 诚实说明：真正的 RGB 通道分离需要**离屏渲染**（把三份内容分别乘上红/青遮罩再合并），
 * Canvas 2D 在共享画布上做不到（`source-atop` 会污染已有像素）。所以这里是
 * 「偏移 + 加色叠加」的近似——在小游戏这种低分辨率画布上，观感已经够用，
 * 且零平台风险（不用 `ctx.filter`，webkit 的 filter 在小游戏上下文里不可靠）。
 */

import type { Ctx2D } from '../../platform/contract';
import type { Rect } from '../ui/contract';
import { clamp01, isDrawableRect, nonNegative } from './util';

/** 色差参数。 */
export interface ChromaticOptions {
  /** 两通道的像素偏移（正数；0 = 不叠加，只画原色） */
  readonly offset: number;
  /** 叠加层的透明度 0..1（默认 0.6） */
  readonly alpha?: number;
}

/**
 * 画内容 + 色差叠加。`draw` 会被调用 3 次（右偏 → 左偏 → 原色）。
 *
 * `offset=0` / `alpha=0` / 非法矩形 → 只画一次原色（不浪费两次绘制）。
 */
export const drawWithChromatic = (ctx: Ctx2D, rect: Rect, opts: ChromaticOptions, draw: () => void): void => {
  const offset = nonNegative(opts.offset, 0);
  const alpha = clamp01(opts.alpha ?? 0.6, 0.6);
  if (!(offset > 0) || !(alpha > 0) || !isDrawableRect(rect)) {
    draw();
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 右偏 + 左偏两份残影（alpha 各半，叠起来不至于糊成一团）
  ctx.save();
  ctx.translate(offset, 0);
  ctx.globalAlpha = alpha * 0.5;
  draw();
  ctx.restore();
  ctx.save();
  ctx.translate(-offset, 0);
  ctx.globalAlpha = alpha * 0.5;
  draw();
  ctx.restore();
  ctx.restore();

  // 原色最后画：主体清晰，残影只出现在边缘
  draw();
};
