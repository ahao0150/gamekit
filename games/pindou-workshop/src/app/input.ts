/**
 * 拖拽状态机（纯函数，不碰 canvas / 平台）。
 * pointer 事件由 game.ts 喂入；DnD 只记录「抓着谁、指针在哪」，落点判定在 reduce。
 */

export interface DnD {
  /** 抓住的色块 id；null = 空手 */
  readonly pieceId: number | null;
  /** 指针逻辑坐标 */
  readonly x: number;
  readonly y: number;
  /** 抓取点到色块锚点的偏移（保持抓取手感） */
  readonly dx: number;
  readonly dy: number;
}

export const IDLE_DND: DnD = { pieceId: null, x: 0, y: 0, dx: 0, dy: 0 };

export const grab = (s: DnD, pieceId: number, px: number, py: number, anchorX: number, anchorY: number): DnD => ({
  pieceId, x: px, y: py, dx: px - anchorX, dy: py - anchorY,
});

export const dragTo = (s: DnD, px: number, py: number): DnD => ({ ...s, x: px, y: py });

export const drop = (s: DnD): DnD => IDLE_DND;

/** 色块当前应绘制的锚点（拖拽中跟随指针，否则返回 null 由布局定位） */
export const dragPos = (s: DnD): { readonly x: number; readonly y: number } | null =>
  s.pieceId === null ? null : { x: s.x - s.dx, y: s.y - s.dy };
