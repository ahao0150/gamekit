/**
 * 2D 绘制实现：CanvasRenderingContext2D 的薄封装。
 *
 * 两个职责（契约原文）：把常用调用收成显式 API；调用前断言参数合法——
 * NaN/Infinity 的坐标是 Canvas「静默不画」的头号元凶，这层必须显式拦下
 * （拦 = 跳过本次调用，不抛错：渲染层的坏参数不该炸掉主循环）。
 *
 * 只画不判：本文件不 import 任何游戏状态。
 */

import type { Ctx2D, GameImage, ImageDrawOptions, TextStyle } from './contract';
import type { CreateRender, RenderService } from './contract';
import type { Rect, Vec2 } from '../ui/contract';

/** 拦下 NaN / Infinity（Canvas 会静默不画，让它至少可被断言/统计） */
function bad(...vs: number[]): boolean {
  for (const v of vs) {
    if (!Number.isFinite(v)) return true;
  }
  return false;
}

function badRect(r: Rect): boolean {
  return bad(r.x, r.y, r.w, r.h);
}

function badVec(v: Vec2): boolean {
  return bad(v.x, v.y);
}

function fontOf(style: TextStyle | undefined): string {
  const s = style ?? {};
  const weight = s.weight ?? 'normal';
  const size = s.size ?? 16;
  const family = s.family ?? 'sans-serif';
  return `${weight} ${size}px ${family}`;
}

