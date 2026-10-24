/**
 * 暖木纹皮肤：程序生成竖向木纹，不读磁盘图。
 * 牌面/图标仍可由游戏后补；没有图时按钮/面板走 theme 纯色，不会灰底蓝问号。
 */

import type { Ctx2D, Rect } from '../deps';
import type { SkinDefinition } from './types';

const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const paintBackground = (ctx: Ctx2D, viewport: { readonly width: number; readonly height: number }): void => {
  const { width: w, height: h } = viewport;
  const grad = ctx.createLinearGradient(0, 0, w * 0.15, h);
  grad.addColorStop(0, '#6b3f24');
  grad.addColorStop(0.45, '#8a5532');
  grad.addColorStop(1, '#5a321c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 竖向木纹：细线 + 轻微水平扰动
  const step = Math.max(3, Math.round(w / 64));
  for (let x = 0; x < w; x += step) {
    const wobble = (hash(x) - 0.5) * step * 0.8;
    const tone = hash(x * 1.7);
    ctx.strokeStyle = tone > 0.55 ? 'rgba(42,24,16,0.22)' : 'rgba(255,220,180,0.08)';
    ctx.lineWidth = 1 + hash(x * 3) * 1.5;
    ctx.beginPath();
    ctx.moveTo(x + wobble, 0);
    for (let y = 0; y <= h; y += 24) {
      ctx.lineTo(x + wobble + (hash(x + y) - 0.5) * 2.5, y);
    }
    ctx.stroke();
  }

  // 顶部暖光
  const glow = ctx.createLinearGradient(0, 0, 0, h * 0.35);
  glow.addColorStop(0, 'rgba(255, 210, 150, 0.18)');
  glow.addColorStop(1, 'rgba(255, 210, 150, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h * 0.35);
};

const panelOverlay = (ctx: Ctx2D, box: Rect): void => {
  const inset = 1;
  ctx.strokeStyle = 'rgba(255, 230, 200, 0.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x + inset, box.y + inset, box.w - inset * 2, box.h - inset * 2);
  const sheen = ctx.createLinearGradient(box.x, box.y, box.x, box.y + box.h * 0.4);
  sheen.addColorStop(0, 'rgba(255, 240, 210, 0.12)');
  sheen.addColorStop(1, 'rgba(255, 240, 210, 0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(box.x, box.y, box.w, box.h * 0.4);
};

export const WOOD_SKIN: SkinDefinition = {
  id: 'wood',
  label: '暖木纹',
  theme: {
    fontFamily: 'sans-serif',
    ink: '#2a1810',
    light: '#fff6e8',
    primary: '#c4783a',
    secondary: '#a05f2c',
    panel: '#7a4a2e',
    gridLine: '#5c351f',
    disabled: '#8a7464',
  },
  paint: { background: paintBackground, panelOverlay },
};
