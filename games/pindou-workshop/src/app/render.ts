/**
 * 渲染：`.ui` 组件（paintOrder 正序）+ 自绘世界（盘面 / 熨烫）+ 动效层。
 *
 * T63 第二轮：自绘世界包在 `withShake` 里（震屏只晃世界，HUD 不晃），
 * 动效（高亮 / 锁定 / 粒子 / 残影 / 烫糊 / 温度三态）全部交给 `render-fx.ts`。
 * T73 美术接入：**「有图 / 缺图」的视觉分支全部在 `render-art.ts`**，本文件只按
 * `.ui` 求出的 rects 做屏级编排（画什么、画在哪、什么顺序）。
 */

import { DEFAULT_THEME } from './deps';
import type { AssetService, ComponentAssets, ComponentTheme, Ctx2D, DrawDeps, Rect } from './deps';
import { selectData } from './layout';
import type { ScreenLayout } from './layout';
import { CELL_TINTS, GRID, LEVELS } from './levels';
import { boardGeomOf, ironGeomOf, poolPos, slotPos } from './board-geom';
import type { BoardGeom } from './board-geom';
import { drawBoardFx, drawDraggedPiece, drawIronFx, drawScreenFx, withShake } from './render-fx';
import { drawBackground, drawBead, drawGrooveCell, drawIcon, drawPanelBg, roundRect } from './render-art';
import { asComponentAssets } from './assets';
import {
  BEAN_HILIGHT,
  BEAN_STROKE,
  BOARD_PLATE,
  DIALOG_FILL,
  DIM_MASK,
  FALLBACK_TINT,
  GRID_LINE,
  HINT_STROKE,
  HUD_EDGE_DARK,
  HUD_EDGE_LIGHT,
  INK,
  INK_DIM,
  PANEL_EDGE,
  RESULT_SCRIM,
  SLOT_STROKE,
  THEME_DISABLED,
  THEME_GRID_LINE,
  THEME_LIGHT,
  THEME_PANEL,
  THEME_PRIMARY,
  THEME_SECONDARY,
  THUMB_BG,
} from './skin';
import type { JuiceFrame } from './juice';
import type { GameState } from './state';

/** 浅底主题：一处覆盖，所有 `.ui` 组件的文字/底色跟着变（`.ui` 里只留字色例外） */
const THEME: ComponentTheme = {
  ...DEFAULT_THEME,
  ink: INK,
  light: THEME_LIGHT,
  primary: THEME_PRIMARY,
  secondary: THEME_SECONDARY,
  panel: THEME_PANEL,
  gridLine: THEME_GRID_LINE,
  disabled: THEME_DISABLED,
};

/** 回退路径：没有任何图时组件拿到的 assets（`.ui` 组件内建纯色回落） */
const EMPTY_ASSETS: ComponentAssets = { get: () => null };
const FONT = 'bold 13px sans-serif';

/** 拖拽中的色块（位置来自 input.ts 的 dragPos，指针到哪它到哪） */
export interface DragView {
  readonly id: number;
  readonly pos: { readonly x: number; readonly y: number } | null;
  readonly size: number;
  readonly color: number;
}

const NO_DRAG: DragView = { id: -1, pos: null, size: 0, color: -1 };

/** 关卡缩略（select 屏 grid 单元格） */
const drawThumb = (
  ctx: Ctx2D,
  item: unknown,
  rect: { x: number; y: number; w: number; h: number },
  unlocked: number,
  art: AssetService | null,
): void => {
  const id = typeof item === 'number' ? item : 1;
  const level = LEVELS.find((l) => l.id === id) ?? LEVELS[0]!;
  const locked = id > unlocked;
  ctx.fillStyle = THUMB_BG;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  const pad = 8;
  const inner = Math.min(rect.w, rect.h) - pad * 2 - 14;
  const cell = inner / GRID;
  const ox = rect.x + (rect.w - inner) / 2;
  const oy = rect.y + 6;
  for (let r = 0; r < GRID; r += 1) {
    for (let c = 0; c < GRID; c += 1) {
      const v = level.grid[r * GRID + c] ?? -1;
      if (v >= 0) drawBead(ctx, ox + c * cell, oy + r * cell, cell, v, art);
    }
  }
  if (locked) {
    // 未解锁：压暗 + 锁标（点击在 game.ts 的 selectHit 里被拦，这里只表达状态）
    ctx.fillStyle = DIM_MASK;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = INK;
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('锁', rect.x + rect.w / 2, rect.y + rect.h / 2);
  }
  ctx.fillStyle = locked ? INK_DIM : INK;
  ctx.font = FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('#' + String(id), rect.x + 6, rect.y + rect.h - 18);
};

