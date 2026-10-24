/**
 * 第二轮动效的**绘制层**：把 `juice.ts` 的快照画到 canvas 上（只画，不判定、不计时）。
 *
 * 三条纪律写在这里，改的时候别破：
 * 1. `drawWithDissolve` 一律不用：它走 `destination-out`，会擦**整张画布**已有像素，
 *    单格用就是「画面破洞」。烫糊改用同款噪声网格 + 背景色覆盖（见 anim.ts `burnPatches`）。
 * 2. 单格闪红一律用 `fillRect` + `withAlpha`：`drawFlash` 是全屏 `fillRect`，用它会晃眼睛。
 * 3. `beginShake` 必须配对 `restore()`（包装在 try/finally 里）。
 */

import {
  beginShake,
  drawFlash,
  drawScanline,
  drawVignette,
  drawWithChromatic,
  drawWithGlow,
  withAlpha,
} from './deps';
import type { AssetService, Ctx2D, Rect } from './deps';
import { BEAD_KEYS } from './assets';
import { drawImg } from './draw-img';
import {
  ALERT_SCANLINE,
  HOT_SCANLINE,
  PLATE_GLOW_INTENSITY,
  PLATE_HEAT_ALPHA,
  burnDissolveAt,
  burnPatches,
  ironCellColor,
  particleAt,
  shiftColor,
  tempPulse,
} from './anim';
import {
  ALERT_VIGNETTE,
  BG,
  DRAG_SHADOW,
  DRAG_STROKE,
  FALLBACK_TINT,
  GHOST_STROKE,
  GRID_LINE,
  HEAT_OVERLAY,
  IRON_BURN,
  LOCK_GLOW,
  LOCK_PARTICLE,
  PLATE_BODY,
  PLATE_GLOW,
  REJECT_CELL,
  REJECT_FLASH_COLOR,
  TEMP_COLD_COLOR,
  TEMP_HOT_COLOR,
  TEMP_OK_COLOR,
  TEMP_WARN_COLOR,
  TRACK_BASE,
} from './skin';
import { CELL_TINTS, GRID } from './levels';
import { PLATE_CELLS, TEMP_BURN, TEMP_HI, TEMP_LO, TEMP_MAX, coveredCells, snappedPlate, tempState } from './iron';
import type { BoardGeom } from './board-geom';
import type { JuiceFrame } from './juice';
import type { GameState } from './state';

const NO_DRAW = (): void => undefined;

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** 震屏包装：`draw` 里画世界；HUD 在包装外画，所以不跟着晃 */
export const withShake = (ctx: Ctx2D, viewport: Viewport, frame: JuiceFrame, draw: () => void): void => {
  if (!(frame.shake > 0)) {
    draw();
    return;
  }
  const restore = beginShake(ctx, viewport, {
    amplitude: frame.shake,
    rotation: frame.shakeRot,
    seed: frame.shakeSeed,
  });
  try {
    draw();
  } finally {
    restore();
  }
};

/** ② 跟手高亮：只亮「与被拖色块同色、且还没归位」的目标格 */
const drawTargetHighlight = (ctx: Ctx2D, g: BoardGeom, state: GameState, frame: JuiceFrame): void => {
  if (frame.dragColor < 0 || !(frame.highlight > 0)) return;
  const occupied = new Set<number>();
  for (const p of state.pieces) if (p.loc.t === 'grid') occupied.add(p.loc.i);
  state.grid.forEach((v, i) => {
    if (v !== frame.dragColor || occupied.has(i)) return;
    const r = Math.floor(i / GRID);
    const c = i % GRID;
    const hover = frame.hoverCell === i;
    drawWithGlow(
      ctx,
      { x: g.bx + c * g.cell, y: g.by + r * g.cell, w: g.cell - 2, h: g.cell - 2 },
      { color: CELL_TINTS[v] ?? FALLBACK_TINT, intensity: frame.highlight, layers: hover ? 4 : 2, blur: hover ? 2 : 0 },
      NO_DRAW,
    );
  });
};

