/**
 * 元素级特效：溶解（T23）。
 *
 * 做法：`progress=0` 完整画内容；`progress=1` **完全不画**（连内容都不调，最省）；
 * 中间值先把内容画上，再用 `destination-out` 按「确定性噪声网格」挖洞——
 * `progress` 越大被挖掉的格子越多，视觉上就是逐渐溶解。
 *
 * **重要前提（写进文档，别踩）**：Canvas 2D 没有离屏遮罩时，`destination-out` 会擦掉
 * **整张画布**上已有的像素（不只内容回调画的那些）。所以这个特效必须画在**隔离的一层**
 * 上（游戏侧在过渡层 / 独立画布里用），否则会把背景也擦穿。真正的像素级遮罩需要
 * 着色器或离屏画布，那是平台相关能力，这里不做。
 *
 * 随机性用 `hash01(seed)` 而不是 `Math.random()`：同一帧同一 progress 一定长一样，
 * 可复现、可测，也不读写全局状态。
 */

import type { Ctx2D } from '../../platform/contract';
import type { GameImage } from '../../platform/contract';
import type { Rect } from '../ui/contract';
import { clamp01, hash01, isComplete, isDrawableRect, isIdle, withAlpha } from './util';

/** 溶解参数。 */
export interface DissolveOptions {
  /** 0 = 完整显示、1 = 完全消失（中间值按比例挖洞） */
  readonly progress: number;
  /** 噪声图案（带 `native` 的图片）或噪声尺寸（只有 width/height 时按网格近似） */
  readonly noise: GameImage | { readonly width: number; readonly height: number };
  /** 溶解边缘的颜色（画在被擦格子外沿，模拟「烧穿」） */
  readonly edgeColor?: string;
}

/** 网格近似的目标格子边长（像素）：太小会画很多次，太大边缘像马赛克。 */
const CELL_PX = 24;

export const drawWithDissolve = (
  ctx: Ctx2D,
  rect: Rect,
  opts: DissolveOptions,
  draw: () => void,
): void => {
  const progress = clamp01(opts.progress, 0);
  // 全显示：直接画，零额外开销
  if (isIdle(progress)) {
    draw();
    return;
  }
  // 全消失：内容完全不画（不是画完再擦，省一遍绘制）
  if (isComplete(progress) || !isDrawableRect(rect)) return;

  draw();
  ctx.save();

  // ① 噪声图优先：图案 alpha × globalAlpha 就是擦除强度（离屏噪声图带透明通道时效果最好）
  const native = (opts.noise as { readonly native?: unknown }).native;
  if (native !== undefined && native !== null) {
    const pattern = ctx.createPattern(native as CanvasImageSource, 'repeat');
    if (pattern !== null) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = progress;
      ctx.fillStyle = pattern;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
      return;
    }
  }

  // ② 没有可用图案：确定性网格挖洞
  const cols = Math.max(4, Math.round(rect.w / CELL_PX));
  const rows = Math.max(4, Math.round(rect.h / CELL_PX));
  const cellW = rect.w / cols;
  const cellH = rect.h / rows;
  const burning: Rect[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const threshold = hash01(col * 7.13 + row * 31.7);
      if (threshold < progress) burning.push({ x: rect.x + col * cellW, y: rect.y + row * cellH, w: cellW, h: cellH });
    }
  }

  // 先画「烧穿边缘」（source-over），再统一擦除，避免边缘也被擦掉
  if (opts.edgeColor !== undefined && opts.edgeColor.length > 0) {
    ctx.strokeStyle = withAlpha(opts.edgeColor, 0.85);
    ctx.lineWidth = Math.max(1, Math.min(cellW, cellH) * 0.12);
    for (const cell of burning) {
      if (cell.w > 0 && cell.h > 0) ctx.strokeRect(cell.x, cell.y, cell.w, cell.h);
    }
  }
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000000';
  for (const cell of burning) ctx.fillRect(cell.x, cell.y, cell.w + 0.5, cell.h + 0.5);
  ctx.restore();
};
