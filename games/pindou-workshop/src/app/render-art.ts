/**
 * 美术层：**所有「有图 / 没图」的视觉分支都在这个文件里**，`render.ts` 只做屏级编排。
 *
 * 铁律（T68 死资源的教训反过来用）：每个元素都有两条路 ——
 * 有图走贴图，**没图必须回落到「接线前那套画法的等价物」**，不是空白。
 * 缺图是常态（美术分批到货、某端加载失败），回退分支就是回归保障。
 */

import { HILIGHT, STROKE } from './board-geom';
import { mixColor } from './anim';
import { BEAD_KEYS } from './assets';
import { CELL_TINTS } from './levels';
import { HUD_BORDER, PANEL_BORDER, drawBgCover, drawIconImg, drawImg, drawPanelImg } from './draw-img';
import {
  BEAN_HILIGHT,
  BEAN_STROKE,
  BG,
  FALLBACK_TINT,
  GROOVE_FILL,
  GROOVE_STROKE,
  RIM_DARK,
} from './skin';
import type { AssetService, Ctx2D, Rect } from './deps';

/** 色块内缩（回退画法的圆角块留白） */
const BEAN_INSET = 2;

export const roundRect = (ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const tintOf = (colorIdx: number): string => CELL_TINTS[colorIdx] ?? FALLBACK_TINT;

/** 回退色块：圆角矩形 + 描边 + 高光（接素材之前的那套画法，逐像素保留） */
export const beanFallback = (ctx: Ctx2D, x: number, y: number, s: number, colorIdx: number): void => {
  ctx.fillStyle = tintOf(colorIdx);
  roundRect(ctx, x + BEAN_INSET, y + BEAN_INSET, s - BEAN_INSET * 2, s - BEAN_INSET * 2, Math.max(2, s * 0.22));
  ctx.fill();
  ctx.lineWidth = STROKE;
  ctx.strokeStyle = BEAN_STROKE;
  ctx.stroke();
  ctx.fillStyle = BEAN_HILIGHT;
  roundRect(ctx, x + s * HILIGHT, y + s * HILIGHT * 0.8, s * 0.3, s * 0.18, s * 0.08);
  ctx.fill();
};

/**
 * 珠子：有贴图就用贴图（64×64，视觉直径 58，自带 1px 内描边），缺图回落 `beanFallback`。
 * 贴图按整格缩放：珠子四周的 3px 透明边正好变成相邻珠子的间隙。
 */
export const drawBead = (ctx: Ctx2D, x: number, y: number, s: number, colorIdx: number, art: AssetService | null): void => {
  const key = BEAD_KEYS[colorIdx];
  const img = key === undefined ? null : art?.get(key) ?? null;
  if (img === null) {
    beanFallback(ctx, x, y, s, colorIdx);
    return;
  }
  drawImg(ctx, img, x, y, s, s);
};

/**
 * 未归位目标格：凹槽 + 右上角指示点（浅底上「tint × 0.16 淡显」只有 ≈1.15:1，见方案 §2.3）。
 *
 * 指示点用**小珠子贴图**（0.42 格边）：与池子里的珠子同一套材质，视觉统一；
 * 贴图缺失时回落纯色圆点（0.2 格边 + rim），8px 的点在 320 屏仍然可辨。
 */
export const drawGrooveCell = (
  ctx: Ctx2D,
  x: number,
  y: number,
  s: number,
  colorIdx: number,
  art: AssetService | null,
): void => {
  const w = s - 2;
  ctx.fillStyle = GROOVE_FILL;
  ctx.fillRect(x, y, w, w);
  ctx.strokeStyle = GROOVE_STROKE;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, w - 1.5);

  const key = BEAD_KEYS[colorIdx];
  const img = key === undefined ? null : art?.get(key) ?? null;
  if (img !== null) {
    const d = w * 0.42;
    drawImg(ctx, img, x + w - d - 1, y + 1, d, d);
    return;
  }
  const d = Math.max(6, Math.min(10, Math.round(w * 0.2)));
  const cx = x + w - 3 - d / 2;
  const cy = y + 3 + d / 2;
  const tint = tintOf(colorIdx);
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.fillStyle = tint;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = mixColor(tint, RIM_DARK, 0.5);
  ctx.stroke();
};

/** 全屏背景：有图 cover（1/3 缩放），缺图回落浅薄荷底 */
export const drawBackground = (
  ctx: Ctx2D,
  vp: { readonly width: number; readonly height: number },
  art: AssetService | null,
): void => {
  const img = art?.get('bg/acrylic-desk') ?? null;
  if (img !== null) {
    drawBgCover(ctx, img, vp);
    return;
  }
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, vp.width, vp.height);
};

/** HUD / 对话框底板：九宫格图；缺图返回 false 让调用方用 `.ui` 的实心底 */
export const drawPanelBg = (ctx: Ctx2D, r: Rect, art: AssetService | null, key = 'ui/panel'): boolean =>
  drawPanelImg(ctx, r, art, key, key === 'ui/hud-bar' ? HUD_BORDER : PANEL_BORDER);

/** 图标：镊子 / 熨烫板 / 温度计 / 时钟，缺失返回 false（调用方画文字或不画） */
export const drawIcon = (ctx: Ctx2D, key: string, r: Rect, art: AssetService | null): boolean =>
  drawIconImg(ctx, key, r, art);
