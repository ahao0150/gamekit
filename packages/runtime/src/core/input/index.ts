/**
 * 输入归一化实现。
 *
 * 所有状态都在闭包里（每个 createInput 一份），没有模块级变量。
 * 位移阈值基于设计坐标判定，不受 dpr / fit 影响。
 */

import type { PlatformAdapter, PointerEvent } from '../../platform/contract';
import type {
  CreateDesignMapping,
  CreateInput,
  DesignMapping,
  DragEvent,
  Input,
  InputOptions,
  TapEvent,
} from './contract';

const IDENTITY: DesignMapping = { scaleX: 1, scaleY: 1, originX: 0, originY: 0 };

interface Tracker {
  readonly startX: number;
  readonly startY: number;
  readonly startTime: number;
  x: number;
  y: number;
  /** 是否已升级为拖拽 */
  moved: boolean;
}

/** 纯函数：屏幕逻辑坐标 → 设计坐标。 */
export const createDesignMapping: CreateDesignMapping = (screen, design, fit = 'contain') => {
  const scaleX = design.width > 0 ? screen.width / design.width : 1;
  const scaleY = design.height > 0 ? screen.height / design.height : 1;
  let scale = Math.min(scaleX, scaleY);
  if (fit === 'height') scale = scaleY;
  else if (fit === 'width') scale = scaleX;
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  return {
    scaleX: scale,
    scaleY: scale,
    originX: (screen.width - design.width * scale) / 2,
    originY: (screen.height - design.height * scale) / 2,
  };
};

export const createInput: CreateInput = (platform: PlatformAdapter, opts?: InputOptions): Input => {
  const mapping: DesignMapping = opts?.mapping ?? IDENTITY;
  const tapMaxMove = opts?.tapMaxMove ?? 12;
  const tapMaxDuration = opts?.tapMaxDuration ?? 400;

  const tapListeners = new Set<(e: TapEvent) => void>();
  const dragListeners = new Set<(e: DragEvent) => void>();
  const trackers = new Map<number, Tracker>();
  let disposed = false;

  const toDesign = (x: number, y: number): { x: number; y: number } => ({
    x: (x - mapping.originX) / mapping.scaleX,
    y: (y - mapping.originY) / mapping.scaleY,
  });

  const emitTap = (e: TapEvent): void => {
    for (const cb of [...tapListeners]) cb(e);
  };

  const emitDrag = (e: DragEvent): void => {
    for (const cb of [...dragListeners]) cb(e);
  };

  const dragEvent = (t: Tracker, id: number, phase: DragEvent['phase']): DragEvent => ({
    id,
    phase,
    x: t.x,
    y: t.y,
    startX: t.startX,
    startY: t.startY,
    dx: t.x - t.startX,
    dy: t.y - t.startY,
  });

  const handle = (e: PointerEvent): void => {
    if (disposed) return;
    const id = e.pointer.id;
    const p = toDesign(e.pointer.x, e.pointer.y);

    if (e.kind === 'down') {
      trackers.set(id, {
        startX: p.x,
        startY: p.y,
        startTime: e.time,
        x: p.x,
        y: p.y,
        moved: false,
      });
      return;
    }

    const t = trackers.get(id);
    if (!t) return; // 没收到 down 的 move / up（跨屏、平台丢事件），忽略

    if (e.kind === 'move') {
      t.x = p.x;
      t.y = p.y;
      if (!t.moved) {
        const dist = Math.hypot(p.x - t.startX, p.y - t.startY);
        if (dist >= tapMaxMove) {
          t.moved = true;
          emitDrag(dragEvent(t, id, 'start'));
        }
        return;
      }
      emitDrag(dragEvent(t, id, 'move'));
      return;
    }

    // up / cancel：有些平台只在抬起时给出最终位置，这里补一次位移判定
    t.x = p.x;
    t.y = p.y;
    if (!t.moved && Math.hypot(p.x - t.startX, p.y - t.startY) >= tapMaxMove) {
      t.moved = true;
      emitDrag(dragEvent(t, id, 'start'));
    }
    trackers.delete(id);
    if (t.moved) {
      emitDrag(dragEvent(t, id, 'end'));
      return;
    }
    if (e.kind !== 'up') return; // cancel 且没拖过：什么都不发
    const duration = e.time - t.startTime;
    if (duration < tapMaxDuration) {
      emitTap({ id, x: p.x, y: p.y, duration });
    }
  };

  const unsubscribe = platform.onPointer(handle);

  return {
    onTap(cb: (e: TapEvent) => void): () => void {
      tapListeners.add(cb);
      return () => {
        tapListeners.delete(cb);
      };
    },

    onDrag(cb: (e: DragEvent) => void): () => void {
      dragListeners.add(cb);
      return () => {
        dragListeners.delete(cb);
      };
    },

    isDown(id?: number): boolean {
      if (id === undefined) return trackers.size > 0;
      return trackers.has(id);
    },

    get downCount(): number {
      return trackers.size;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      tapListeners.clear();
      dragListeners.clear();
      trackers.clear();
    },

    handle,
  };
};