/** A 段盘面静态内容：目标格凹槽 + 已归位珠子 + 临时位 + 待取池（被拖的那块不画在这里） */
const drawBoard = (ctx: Ctx2D, g: BoardGeom, state: GameState, dragId: number, art: AssetService | null): void => {
  state.grid.forEach((v, i) => {
    if (v < 0) return;
    const r = Math.floor(i / GRID);
    const c = i % GRID;
    drawGrooveCell(ctx, g.bx + c * g.cell, g.by + r * g.cell, g.cell, v, art);
  });
  for (const p of state.pieces) {
    if (p.loc.t !== 'grid') continue;
    drawBead(ctx, g.bx + (p.loc.i % GRID) * g.cell, g.by + Math.floor(p.loc.i / GRID) * g.cell, g.cell, p.color, art);
  }
  // 临时位：先画虚线空框，再画放在里面的珠子
  ctx.strokeStyle = SLOT_STROKE;
  ctx.setLineDash([4, 3]);
  for (let k = 0; k < state.tempSlots; k += 1) {
    const pos = slotPos(g, k);
    ctx.strokeRect(pos.x, pos.y, pos.s, pos.s);
  }
  ctx.setLineDash([]);
  for (let k = 0; k < state.tempSlots; k += 1) {
    const p = state.pieces.find((q) => q.loc.t === 'temp' && q.loc.k === k);
    if (p !== undefined) {
      const pos = slotPos(g, k);
      drawBead(ctx, pos.x, pos.y, pos.s, p.color, art);
    }
  }
  const spawn = state.pieces.filter((p) => p.loc.t === 'spawn');
  spawn.forEach((p, k) => {
    if (p.id === dragId) return;
    const pos = poolPos(g, k);
    drawBead(ctx, pos.x, pos.y, pos.s, p.color, art);
  });
  // 广告提示锁定的格：金色描边（「这格是花广告换来的，不是玩家自己放的」）
  if (state.hinted.length > 0) {
    ctx.strokeStyle = HINT_STROKE;
    ctx.lineWidth = 2;
    for (const i of state.hinted) {
      const x = g.bx + (i % GRID) * g.cell;
      const y = g.by + Math.floor(i / GRID) * g.cell;
      ctx.strokeRect(x + 1, y + 1, g.cell - 4, g.cell - 4);
    }
  }
};

export interface Renderer {
  draw(ctx: Ctx2D, view: ScreenLayout, state: GameState, frame: JuiceFrame, drag: DragView): void;
}

