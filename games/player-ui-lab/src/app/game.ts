/**
 * 游戏外壳：一帧 = 背景 → 中景玻璃 → 9 个组件（按 `layout()` 的 paintOrder 正序画）。
 *
 * 布局坐标 = **真实屏幕尺寸**（`fit: fill`：画布 = 视口，`platform.screen` 就是它）。
 * 390×844 设备上与设计稿坐标完全相同（像素级还原）；窄屏 / 宽屏按 region 的比例约束
 * 重新排布，铺满、不留黑边。视口变化（旋转 / 改窗口）时重算 layout。
 *
 * 不自己 `setTransform`：平台在 `applyCanvasSize()` 里已经设过 dpr 变换
 * （`platform/web/env.ts:214`，契约 `platform/contract.ts`），再乘一次 dpr 会双重缩放。
 */

import { createLoop } from './deps';
import type { Ctx2D, LayoutViewport, PlatformAdapter, Rect } from './deps';
import { drawBackdrop, drawGlassPanel, panelRectOf, propsOf, solve } from './scene';
import { PLAYER_THEME } from './theme';
import { createPlayerRegistry } from './ui-registry';

export interface PlayerGame {
  /** 当前布局坐标（= 画布 CSS 尺寸 = 屏幕逻辑尺寸）。 */
  readonly viewport: LayoutViewport;
  /** `layout()` 算出的组件矩形（对拍脚本读它，不读组件内部）。 */
  readonly rects: Readonly<Record<string, Rect>>;
  readonly paintOrder: readonly string[];
  readonly layoutErrors: readonly string[];
  start(): void;
  stop(): void;
  draw(): void;
}

/** 零素材：组件不取任何图片，`assets.get` 永远返回 null（组件里也不调用它）。 */
const EMPTY_ASSETS = { get: () => null };

export const createGame = (platform: PlatformAdapter): PlayerGame => {
  const ctx: Ctx2D | null = platform.canvas.getContext('2d');
  const registry = createPlayerRegistry();
  let viewport: LayoutViewport = { width: platform.screen.width, height: platform.screen.height };
  let solved = solve(viewport, registry);
  const props = propsOf();

  /** 视口变了才重算（layout 是纯函数，但没必要每帧跑）。 */
  const syncViewport = (): void => {
    const screen = platform.screen;
    if (screen.width === viewport.width && screen.height === viewport.height) return;
    viewport = { width: screen.width, height: screen.height };
    solved = solve(viewport, registry);
  };

  const draw = (): void => {
    if (ctx === null) return;
    syncViewport();
    drawBackdrop(ctx, viewport, PLAYER_THEME);
    // 玻璃面板从布局结果派生（`regions.dock` + `rects.primaryControls`），不写死尺寸
    const panel = panelRectOf(solved);
    if (panel !== null) drawGlassPanel(ctx, panel, PLAYER_THEME);
    for (const name of solved.paintOrder) {
      const rect = solved.rects[name];
      const comp = registry.get(name);
      if (rect === undefined || comp === null) continue;
      // 每个组件单独 save/restore：某个组件改了 globalAlpha / 变换也污染不到下一个
      ctx.save();
      comp.draw(ctx, rect, props[name] ?? {}, { assets: EMPTY_ASSETS, theme: PLAYER_THEME });
      ctx.restore();
    }
  };

  const loop = createLoop({ update: () => undefined, render: () => draw() });

  return {
    get viewport(): LayoutViewport {
      return viewport;
    },
    get rects(): Readonly<Record<string, Rect>> {
      return solved.rects;
    },
    get paintOrder(): readonly string[] {
      return solved.paintOrder;
    },
    get layoutErrors(): readonly string[] {
      return solved.errors;
    },
    draw,
    start: (): void => {
      draw();
      loop.start();
    },
    stop: (): void => loop.stop(),
  };
};
