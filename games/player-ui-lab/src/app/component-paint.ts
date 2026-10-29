/**
 * 复合组件的绘制件（与 `custom-components.ts` 的声明分开，单文件不超 300 行）。
 *
 * 纪律与组件声明一致：**几何全部来自 `parts.ts`**、**颜色全部来自 `theme`**、
 * `ctx.save()` / `restore()` 成对。这里只画，不做任何判定。
 */

import type { Ctx2D, DrawDeps, Rect, StyleProps } from './deps';
import {
  albumCoverPartsOf, iconButtonPartsOf, playButtonPartsOf, progressBarPartsOf,
  TRACK_H,
} from './parts';
import { drawGlyph, drawText, fillRounded, rgba, strokeRounded } from './paint';
import type { Glyph } from './paint';
import { playerTheme } from './theme';
import type { PlayerTheme } from './theme';

/** 方章用楷体（设计稿 `.seal`）；字体不是颜色，允许留在这里。 */
const SEAL_FONT = '"KaiTi", "STKaiti", "SimSun", serif';

export const readNumber = (props: StyleProps, key: string, fallback: number): number => {
  const raw = (props as Readonly<Record<string, unknown>>)[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
};

export const readString = (props: StyleProps, key: string, fallback: string): string => {
  const raw = (props as Readonly<Record<string, unknown>>)[key];
  return typeof raw === 'string' ? raw : fallback;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** 玻璃圆盘：垂直渐变面 + 1px 描边（设计稿 `glassSoft` + `rgba(255,250,240,0.10)`）。 */
const drawGlassDisc = (ctx: Ctx2D, box: Rect, theme: PlayerTheme): void => {
  const parts = iconButtonPartsOf(box);
  const cx = parts.disc.x + parts.disc.w / 2;
  const cy = parts.disc.y + parts.disc.h / 2;
  const radius = Math.min(parts.disc.w, parts.disc.h) / 2;
  const grad = ctx.createLinearGradient(box.x, box.y, box.x, box.y + box.h);
  grad.addColorStop(0, rgba(theme.light, 0.13));
  grad.addColorStop(1, rgba(theme.light, 0.06));
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = rgba(theme.light, 0.1);
  ctx.lineWidth = 1;
  ctx.stroke();
};

export const drawIconButton = (ctx: Ctx2D, box: Rect, glyph: Glyph, deps: DrawDeps): void => {
  const theme = playerTheme(deps.theme);
  drawGlassDisc(ctx, box, theme);
  const scale = box.w / 44;
  ctx.save();
  ctx.translate(box.x, box.y);
  ctx.scale(scale, scale);
  drawGlyph(ctx, glyph, theme, scale);
  ctx.restore();
};

/** 播放键：金色细环 + 中心提亮渐变盘 + 内侧高光环 + 三角（设计稿 playButton）。 */
export const drawPlayButton = (ctx: Ctx2D, box: Rect, deps: DrawDeps): void => {
  const theme = playerTheme(deps.theme);
  const parts = playButtonPartsOf(box);
  ctx.save();
  ctx.beginPath();
  ctx.arc(parts.ring.cx, parts.ring.cy, parts.ring.r, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(theme.secondary, 0.45);
  ctx.lineWidth = 1;
  ctx.stroke();

  const grad = ctx.createRadialGradient(
    parts.disc.cx - 7, parts.disc.cy - 13, 0,
    parts.disc.cx, parts.disc.cy, parts.disc.r,
  );
  grad.addColorStop(0, theme.light);
  grad.addColorStop(0.42, theme.gridLine);
  grad.addColorStop(1, theme.secondary);
  ctx.beginPath();
  ctx.arc(parts.disc.cx, parts.disc.cy, parts.disc.r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(parts.gloss.cx, parts.gloss.cy, parts.gloss.r, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(theme.light, 0.5);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const [a, b, c] = parts.triangle;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.closePath();
  ctx.fillStyle = theme.ink;
  ctx.fill();
  ctx.restore();
};

/** 封面：斜向渐变 + 金色光斑 + 三条声波 + 斜向高光 + 内描边 + 方章（设计稿 albumCover）。 */
export const drawAlbumCover = (ctx: Ctx2D, box: Rect, deps: DrawDeps): void => {
  const theme = playerTheme(deps.theme);
  const parts = albumCoverPartsOf(box);
  const { cover, scale } = parts;
  ctx.save();

  const coverGrad = ctx.createLinearGradient(cover.x, cover.y, cover.x + cover.w, cover.y + cover.h);
  coverGrad.addColorStop(0, theme.coverHi);
  coverGrad.addColorStop(0.46, theme.coverMid);
  coverGrad.addColorStop(1, theme.bgSoft);
  fillRounded(ctx, cover, 28 * scale, coverGrad);

  // 金色光斑（严格留在框内：先裁切再画，避免溢出到相邻元素）
  ctx.save();
  ctx.beginPath();
  ctx.arc(cover.x + cover.w / 2, cover.y + cover.h / 2, cover.w / 2, 0, Math.PI * 2);
  ctx.clip();
  const glowX = cover.x + 234 * scale;
  const glowY = cover.y + 80 * scale;
  const glowR = 76 * scale;
  const glow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, glowR);
  glow.addColorStop(0, rgba(theme.secondary, 0.62));
  glow.addColorStop(1, rgba(theme.secondary, 0));
  ctx.beginPath();
  ctx.arc(glowX, glowY, glowR, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.restore();

  // 三条同心弧（抽象声波）
  ctx.save();
  ctx.strokeStyle = rgba(theme.secondary, 0.75);
  ctx.lineWidth = 2.5 * scale;
  ctx.lineCap = 'round';
  const waves: readonly [number, number][] = [[232, 0.75], [252, 0.9], [272, 0.45]];
  for (const [offsetY, alpha] of waves) {
    const y = cover.y + offsetY * scale;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(cover.x + 64 * scale, y);
    ctx.quadraticCurveTo(cover.x + 94 * scale, y - 46 * scale, cover.x + 124 * scale, y);
    ctx.quadraticCurveTo(cover.x + 154 * scale, y + 46 * scale, cover.x + 184 * scale, y);
    ctx.stroke();
  }
  ctx.restore();

  // 斜向高光
  const gloss = ctx.createLinearGradient(
    parts.gloss.x, parts.gloss.y,
    parts.gloss.x + parts.gloss.w * 0.3, parts.gloss.y + parts.gloss.h,
  );
  gloss.addColorStop(0, rgba(theme.light, 0.2));
  gloss.addColorStop(0.62, rgba(theme.light, 0.04));
  gloss.addColorStop(1, rgba(theme.light, 0));
  fillRounded(ctx, parts.gloss, 28 * scale, gloss);

  // 内描边：让封面从深底上「立」起来
  strokeRounded(
    ctx,
    { x: cover.x + 0.5, y: cover.y + 0.5, w: cover.w - 1, h: cover.h - 1 },
    27.5 * scale, rgba(theme.light, 0.18), 1,
  );

  // 方章
  fillRounded(ctx, parts.seal, 5 * scale, theme.seal);
  strokeRounded(
    ctx,
    {
      x: parts.seal.x + scale, y: parts.seal.y + scale,
      w: parts.seal.w - 2 * scale, h: parts.seal.h - 2 * scale,
    },
    4 * scale, rgba(theme.light, 0.28), 1,
  );
  drawText(ctx, parts.seal, '乐', {
    size: 20 * scale, color: theme.light, align: 'center', fontFamily: SEAL_FONT,
  });

  ctx.restore();
};

/** 进度条：轨道 + 已播 + 手柄 + 两端时间（设计稿 progressBar 的 4 个内部件）。 */
export const drawProgressBar = (ctx: Ctx2D, box: Rect, props: StyleProps, deps: DrawDeps): void => {
  const theme = playerTheme(deps.theme);
  const parts = progressBarPartsOf(box);
  const progress = clamp01(readNumber(props, 'progress', 0.35));
  ctx.save();

  fillRounded(ctx, parts.track, TRACK_H / 2, rgba(theme.light, 0.14));

  const filledW = parts.track.w * progress;
  if (filledW > 0.5) {
    const grad = ctx.createLinearGradient(parts.track.x, 0, parts.track.x + parts.track.w, 0);
    grad.addColorStop(0, theme.jade);
    grad.addColorStop(0.72, theme.primary);
    grad.addColorStop(1, theme.secondary);
    fillRounded(ctx, { x: parts.track.x, y: parts.track.y, w: filledW, h: parts.track.h }, TRACK_H / 2, grad);
  }

  const knobX = parts.track.x + filledW;
  const knobY = parts.track.y + parts.track.h / 2;
  ctx.beginPath();
  ctx.arc(knobX, knobY, 8, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(theme.secondary, 0.55);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(knobX, knobY, 6, 0, Math.PI * 2);
  ctx.fillStyle = theme.light;
  ctx.fill();

  drawText(ctx, parts.timeCurrent, '01:23', {
    size: 12, color: theme.gridLine, align: 'left', fontFamily: theme.fontFamily,
  });
  drawText(ctx, parts.timeTotal, '03:58', {
    size: 12, color: theme.disabled, align: 'right', fontFamily: theme.fontFamily,
  });

  ctx.restore();
};
