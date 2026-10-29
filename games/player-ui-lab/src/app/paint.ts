/**
 * 绘制原语：圆角路径、文字、图标字形。
 *
 * 为什么单独一层：小游戏宿主的基础库版本不一致，`ctx.roundRect` / `ctx.letterSpacing`
 * 不一定有。这里手写路径与字距，**不依赖任何可选 API**，三端表现一致。
 * 所有颜色从 `PlayerTheme` 传入，本文件不出现设计稿色值。
 */

import type { Ctx2D, Rect } from './deps';
import type { PlayerTheme } from './theme';

export interface TextOptions {
  readonly size: number;
  readonly color: string;
  readonly align?: 'left' | 'center' | 'right';
  readonly letterSpacing?: number;
  readonly weight?: number;
  readonly fontFamily?: string;
}

/** `#rrggbb` + alpha → `rgba(...)`。非 6 位十六进制原样返回（调用方自己保证合法）。 */
export const rgba = (hex: string, alpha: number): string => {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (match === null) return hex;
  const value = Number.parseInt(match[1] ?? '000000', 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

/** 圆角矩形路径（半径自动钳到短边一半）：不依赖 `ctx.roundRect`。 */
export const roundedRectPath = (ctx: Ctx2D, rect: Rect, radius: number): void => {
  const r = Math.max(0, Math.min(radius, rect.w / 2, rect.h / 2));
  const { x, y, w, h } = rect;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

export const fillRounded = (ctx: Ctx2D, rect: Rect, radius: number, fill: string | CanvasGradient): void => {
  roundedRectPath(ctx, rect, radius);
  ctx.fillStyle = fill;
  ctx.fill();
};

export const strokeRounded = (
  ctx: Ctx2D,
  rect: Rect,
  radius: number,
  stroke: string,
  lineWidth = 1,
): void => {
  roundedRectPath(ctx, rect, radius);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
};

/** 单行文字：垂直居中放在 rect 里，水平按 align 对齐（rect 就是对齐基准）。 */
export const drawText = (ctx: Ctx2D, rect: Rect, text: string, options: TextOptions): void => {
  const {
    size, color, align = 'left', letterSpacing = 0, weight = 400, fontFamily = 'sans-serif',
  } = options;
  ctx.font = `${weight} ${size}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  const cy = rect.y + rect.h / 2;
  if (letterSpacing === 0) {
    ctx.textAlign = align;
    const x = align === 'left' ? rect.x : align === 'center' ? rect.x + rect.w / 2 : rect.x + rect.w;
    ctx.fillText(text, x, cy);
    ctx.textAlign = 'left';
    return;
  }
  // 有字距：逐字测量后整体居中 / 右对齐（Canvas 的 letterSpacing 不是所有宿主都有）
  ctx.textAlign = 'left';
  const widths: number[] = [];
  let total = 0;
  for (const ch of text) {
    const w = ctx.measureText(ch).width;
    widths.push(w);
    total += w + letterSpacing;
  }
  total -= letterSpacing;
  let cursor = align === 'center' ? rect.x + (rect.w - total) / 2 : align === 'right' ? rect.x + rect.w - total : rect.x;
  let index = 0;
  for (const ch of text) {
    ctx.fillText(ch, cursor, cy);
    cursor += (widths[index] ?? 0) + letterSpacing;
    index += 1;
  }
};

export type Glyph = 'back' | 'more' | 'prev' | 'next' | 'repeat' | 'like' | 'list';

/**
 * 在 **44×44 基准坐标系里**画图标。调用方负责 `translate(box) + scale(k)`，
 * 并把 `lineWidth` 除以 k —— 设计稿的描边是绝对 2px，不随按钮放大。
 */
export const drawGlyph = (ctx: Ctx2D, glyph: Glyph, theme: PlayerTheme, scale = 1): void => {
  const stroke = Math.max(0.5, 2 / scale);
  const fill = (color: string): void => {
    ctx.fillStyle = color;
    ctx.fill();
  };
  const line = (color: string, cap: CanvasLineCap = 'round'): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = stroke;
    ctx.lineCap = cap;
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  switch (glyph) {
    case 'back':
      ctx.beginPath();
      ctx.moveTo(26, 15);
      ctx.lineTo(17, 22);
      ctx.lineTo(26, 29);
      line(theme.light);
      break;
    case 'more':
      for (const cy of [15, 22, 29]) {
        ctx.beginPath();
        ctx.arc(22, cy, 2, 0, Math.PI * 2);
        fill(theme.gridLine);
      }
      break;
    case 'prev':
      ctx.beginPath();
      ctx.moveTo(37, 15);
      ctx.lineTo(21, 26);
      ctx.lineTo(37, 37);
      ctx.closePath();
      fill(theme.gridLine);
      roundedRectPath(ctx, { x: 16, y: 16, w: 2.5, h: 20 }, 1.2);
      fill(theme.gridLine);
      break;
    case 'next':
      ctx.beginPath();
      ctx.moveTo(15, 15);
      ctx.lineTo(31, 26);
      ctx.lineTo(15, 37);
      ctx.closePath();
      fill(theme.gridLine);
      roundedRectPath(ctx, { x: 33.5, y: 16, w: 2.5, h: 20 }, 1.2);
      fill(theme.gridLine);
      break;
    case 'repeat':
      ctx.beginPath();
      ctx.moveTo(15, 19);
      ctx.lineTo(26, 19);
      ctx.quadraticCurveTo(32, 19, 32, 25);
      ctx.lineTo(32, 28);
      line(theme.gridLine);
      ctx.beginPath();
      ctx.moveTo(29, 25);
      ctx.lineTo(18, 25);
      ctx.quadraticCurveTo(12, 25, 12, 19);
      ctx.lineTo(12, 16);
      line(theme.gridLine);
      ctx.beginPath();
      ctx.moveTo(32, 30);
      ctx.lineTo(35, 25);
      ctx.lineTo(29, 25);
      ctx.closePath();
      fill(theme.secondary);
      ctx.beginPath();
      ctx.moveTo(12, 14);
      ctx.lineTo(9, 19);
      ctx.lineTo(15, 19);
      ctx.closePath();
      fill(theme.secondary);
      break;
    case 'like':
      ctx.beginPath();
      ctx.moveTo(22, 33);
      ctx.bezierCurveTo(22, 33, 11, 26.5, 11, 19.5);
      ctx.bezierCurveTo(11, 15.9, 13.8, 13.5, 16.8, 13.5);
      ctx.bezierCurveTo(19, 13.5, 21, 14.8, 22, 16.6);
      ctx.bezierCurveTo(23, 14.8, 25, 13.5, 27.2, 13.5);
      ctx.bezierCurveTo(30.2, 13.5, 33, 15.9, 33, 19.5);
      ctx.bezierCurveTo(33, 26.5, 22, 33, 22, 33);
      ctx.closePath();
      fill(theme.danger);
      break;
    case 'list':
      for (const [y, w] of [[16, 14], [22, 14], [28, 10]] as const) {
        ctx.beginPath();
        ctx.moveTo(15, y);
        ctx.lineTo(15 + w, y);
        line(theme.gridLine, 'round');
      }
      for (const cy of [16, 22]) {
        ctx.beginPath();
        ctx.arc(33, cy, 1.6, 0, Math.PI * 2);
        fill(theme.secondary);
      }
      break;
  }
};
