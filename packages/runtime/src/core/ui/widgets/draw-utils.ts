/**
 * widgets 内部共用的小绘制工具（圆角路径 / 圆角填充）。
 *
 * 不新增组件契约：只是把「圆角矩形怎么画」收一处，progress / badge / avatar
 * 三处都要用；复制三份会让圆角半径钳制口径在三个组件里各自漂移。
 */

import type { Rect } from '../contract';
import type { Ctx2D } from '../../../platform/contract';

/** 圆角矩形路径（标准 canvas path API，三端都支持；半径自动钳到短边一半）。 */
export const roundPath = (ctx: Ctx2D, rect: Rect, radius: number): void => {
  const rad = Math.max(0, Math.min(radius, Math.min(rect.w, rect.h) / 2));
  const x = rect.x;
  const y = rect.y;
  const w = rect.w;
  const h = rect.h;
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
};

/** 填充圆角矩形；radius <= 0 或尺寸非法时退回 fillRect（路径 API 不必白跑）。 */
export const fillRoundRect = (ctx: Ctx2D, rect: Rect, radius: number, color: string): void => {
  if (!(rect.w > 0) || !(rect.h > 0)) return;
  ctx.fillStyle = color;
  if (!(radius > 0)) {
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    return;
  }
  roundPath(ctx, rect, radius);
  ctx.fill();
};
