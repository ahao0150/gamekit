/**
 * 清爽玻璃皮肤：冷色渐变 + 高光边，程序绘制，不读磁盘图。
 */

import type { Ctx2D, Rect } from '../deps';
import type { SkinDefinition } from './types';

const paintBackground = (ctx: Ctx2D, viewport: { readonly width: number; readonly height: number }): void => {
  const { width: w, height: h } = viewport;
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#1a2f3d');
  grad.addColorStop(0.5, '#243f52');
  grad.addColorStop(1, '#152833');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 柔光斑
  const spots: ReadonlyArray<readonly [number, number, number]> = [
    [0.2, 0.15, 0.35],
    [0.75, 0.35, 0.28],
    [0.45, 0.7, 0.4],
  ];
  for (const [rx, ry, rr] of spots) {
    const cx = w * rx;
    const cy = h * ry;
    const r = Math.min(w, h) * rr;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(140, 200, 230, 0.22)');
    g.addColorStop(1, 'rgba(140, 200, 230, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // 顶部玻璃高光带
  const band = ctx.createLinearGradient(0, 0, 0, h * 0.12);
  band.addColorStop(0, 'rgba(220, 240, 255, 0.28)');
  band.addColorStop(1, 'rgba(220, 240, 255, 0)');
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, w, h * 0.12);
};

const panelOverlay = (ctx: Ctx2D, box: Rect): void => {
  ctx.fillStyle = 'rgba(200, 230, 255, 0.08)';
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = 'rgba(220, 240, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
  // 内顶高光
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.fillRect(box.x + 2, box.y + 2, box.w - 4, Math.max(2, box.h * 0.08));
};

export const GLASS_SKIN: SkinDefinition = {
  id: 'glass',
  label: '清爽玻璃',
  theme: {
    fontFamily: 'sans-serif',
    ink: '#0e1a24',
    light: '#f0f7fc',
    primary: '#4f9fd4',
    secondary: '#3a7fa8',
    panel: '#2f5166',
    gridLine: '#1e3848',
    disabled: '#6a7f8c',
  },
  paint: { background: paintBackground, panelOverlay },
};