export const createRender: CreateRender = (opts: { readonly ctx: Ctx2D; readonly dpr?: number }): RenderService => {
  const ctx = opts.ctx;
  // 逻辑像素 → 物理像素的缩放。web 端 backing store 是 CSS × dpr，
  // 绘制坐标却是逻辑像素，beginFrame 必须把坐标系重置成这个缩放，
  // 否则画面会缩到左上角、点击整体错位（屏幕适配 bug 的根因）。
  const dpr = typeof opts.dpr === 'number' && Number.isFinite(opts.dpr) && opts.dpr > 0 ? opts.dpr : 1;
  // alpha 栈：pushAlpha/popAlpha 的乘法基准
  const alphaStack: number[] = [];
  // clip 栈：pushClip/popClip 依赖 save/restore 配对（平台 ctx 的状态栈）
  let clipDepth = 0;

  function currentAlpha(): number {
    let a = 1;
    for (const v of alphaStack) a *= v;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  function applyAlpha(): void {
    ctx.globalAlpha = currentAlpha();
  }

  const service: RenderService = {
    ctx,

    beginFrame(clearColor?: string): void {
      // 重置成「逻辑像素坐标系」而不是 identity：backing store 是 CSS × dpr，
      // 若回到 identity，按逻辑坐标画的内容只会占左上角 1/dpr²。
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      alphaStack.length = 0;
      while (clipDepth > 0) {
        ctx.restore();
        clipDepth -= 1;
      }
      ctx.globalAlpha = 1;
      // 清屏范围用逻辑尺寸（backing 尺寸 ÷ dpr），与上面建立的坐标系一致。
      const w = ctx.canvas.width / dpr;
      const h = ctx.canvas.height / dpr;
      if (clearColor) {
        ctx.fillStyle = clearColor;
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.clearRect(0, 0, w, h);
      }
    },

    endFrame(): void {
      ctx.globalAlpha = 1;
    },

    fillRect(rect: Rect, color: string): void {
      if (badRect(rect)) return;
      applyAlpha();
      ctx.fillStyle = color;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    },

    strokeRect(rect: Rect, color: string, lineWidth?: number): void {
      if (badRect(rect) || (lineWidth !== undefined && bad(lineWidth))) return;
      applyAlpha();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth ?? 1;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    },

    image(asset: GameImage | null, rect: Rect, imgOpts?: ImageDrawOptions): void {
      if (!asset) return; // null 静默跳过：资源没加载好是常态
      if (badRect(rect) || bad(asset.width, asset.height) || asset.width <= 0 || asset.height <= 0) return;
      const rot = imgOpts?.rotation ?? 0;
      if (bad(rot)) return;
      applyAlpha();

      ctx.save();
      // 翻转与旋转都绕目标矩形中心
      ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
      if (imgOpts?.flipX) ctx.scale(-1, 1);
      if (imgOpts?.flipY) ctx.scale(1, -1);
      if (rot) ctx.rotate(rot);
      const dx = -rect.w / 2;
      const dy = -rect.h / 2;

      const slice = imgOpts?.slice9;
      if (slice) {
        // 九宫格：四角原尺寸、边拉伸、中心拉伸
        const sw = asset.width;
        const sh = asset.height;
        const sl = Math.max(0, Math.min(slice.left, sw / 2));
        const sr = Math.max(0, Math.min(slice.right, sw / 2));
        const st = Math.max(0, Math.min(slice.top, sh / 2));
        const sb = Math.max(0, Math.min(slice.bottom, sh / 2));
        const midW = Math.max(0, rect.w - sl - sr);
        const midH = Math.max(0, rect.h - st - sb);
        // 行：top/mid/bottom，列：left/mid/right
        const rows = [
          { sy: 0, sh: st, dy: dy, dh: st },
          { sy: st, sh: sh - st - sb, dy: dy + st, dh: midH },
          { sy: sh - sb, sh: sb, dy: dy + st + midH, dh: sb },
        ];
        const cols = [
          { sx: 0, sw: sl, dx: dx, dw: sl },
          { sx: sl, sw: sw - sl - sr, dx: dx + sl, dw: midW },
          { sx: sw - sr, sw: sr, dx: dx + sl + midW, dw: sr },
        ];
        for (const row of rows) {
          for (const col of cols) {
            if (row.sh <= 0 || col.sw <= 0 || row.dh <= 0 || col.dw <= 0) continue;
            ctx.drawImage(asset as unknown as CanvasImageSource, col.sx, row.sy, col.sw, row.sh, col.dx, row.dy, col.dw, row.dh);
          }
        }
      } else {
        ctx.drawImage(asset as unknown as CanvasImageSource, dx, dy, rect.w, rect.h);
      }
      ctx.restore();
    },

    text(t: string, at: Vec2, style?: TextStyle): void {
      if (badVec(at)) return;
      const s = style ?? {};
      const size = s.size ?? 16;
      if (bad(size, s.strokeWidth ?? 0)) return;
      applyAlpha();
      ctx.font = fontOf(style);
      ctx.textAlign = s.align ?? 'left';
      ctx.textBaseline = s.baseline ?? 'top';
      if (s.strokeWidth && s.strokeWidth > 0) {
        ctx.strokeStyle = s.strokeColor ?? '#fff';
        ctx.lineWidth = s.strokeWidth;
        ctx.strokeText(t, at.x, at.y);
      }
      ctx.fillStyle = s.color ?? '#000';
      // maxWidth > 0 才透传：0 / 负数会让 canvas 把文字压成不可见
      if (s.maxWidth !== undefined && s.maxWidth > 0) ctx.fillText(t, at.x, at.y, s.maxWidth);
      else ctx.fillText(t, at.x, at.y);
    },

    textLines(lines: readonly string[], at: Vec2, style?: TextStyle): void {
      if (badVec(at)) return;
      const s = style ?? {};
      const lh = s.lineHeight ?? (s.size ?? 16) * 1.2;
      if (bad(lh)) return;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line === undefined) continue;
        service.text(line, { x: at.x, y: at.y + i * lh }, style);
      }
    },

    line(from: Vec2, to: Vec2, color: string, lineWidth?: number): void {
      if (badVec(from) || badVec(to) || (lineWidth !== undefined && bad(lineWidth))) return;
      applyAlpha();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth ?? 1;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    },

    circle(center: Vec2, radius: number, color: string, filled?: boolean): void {
      if (badVec(center) || bad(radius) || radius < 0) return;
      applyAlpha();
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      if (filled ?? true) {
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    },

    pushClip(rect: Rect): void {
      if (badRect(rect)) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      clipDepth += 1;
    },

    popClip(): void {
      if (clipDepth <= 0) return; // 不配对的 pop 直接忽略，防 restore 吃掉外部状态
      ctx.restore();
      clipDepth -= 1;
    },

    pushAlpha(alpha: number): void {
      if (bad(alpha)) return;
      alphaStack.push(alpha < 0 ? 0 : alpha > 1 ? 1 : alpha);
    },

    popAlpha(): void {
      if (alphaStack.length > 0) alphaStack.pop();
    },

    placeholder(rect: Rect, label?: string): void {
      // 统一降级画法：灰底 + 边框 + 对角线 + 可选标签，资源缺失时看得出「这里该有东西」
      if (badRect(rect)) return;
      applyAlpha();
      ctx.fillStyle = 'rgba(128,128,128,0.25)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = 'rgba(128,128,128,0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      ctx.beginPath();
      ctx.moveTo(rect.x, rect.y);
      ctx.lineTo(rect.x + rect.w, rect.y + rect.h);
      ctx.stroke();
      if (label) {
        service.text(label, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, { align: 'center', baseline: 'middle', color: '#666', size: Math.min(14, Math.max(9, rect.h / 3)) });
      }
    },

    measureText(t: string, style?: TextStyle): number {
      ctx.font = fontOf(style);
      return ctx.measureText(t).width;
    },
  };

  return service;
};

// T30：离屏层缓存（静态 UI 层「每帧重画 → 一次 drawImage」）
export { createLayerCache, createLayerCacheFor } from './cache';
export type { LayerCache, LayerCacheOptions } from './cache';

// 文本折行与变高项高度预计算（聊天气泡这类「按文本变高」的内容靠它）
export { measureItemHeights, wrapText } from './wrap';
export type { ItemHeightOptions, MeasureFn } from './wrap';