/** ③ 锁定高光与粒子；④ 错误格闪红 */
const drawLockFx = (ctx: Ctx2D, g: BoardGeom, frame: JuiceFrame): void => {
  for (const lock of frame.locks) {
    const r = Math.floor(lock.cell / GRID);
    const c = lock.cell % GRID;
    const rect: Rect = { x: g.bx + c * g.cell, y: g.by + r * g.cell, w: g.cell - 2, h: g.cell - 2 };
    if (lock.intensity > 0) drawWithGlow(ctx, rect, { color: LOCK_GLOW, intensity: lock.intensity, layers: 4 }, NO_DRAW);
    // 粒子与高光同一条时间轴：160ms 内飞散 12px
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    for (let i = 0; i < 3; i += 1) {
      const p = particleAt(lock.ageMs, i);
      if (!(p.alpha > 0)) continue;
      ctx.fillStyle = withAlpha(LOCK_PARTICLE, p.alpha);
      ctx.beginPath();
      ctx.arc(cx + p.dx, cy + p.dy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (frame.rejectCell >= 0 && frame.rejectCellAlpha > 0) {
    const r = Math.floor(frame.rejectCell / GRID);
    const c = frame.rejectCell % GRID;
    ctx.fillStyle = withAlpha(REJECT_CELL, Math.min(1, frame.rejectCellAlpha));
    ctx.fillRect(g.bx + c * g.cell, g.by + r * g.cell, g.cell - 2, g.cell - 2);
  }
};

/** ④ 弹回残影：色差抖动 + 缩小的色块（位置由 juice 按 back 曲线算好） */
const drawGhost = (ctx: Ctx2D, frame: JuiceFrame): void => {
  const gh = frame.ghost;
  if (gh === null) return;
  const rect: Rect = { x: gh.x, y: gh.y, w: gh.s, h: gh.s };
  const paint = (): void => {
    ctx.fillStyle = CELL_TINTS[gh.color] ?? FALLBACK_TINT;
    ctx.fillRect(rect.x + 2, rect.y + 2, Math.max(1, rect.w - 4), Math.max(1, rect.h - 4));
    ctx.strokeStyle = GHOST_STROKE;
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + 2, rect.y + 2, Math.max(1, rect.w - 4), Math.max(1, rect.h - 4));
  };
  if (frame.chromatic > 0) drawWithChromatic(ctx, rect, { offset: frame.chromatic, alpha: 0.55 }, paint);
  else paint();
};

/** ① 拖拽中的色块：立即贴指 + 60ms 放大（位置不补间，否则「看着对、判定错」） */
export const drawDraggedPiece = (
  ctx: Ctx2D,
  pos: { readonly x: number; readonly y: number } | null,
  size: number,
  color: number,
  frame: JuiceFrame,
  art: AssetService | null = null,
): void => {
  if (pos === null || color < 0) return;
  const s = size * frame.pickScale;
  const x = pos.x + size / 2 - s / 2;
  const y = pos.y + size / 2 - s / 2;
  const key = BEAD_KEYS[color];
  const img = key === undefined ? null : art?.get(key) ?? null;
  if (img !== null) {
    // 有贴图：只补投影（珠子自带描边/高光），不套回退画法
    ctx.save();
    ctx.shadowColor = DRAG_SHADOW;
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    drawImg(ctx, img, x, y, s, s);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.shadowColor = DRAG_SHADOW;
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = CELL_TINTS[color] ?? FALLBACK_TINT;
  ctx.fillRect(x + 1, y + 1, Math.max(1, s - 2), Math.max(1, s - 2));
  ctx.restore();
  ctx.strokeStyle = DRAG_STROKE;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 1, y + 1, Math.max(1, s - 2), Math.max(1, s - 2));
};

/** 盘面页的动效（色块画完之后盖上去） */
export const drawBoardFx = (ctx: Ctx2D, g: BoardGeom, state: GameState, frame: JuiceFrame): void => {
  drawTargetHighlight(ctx, g, state, frame);
  drawLockFx(ctx, g, frame);
  drawGhost(ctx, frame);
};

/** ⑦ 烫糊格：焦褐色 + 用背景色盖掉噪声小块（等价视觉，但不擦穿底下的盘面） */
const drawIronCells = (ctx: Ctx2D, g: { bx: number; by: number; cell: number }, state: GameState): void => {
  const iron = state.iron;
  const targetSet = new Set(iron.targets);
  for (const i of iron.targets) {
    const at = iron.targets.indexOf(i);
    const cell = iron.cells[at] ?? 0;
    const ageMs = (iron.clock - (iron.cellAt[at] ?? 0)) * 1000;
    const tint = CELL_TINTS[state.grid[i] ?? 0] ?? FALLBACK_TINT;
    const r = Math.floor(i / GRID);
    const c = i % GRID;
    const rect: Rect = { x: g.bx + c * g.cell, y: g.by + r * g.cell, w: g.cell - 2, h: g.cell - 2 };
    ctx.fillStyle = ironCellColor(tint, cell, ageMs);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    // 浅底上「未烫格 vs 底板」填充色差只有 ≈1.1:1，边界得靠格线；定型/烫糊格也保留格线才成一整块板
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    if (cell === 2) {
      ctx.fillStyle = BG;
      for (const patch of burnPatches(rect, burnDissolveAt(ageMs), 4, 4)) ctx.fillRect(patch.x, patch.y, patch.w, patch.h);
      ctx.strokeStyle = withAlpha(IRON_BURN, 0.9);
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    }
  }
  // 板下正在受热的格：加一层白 10%（「这里正在被烫」）
  const plate = snappedPlate(iron.plate);
  ctx.globalAlpha = PLATE_HEAT_ALPHA;
  ctx.fillStyle = HEAT_OVERLAY;
  for (const i of coveredCells(plate)) {
    if (!targetSet.has(i)) continue;
    const r = Math.floor(i / GRID);
    const c = i % GRID;
    ctx.fillRect(g.bx + c * g.cell, g.by + r * g.cell, g.cell - 2, g.cell - 2);
  }
  ctx.globalAlpha = 1;
};

/** ⑤ 熨烫板：弹簧跟随位置 + 暖色光晕（「板是热的」） */
const drawPlate = (ctx: Ctx2D, g: { bx: number; by: number; cell: number }, frame: JuiceFrame): void => {
  if (frame.plate === null) return;
  const px = g.bx + frame.plate.gx * g.cell;
  const py = g.by + frame.plate.gy * g.cell;
  const size = PLATE_CELLS * g.cell;
  drawWithGlow(ctx, { x: px, y: py, w: size, h: size }, { color: PLATE_GLOW, intensity: PLATE_GLOW_INTENSITY, layers: 2 }, () => {
    ctx.fillStyle = PLATE_BODY;
    ctx.fillRect(px, py, size, size);
  });
  ctx.strokeStyle = withAlpha(PLATE_GLOW, 0.95);
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, size - 2, size - 2);
};

/** ⑥ 温度条：固定刻度（绿窗 / 危险带）+ 三态指针颜色 + 脉冲 + 超温条纹 */
const drawTempBar = (ctx: Ctx2D, bar: Rect, frame: JuiceFrame): void => {
  const h = Math.max(6, Math.min(14, bar.h));
  const y = bar.y + (bar.h - h) / 2;
  const st = tempState(frame.temp);
  const base = st === 'hot' ? TEMP_HOT_COLOR : st === 'warn' ? TEMP_WARN_COLOR : st === 'ok' ? TEMP_OK_COLOR : TEMP_COLD_COLOR;
  ctx.fillStyle = withAlpha(TRACK_BASE, 0.12);
  ctx.fillRect(bar.x, y, bar.w, h);
  ctx.fillStyle = withAlpha(TEMP_OK_COLOR, 0.5);
  ctx.fillRect(bar.x + (TEMP_LO / TEMP_MAX) * bar.w, y, ((TEMP_HI - TEMP_LO) / TEMP_MAX) * bar.w, h);
  ctx.fillStyle = withAlpha(TEMP_HOT_COLOR, 0.35);
  ctx.fillRect(bar.x + (TEMP_BURN / TEMP_MAX) * bar.w, y, (1 - TEMP_BURN / TEMP_MAX) * bar.w, h);
  if (st === 'ok' || st === 'warn' || st === 'hot') {
    drawWithGlow(ctx, { x: bar.x, y, w: bar.w, h }, { color: base, intensity: st === 'ok' ? 0.3 : 0.55, layers: 2 }, NO_DRAW);
  }
  if (st === 'hot') {
    drawScanline(ctx, { width: bar.w, height: h }, { ...HOT_SCANLINE, color: TEMP_HOT_COLOR });
  }
  const tx = bar.x + (Math.min(TEMP_MAX, Math.max(0, frame.temp)) / TEMP_MAX) * bar.w;
  ctx.fillStyle = shiftColor(base, tempPulse(st, frame.clockMs));
  ctx.fillRect(tx - 2, y - 4, 4, h + 8);
};

/** B 段全部动效 */
export const drawIronFx = (
  ctx: Ctx2D,
  g: { bx: number; by: number; cell: number; bar: Rect },
  state: GameState,
  frame: JuiceFrame,
): void => {
  drawIronCells(ctx, g, state);
  drawPlate(ctx, g, frame);
  drawTempBar(ctx, g.bar, frame);
};

/** 全屏层：放错闪红 / 累积告警暗角与条纹（画在最上层） */
export const drawScreenFx = (ctx: Ctx2D, viewport: Viewport, frame: JuiceFrame): void => {
  if (frame.flash > 0) drawFlash(ctx, viewport, { color: REJECT_FLASH_COLOR, alpha: frame.flash });
  if (frame.alert > 0) {
    drawVignette(ctx, viewport, { strength: frame.alert, color: ALERT_VIGNETTE });
    if (frame.alertHot) drawScanline(ctx, viewport, { ...ALERT_SCANLINE, color: TEMP_HOT_COLOR });
  }
};
