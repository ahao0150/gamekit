/**
 * 场景层：背景（渐变 + 两处光晕 + 顶部压暗）与中景（底部玻璃面板）。
 *
 * 这两层是**纯装饰**，设计稿里没有 `data-name`，所以不参与对拍 —— 它们只负责
 * 让画面成立，几何按视口比例算（390 下与设计稿逐像素一致：光晕 / 面板位置都能手算验证）。
 * 装饰一律 `ctx.save()/restore()`，不吃 `globalAlpha` 残留。
 */

import playerUi from '../../ui/player.ui';
import { bindComponents, layout } from './deps';
import type { ComponentRegistry, Ctx2D, LayoutViewport, Rect, StyleProps } from './deps';
import { rgba } from './paint';
import type { PlayerTheme } from './theme';

export interface Solved {
  readonly rects: Readonly<Record<string, Rect>>;
  /** 每个 region 的矩形（`dock` 用它拿带范围，玻璃面板从这里派生）。 */
  readonly regions: Readonly<Record<string, Rect>>;
  readonly paintOrder: readonly string[];
  readonly errors: readonly string[];
}

/** `.ui` → bind（注入组件 measure）→ layout。任何错误都收进 `errors`，调用方负责报出来。 */
export const solve = (viewport: LayoutViewport, registry: ComponentRegistry): Solved => {
  const bound = bindComponents(playerUi.spec, {
    registry,
    env: { viewport: { width: viewport.width, height: viewport.height }, data: {} },
  });
  const solved = layout(bound.spec, viewport);
  return {
    rects: solved.rects,
    regions: solved.regions,
    paintOrder: solved.paintOrder,
    errors: [...bound.errors, ...solved.errors],
  };
};

/**
 * 玻璃面板的矩形：**全部从布局结果派生**，不写死任何尺寸。
 *
 * - `y` / `h` 取 `regions.dock`（带范围：整宽 + dock 高度）
 * - `x` / `w` 取 `rects.primaryControls`（`.ui` 里 `cross 100%`，左右边界就是 dock 的 pad-x 内边）
 *
 * 两个都拿不到时返回 null（调用方跳过玻璃层，不会画出错位的面板）。
 */
export const panelRectOf = (solved: Solved): Rect | null => {
  const dock = solved.regions['dock'];
  const row = solved.rects['primaryControls'];
  if (dock === undefined || row === undefined) return null;
  return { x: row.x, y: dock.y, w: row.w, h: dock.h };
};

interface SpecNodeLike {
  readonly name?: string;
  readonly props?: StyleProps;
  readonly stack?: { readonly children: readonly unknown[] };
}

/** `.ui` 里每个 `put` 的 style（组件 draw 需要的标量参数）。 */
export const propsOf = (): Readonly<Record<string, StyleProps>> => {
  const out: Record<string, StyleProps> = {};
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    const n = node as SpecNodeLike;
    if (n.name !== undefined) out[n.name] = n.props ?? {};
    if (n.stack !== undefined) for (const child of n.stack.children) walk(child);
  };
  for (const region of playerUi.spec.regions) walk(region.node);
  return out;
};

/** 设计稿 bg 层：墨色纵向渐变 + 青绿光晕（盖封面后方）+ 金色光晕（右下）+ 顶部压暗。 */
export const drawBackdrop = (ctx: Ctx2D, viewport: LayoutViewport, theme: PlayerTheme): void => {
  const { width: w, height: h } = viewport;
  ctx.save();
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, theme.ink);
  bg.addColorStop(0.52, theme.panel);
  bg.addColorStop(1, theme.bgSoft);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const glow = (cx: number, cy: number, r: number, color: string, alpha: number): void => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(0.55, rgba(color, alpha * 0.34));
    g.addColorStop(1, rgba(color, 0));
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  };
  // 设计稿：(195, 278) r=270；(330, 720) r=230 —— 按视口比例换算，390×844 下逐像素一致
  glow(w * 0.5, h * 0.3294, w * 0.6923, theme.jade, 0.7);
  glow(w * 0.8462, h * 0.8531, w * 0.5897, theme.secondary, 0.34);

  ctx.fillStyle = rgba(theme.ink, 0.55);
  ctx.fillRect(0, 0, w, h * (150 / 844));
  ctx.restore();
};

/**
 * 中景：底部玻璃面板。
 *
 * **矩形完全由布局结果传入**（`regions.dock` + `rects.primaryControls`），本函数不写死
 * 任何高度 / 左右留白 —— 之前这里写死 `174.56/844`（dock 还是 24% 时代的值）和 `16`，
 * 结果 `.ui` 把 dock 改成 26.5% 后面板没跟上，播放键顶部凸出面板 16.2px。
 * 这就是「手绘层不许写死 UI 坐标」要防的：**容器的错位只有内容比它大时才看得见**。
 */
export const drawGlassPanel = (ctx: Ctx2D, panel: Rect, theme: PlayerTheme): void => {
  ctx.save();
  // 圆角 28 是设计稿的**绝对半径**，不跟着面板高按比例：320 档面板只有 150.52 高，
  // 按比例会算出 37.6 > 28，反而比 390 更圆、与设计稿不符。`min` 只防面板矮到半径溢出。
  const r = Math.min(28, panel.h / 4);
  const fill = ctx.createLinearGradient(panel.x, panel.y, panel.x, panel.y + panel.h);
  fill.addColorStop(0, rgba(theme.light, 0.13));
  fill.addColorStop(1, rgba(theme.light, 0.05));
  ctx.beginPath();
  ctx.moveTo(panel.x + r, panel.y);
  ctx.lineTo(panel.x + panel.w - r, panel.y);
  ctx.quadraticCurveTo(panel.x + panel.w, panel.y, panel.x + panel.w, panel.y + r);
  ctx.lineTo(panel.x + panel.w, panel.y + panel.h - r);
  ctx.quadraticCurveTo(panel.x + panel.w, panel.y + panel.h, panel.x + panel.w - r, panel.y + panel.h);
  ctx.lineTo(panel.x + r, panel.y + panel.h);
  ctx.quadraticCurveTo(panel.x, panel.y + panel.h, panel.x, panel.y + panel.h - r);
  ctx.lineTo(panel.x, panel.y + r);
  ctx.quadraticCurveTo(panel.x, panel.y, panel.x + r, panel.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = rgba(theme.light, 0.18);
  ctx.lineWidth = 1;
  ctx.stroke();

  // 玻璃厚度高光线：内缩量跟着圆角半径走（面板变矮时 r 会小于 28，高光也跟着收）
  ctx.beginPath();
  ctx.moveTo(panel.x + r, panel.y + 1);
  ctx.lineTo(panel.x + panel.w - r, panel.y + 1);
  ctx.strokeStyle = rgba(theme.light, 0.18);
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
};