export const createRenderer = (art: AssetService | null = null): Renderer => ({
  draw(ctx, view, state, frame, drag) {
    const vp = view.viewport;
    drawBackground(ctx, vp, art);
    const data: DrawDeps['data'] =
      view.screen === 'select'
        ? {
            ...selectData(state),
            renderItem: (c: Ctx2D, item: unknown, rect: Rect): void => drawThumb(c, item, rect, state.unlocked, art),
          }
        : {};
    const deps: DrawDeps = { assets: art === null ? EMPTY_ASSETS : asComponentAssets(art), theme: THEME, data };
    // HUD 带的底改用九宫格图。**必须在组件顺序里画**：overlay 层的 HUD 文字排在 panel 之后，
    // 如果把图放在整个循环之后再画，会把文字盖掉（第一版就是这么翻的）。
    const isHud = view.screen === 'board' || view.screen === 'iron';
    for (const name of view.paintOrder) {
      const def = view.components[name];
      const rect = view.rects[name];
      if (def === undefined || rect === undefined) continue;
      if (name === 'backdropMask') {
        // 结算遮罩：自绘而不是复用 `.ui` 的 panel —— panel 组件有图就优先画图（`fillColor` 只是
        // 缺图回退），接上 `ui/panel` 后它会变成一块不透明的全屏磨砂白板，遮罩就没了。
        ctx.fillStyle = RESULT_SCRIM;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        continue;
      }
      if (name === 'dialogPanel') {
        // 纯实底圆角面板。
        // 为什么不用 `ui/panel` 九宫格：那张 240 方的素材**中心区比边框区亮 2 级**（245 vs 243），
        // 九宫格把中心区拉伸成一块 240×359 的矩形，放大后就是用户报的「文字后面有个浅灰块」。
        // 面板素材的落点改到 `.ui` 的 `panel` 组件（home/select 的标题区仍在用它），这里要的是均匀。
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 46);
        ctx.fillStyle = DIALOG_FILL;
        ctx.fill();
        ctx.strokeStyle = PANEL_EDGE;
        ctx.lineWidth = 1;
        ctx.stroke();
        continue;
      }
      if (isHud && name === 'panel') {
        // 缺图 / 源图放不下两倍边距 → 回落 `.ui` 的实心 panel（当前那套画法的等价物）
        if (!drawPanelBg(ctx, rect, art, 'ui/hud-bar')) def.draw(ctx, rect, view.props[name] ?? {}, deps);
        continue;
      }
      def.draw(ctx, rect, view.props[name] ?? {}, deps);
    }
    // HUD 磨砂条的两条边线（浅底上白条会糊进背景）；画在组件之后，不遮文字。
    // 左侧图标：盘面用时钟、熨烫温度计 —— 这两个图标是**唯一有落点的**（见 assets.ts ART_KEYS）。
    const panel = view.rects['panel'];
    if (isHud && panel !== undefined) {
      ctx.fillStyle = HUD_EDGE_LIGHT;
      ctx.fillRect(panel.x, panel.y, panel.w, 1);
      ctx.fillStyle = HUD_EDGE_DARK;
      ctx.fillRect(panel.x, panel.y + panel.h - 1, panel.w, 1);
      const iconSize = Math.min(28, Math.round(panel.h * 0.5));
      drawIcon(
        ctx,
        view.screen === 'iron' ? 'icons/thermometer' : 'icons/clock',
        { x: panel.x + 14, y: panel.y + (panel.h - iconSize) / 2, w: iconSize, h: iconSize },
        art,
      );
    }
    const area = view.rects['boardArea'];
    if (area === undefined) return;
    if (view.screen === 'board') {
      const spawn = state.pieces.filter((p) => p.loc.t === 'spawn');
      const g = boardGeomOf(area, spawn.length, state.tempSlots);
      withShake(ctx, vp, frame, () => {
        drawBoard(ctx, g, state, drag.id, art);
        drawBoardFx(ctx, g, state, frame);
        drawDraggedPiece(ctx, drag.pos, drag.size, drag.color, frame, art);
      });
    } else if (view.screen === 'iron') {
      const g = ironGeomOf(area);
      withShake(ctx, vp, frame, () => {
        // 盘面底板：浅底上「未烫格」与渐变背景只差 ≈1.1:1，没有板整片糊在一起。
        // 用纯色圆角板而不是九宫格图：板要包住 10×10 方格，240 方图放大 1.6× 后
        // 圆角会大于一个格子，四角格子会从圆角里突出来。
        const pad = 6;
        const px = Math.max(0, g.bx - pad);
        const py = Math.max(0, g.by - pad);
        const pw = Math.min(vp.width - px, g.size + pad * 2);
        const ph = Math.min(vp.height - py, g.size + pad * 2);
        roundRect(ctx, px, py, pw, ph, 10);
        ctx.fillStyle = BOARD_PLATE;
        ctx.fill();
        ctx.strokeStyle = GRID_LINE;
        ctx.lineWidth = 1;
        ctx.stroke();
        drawIronFx(ctx, g, state, frame);
      });
    }
    drawScreenFx(ctx, vp, frame);
  },
});

export { NO_DRAG };
