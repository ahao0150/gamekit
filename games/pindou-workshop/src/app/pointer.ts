/**
 * 指针 / 拖拽层：把 `PointerEvent` 翻译成「抓块、移动、落位、熨烫板拖拽」，
 * 并驱动动效（juice）与音效回调。
 *
 * 为什么单独成文件：`game.ts` 还要管服务接线、主循环、结算副作用，指针状态机塞进去
 * 会顶到 300 行（AGENTS 铁律 2）。这里只认 `PointerWorld` 这个薄接口，不 import 平台。
 *
 * 判定仍在 `reduce`（纯函数）里：本文件只决定「发哪条 action / 抓谁」。
 */

import { IDLE_DND, dragPos, dragTo, drop, grab } from './input';
import type { DnD } from './input';
import type { Juice } from './juice';
import { PLATE_CELLS } from './iron';
import { boardGeomOf, gridAt, ironGeomOf, poolAt, poolPos, slotAt, slotPos } from './board-geom';
import type { BoardGeom } from './board-geom';
import type { ScreenLayout } from './layout';
import type { Action, GameState } from './state';
import { NO_DRAG } from './render';
import type { DragView } from './render';
import type { PointerEvent } from './deps';

export interface PointerWorld {
  readonly juice: Juice;
  state(): GameState;
  view(): ScreenLayout;
  dispatch(action: Action): void;
  /** `.ui` 组件点击（game.ts 提供：映射表 + 广告异步流程） */
  uiTap(x: number, y: number): boolean;
  /** 选关命中（未解锁返回 null） */
  selectHit(x: number, y: number): number | null;
  onGrab(): void;
  onPlace(): void;
  onReject(): void;
  onLevelStart(levelId: number): void;
  unlockAudio(): void;
}

export interface Pointer {
  handle(event: PointerEvent): void;
  /** 拖拽中的色块视图（渲染用） */
  dragView(): DragView;
}

