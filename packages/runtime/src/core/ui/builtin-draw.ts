/**
 * 组件绘制的小工具（纯绘制）。
 *
 * 抽出来是因为按钮 / 徽章 / 格子都要「填充 + 居中文字 + 画图标」，
 * 复制三份会让字号算法在三处各自漂移（那是文字溢出的经典来源）。
 */

import type { Rect } from './contract';
import type { Ctx2D } from '../../platform/contract';
import type { ImageAsset } from '../assets/contract';

/** 填充一块矩形。 */
export const fillRect = (ctx: Ctx2D, r: Rect, color: string): void => {
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.w, r.h);
};

/**
 * 居中文字。
 *
 * 字号算法与游戏 `draw.ts` 的 `label()` **同一口径**：`min(h*0.36, w/字数)`。
 * 布局期 `estimateTextWidth` 也用这个字号估算 —— 测得下和画得下必须是一套算法。
 */
export const drawCenteredText = (
  ctx: Ctx2D, r: Rect, text: string, color: string, fontFamily: string,
): void => {
  if (text.length === 0) return;
  ctx.fillStyle = color;
  ctx.font = `${Math.max(1, Math.min(r.h * 0.36, r.w / Math.max(1, text.length)))}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.96);
};

/** 左对齐文字（图标右侧用），画完把对齐方式恢复成 center。 */
export const drawTextAt = (
  ctx: Ctx2D, r: Rect, text: string, font: number, x: number, color: string, fontFamily: string,
): void => {
  if (text.length === 0) return;
  ctx.fillStyle = color;
  ctx.font = `${font}px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, r.y + r.h / 2, r.w * 0.96);
  ctx.textAlign = 'center';
};

/** 画图标（源矩形从帧起算），返回是否画成功。 */
export const drawIcon = (ctx: Ctx2D, img: ImageAsset, x: number, y: number, size: number): void => {
  ctx.drawImage(img.native as CanvasImageSource, img.sx, img.sy, img.sw, img.sh, x, y, size, size);
};
