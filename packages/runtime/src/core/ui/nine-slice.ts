/**
 * 九宫格 / 三段胶囊绘制（纯绘制，不读状态）。
 *
 * 为什么在 runtime 而不是游戏里：组件注册表（`components.ts`）的 `draw` 要用它，
 * 而 runtime 不许 import 游戏业务代码（AGENTS §7）。所以把它上移成通用绘制原语，
 * 游戏侧原来的 `src/app/nine-slice.ts` 变成 re-export，一行实现都不复制。
 *
 * 边距怎么算（九宫格最容易翻车的地方）：
 * - 素材是 **2x**：源边距 60（源像素）对应逻辑 30。
 * - **目标边距 = 源边距 × (目标宽 / 源宽)**。当目标尺寸等于 1x 逻辑尺寸时，
 *   这个比例正好是 1/2，目标边距 = 30 = 源边距 / 2 ✓
 * - 目标太小放不下两倍边距时（dw < 2×目标边距），把目标边距钳到 dw/2：
 *   宁可挤压，也不能让四角互相穿插、变形。
 * - 源图本身必须大于两倍边距，否则切片会越界 → 直接返回 false（调用方回落）。
 */

import type { ImageAsset } from '../assets/contract';
import type { Ctx2D } from '../../platform/contract';

/**
 * 画九宫格：四角固定、四边单向拉伸、中心双向拉伸，共 9 次 drawImage。
 *
 * @param border **源像素**边距（2x 图上量，例如面板 60、卡片 40）
 * @param sx/sy/sw/sh 源矩形（图集帧必须传帧矩形，不能假设从 0,0 开始）
 * @returns 是否画成功（false = 尺寸不合法，调用方应回落）
 */
export const drawNineSlice = (
  ctx: Ctx2D,
  img: ImageAsset,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  border: number,
): boolean => {
  if (border <= 0 || sw <= border * 2 || sh <= border * 2) return false;
  if (dw <= 0 || dh <= 0) return false;
  const scaleX = dw / sw;
  const scaleY = dh / sh;
  // 钳制：目标太小就把边距压到一半宽度，绝不允许四角互相穿插
  const bx = Math.min(border * scaleX, dw / 2);
  const by = Math.min(border * scaleY, dh / 2);
  const src = img.native as CanvasImageSource;
  const cut = (
    x: number, y: number, w: number, h: number,
    tx: number, ty: number, tw: number, th: number,
  ): void => {
    ctx.drawImage(src, x, y, w, h, tx, ty, tw, th);
  };
  // 四角：原尺寸，不拉伸
  cut(sx, sy, border, border, dx, dy, bx, by);
  cut(sx + sw - border, sy, border, border, dx + dw - bx, dy, bx, by);
  cut(sx, sy + sh - border, border, border, dx, dy + dh - by, bx, by);
  cut(sx + sw - border, sy + sh - border, border, border, dx + dw - bx, dy + dh - by, bx, by);
  // 四边：只沿一个方向拉伸
  cut(sx + border, sy, sw - border * 2, border, dx + bx, dy, dw - bx * 2, by);
  cut(sx + border, sy + sh - border, sw - border * 2, border, dx + bx, dy + dh - by, dw - bx * 2, by);
  cut(sx, sy + border, border, sh - border * 2, dx, dy + by, bx, dh - by * 2);
  cut(sx + sw - border, sy + border, border, sh - border * 2, dx + dw - bx, dy + by, bx, dh - by * 2);
  // 中心：双向拉伸
  cut(sx + border, sy + border, sw - border * 2, sh - border * 2, dx + bx, dy + by, dw - bx * 2, dh - by * 2);
  return true;
};

/** 胶囊素材规格（**源像素**）：宽 336、高 126，左帽 63 + 中段 8（可拉伸）+ 右帽 63。 */
export interface CapsuleSpec {
  readonly w: number;
  readonly h: number;
  readonly cap: number;
  readonly mid: number;
}

/** 默认胶囊规格（某个游戏的按钮素材）。 */
export const DEFAULT_CAPSULE: CapsuleSpec = { w: 336, h: 126, cap: 63, mid: 8 };

/**
 * 画三段胶囊：左帽 / 中段（横向拉伸）/ 右帽。
 *
 * 为什么不用九宫格：胶囊源图高 126、左帽 63，`sh <= border * 2` 恰好成立，
 * 九宫格会直接拒绝（纵向没有可切片的空间）。三段切法是这张图的正确切法。
 *
 * @param spec 素材规格；默认 {@link DEFAULT_CAPSULE}
 * @returns 是否画成功（false = 素材尺寸对不上 / 太窄，调用方应回落纯色）
 */
export const drawCapsule = (
  ctx: Ctx2D,
  img: ImageAsset,
  r: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  spec: CapsuleSpec = DEFAULT_CAPSULE,
): boolean => {
  if (img.width !== spec.w || img.height !== spec.h) return false;
  if (r.w <= 0 || r.h <= 0) return false;
  const scale = r.h / spec.h;
  const cap = spec.cap * scale;
  const mid = r.w - 2 * cap;
  if (mid <= 0) return false; // 比两个帽还窄，拼不出三段
  const src = img.native as CanvasImageSource;
  // 源矩形从帧矩形起算（图集里这张图不在 (0,0)）
  const x0 = img.sx;
  const y0 = img.sy;
  ctx.drawImage(src, x0, y0, spec.cap, spec.h, r.x, r.y, cap, r.h);
  ctx.drawImage(src, x0 + spec.cap, y0, spec.mid, spec.h, r.x + cap, r.y, mid, r.h);
  ctx.drawImage(src, x0 + spec.w - spec.cap, y0, spec.cap, spec.h, r.x + cap + mid, r.y, cap, r.h);
  return true;
};
