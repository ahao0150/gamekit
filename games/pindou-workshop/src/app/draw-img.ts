/**
 * 图片绘制原语（游戏侧胶水层）：把 `ImageAsset` 画到 canvas 上，**图集帧与单图同一套代码**。
 *
 * 为什么必须走这里：`ImageAsset` 的帧矩形（`sx/sy/sw/sh`）在单图时是 `0/0/w/h`，
 * 在图集帧时是图集里的偏移。只写 5 参 `drawImage` 的代码在接图集那天必坏，所以统一 9 参。
 *
 * 这一层只管「画」，不管「没有图怎么办」——回退画法在 `render-art.ts`。
 */

import { drawNineSlice } from './deps';
import type { AssetService, Ctx2D, ImageAsset, Rect } from './deps';

/** 面板九宫格的**源像素**边距：实测 `panel.png`(240×240) 圆角边界在 24–29，取 32 安全。 */
export const PANEL_BORDER = 32;
/** HUD 条九宫格的源像素边距：实测 `hud-bar.png`(780×152) 圆角 31–35，取 40 安全。 */
export const HUD_BORDER = 40;

const asSource = (img: ImageAsset): CanvasImageSource => img.native as CanvasImageSource;

/** 9 参 drawImage：帧矩形起画，缩放到目标矩形（不做等比/裁切）。 */
export const drawImg = (ctx: Ctx2D, img: ImageAsset, dx: number, dy: number, dw: number, dh: number): void => {
  ctx.drawImage(asSource(img), img.sx, img.sy, img.sw, img.sh, dx, dy, dw, dh);
};

/**
 * 背景 cover：等比铺满视口、居中裁切（不要拉伸变形）。
 * 源图 1170×2532 正好是 390×844 的 3 倍，正常竖屏就是无裁切的 1/3 缩放。
 */
export const drawBgCover = (ctx: Ctx2D, img: ImageAsset, vp: { readonly width: number; readonly height: number }): void => {
  const s = Math.max(vp.width / img.width, vp.height / img.height);
  const sw = vp.width / s;
  const sh = vp.height / s;
  ctx.drawImage(
    asSource(img),
    img.sx + (img.sw - sw) / 2,
    img.sy + (img.sh - sh) / 2,
    sw,
    sh,
    0,
    0,
    vp.width,
    vp.height,
  );
};

/** 九宫格面板：图缺失或源图放不下两倍边距 → false（调用方回落主题实心）。 */
export const drawPanelImg = (ctx: Ctx2D, r: Rect, art: AssetService | null, key: string, border: number): boolean => {
  const img = art?.get(key) ?? null;
  if (img === null) return false;
  return drawNineSlice(ctx, img, img.sx, img.sy, img.sw, img.sh, r.x, r.y, r.w, r.h, border);
};

/** 图标 contain：按 min 比例缩放到矩形内并居中（96×96 的图按 32–48 显示）。 */
export const drawIconImg = (ctx: Ctx2D, key: string, r: Rect, art: AssetService | null): boolean => {
  const img = art?.get(key) ?? null;
  if (img === null) return false;
  const s = Math.min(r.w / img.width, r.h / img.height);
  const w = img.width * s;
  const h = img.height * s;
  drawImg(ctx, img, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
  return true;
};