export const createPointer = (world: PointerWorld): Pointer => {
  let dnd: DnD = IDLE_DND;
  let plateGrab: { dx: number; dy: number } | null = null;

  const geom = (): BoardGeom | null => {
    const area = world.view().rects['boardArea'];
    if (area === undefined) return null;
    const state = world.state();
    const spawn = state.pieces.filter((p) => p.loc.t === 'spawn').length;
    return boardGeomOf(area, spawn, state.tempSlots);
  };

  const dragView = (): DragView => {
    if (dnd.pieceId === null) return NO_DRAG;
    const state = world.state();
    const piece = state.pieces.find((p) => p.id === dnd.pieceId);
    const g = geom();
    if (piece === undefined || g === null) return NO_DRAG;
    return { id: piece.id, pos: dragPos(dnd), size: piece.loc.t === 'temp' ? g.slotCell : g.poolCell, color: piece.color };
  };

  /** ② 跟手高亮：只有「同色 + 还没归位」的格才亮（异色不响应，免得误导） */
  const updateHighlight = (x: number, y: number): void => {
    if (dnd.pieceId === null) return;
    const state = world.state();
    const g = geom();
    const piece = state.pieces.find((p) => p.id === dnd.pieceId);
    if (g === null || piece === undefined) return;
    const gi = gridAt(g, x, y);
    const taken = gi !== null && state.pieces.some((p) => p.id !== piece.id && p.loc.t === 'grid' && p.loc.i === gi);
    world.juice.dragTo(gi === null ? -1 : gi, gi !== null && state.grid[gi] === piece.color && !taken);
  };

  /** ④ 落位失败：残影从释放点弹回该块在池子里的新位置（`back` 曲线由 juice 算） */
  const rebound = (id: number, gi: number, from: { x: number; y: number }): void => {
    const state = world.state();
    const g = geom();
    const piece = state.pieces.find((p) => p.id === id);
    if (g === null || piece === undefined) return;
    const k = state.pieces.filter((p) => p.loc.t === 'spawn').findIndex((p) => p.id === id);
    const to = k >= 0 ? poolPos(g, k) : null;
    world.juice.reject(gi, from, { x: to?.x ?? from.x, y: to?.y ?? from.y }, to?.s ?? g.poolCell, piece.color);
  };

  /** 盘面按下：先临时位、再色块池（几何与 render 同源） */
  const boardDown = (x: number, y: number): void => {
    const g = geom();
    if (g === null) return;
    const state = world.state();
    const slotHit = slotAt(g, state.tempSlots, x, y);
    if (slotHit !== null) {
      const inSlot = state.pieces.find((p) => p.loc.t === 'temp' && p.loc.k === slotHit);
      if (inSlot !== undefined) {
        const pos = slotPos(g, slotHit);
        dnd = grab(dnd, inSlot.id, x, y, pos.x, pos.y);
        world.juice.grab(inSlot.color);
        world.onGrab();
      }
      return;
    }
    const spawn = state.pieces.filter((p) => p.loc.t === 'spawn');
    const k = poolAt(g, spawn.length, x, y);
    if (k === null) return;
    const piece = spawn[k];
    if (piece === undefined) return;
    const pos = poolPos(g, k);
    dnd = grab(dnd, piece.id, x, y, pos.x, pos.y);
    world.juice.grab(piece.color);
    world.onGrab();
  };

  /** 盘面松手：命中格 → reduce；没命中 → 弹回 */
  const boardUp = (x: number, y: number): void => {
    if (dnd.pieceId === null) {
      world.uiTap(x, y);
      return;
    }
    const id = dnd.pieceId;
    const from = dragPos(dnd) ?? { x, y };
    dnd = drop(dnd);
    const g = geom();
    if (g === null) {
      world.juice.endDrag();
      return;
    }
    const gi = gridAt(g, x, y);
    if (gi !== null) {
      world.dispatch({ kind: 'drop', pieceId: id, target: { t: 'grid', i: gi } });
      const after = world.state().pieces.find((p) => p.id === id);
      if (after?.placed === true) {
        world.juice.place(gi);
        world.onPlace();
      } else {
        rebound(id, gi, from);
        world.onReject();
      }
      return;
    }
    const k = slotAt(g, world.state().tempSlots, x, y);
    if (k !== null) {
      world.dispatch({ kind: 'drop', pieceId: id, target: { t: 'temp', k } });
      world.juice.endDrag();
      return;
    }
    rebound(id, -1, from);
    world.onReject();
  };

  const ironDown = (x: number, y: number): void => {
    world.dispatch({ kind: 'ironHeat', on: true }); // 按住即加热
    const area = world.view().rects['boardArea'];
    if (area === undefined) return;
    const g = ironGeomOf(area);
    const p = world.state().iron.plate;
    const px = g.bx + p.gx * g.cell;
    const py = g.by + p.gy * g.cell;
    if (x >= px && x <= px + PLATE_CELLS * g.cell && y >= py && y <= py + PLATE_CELLS * g.cell) {
      plateGrab = { dx: (x - px) / g.cell, dy: (y - py) / g.cell };
    }
  };

  return {
    dragView,
    handle(event: PointerEvent): void {
      const { x, y } = event.pointer;
      const state = world.state();
      if (event.kind === 'down') {
        world.unlockAudio();
        if (state.screen === 'board') boardDown(x, y);
        else if (state.screen === 'iron') ironDown(x, y);
        return;
      }
      if (event.kind === 'move') {
        if (dnd.pieceId !== null) {
          dnd = dragTo(dnd, x, y);
          updateHighlight(x, y);
        }
        if (state.screen === 'iron' && plateGrab !== null) {
          const area = world.view().rects['boardArea'];
          if (area !== undefined) {
            const g = ironGeomOf(area);
            world.dispatch({ kind: 'ironMove', gx: (x - g.bx) / g.cell - plateGrab.dx, gy: (y - g.by) / g.cell - plateGrab.dy });
          }
        }
        return;
      }
      if (state.screen === 'board') {
        boardUp(x, y);
        return;
      }
      if (state.screen === 'iron') {
        world.dispatch({ kind: 'ironHeat', on: false });
        plateGrab = null;
        world.uiTap(x, y);
        return;
      }
      if (state.screen === 'select') {
        const levelId = world.selectHit(x, y);
        if (levelId !== null) {
          world.onLevelStart(levelId);
          return;
        }
      }
      world.uiTap(x, y);
    },
  };
};
