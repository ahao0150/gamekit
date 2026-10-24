/**
 * 背包数据与列表几何（T13d）：纯数据 + 纯函数，不碰 canvas、不碰平台。
 *
 * 为什么单独一层：列表「点第几项」这件事是**几何换算**（手指坐标 + 列表矩形 +
 * 滚动偏移 → 下标），不是 UI 也不是状态迁移。放在这里能脱离浏览器逐条断言，
 * 也让 `game.ts` 只负责把事件接起来。
 *
 * T35：`itemIndexAt` 的公式**不再自己实现**，改成 core `listIndexAt` 的薄转调 ——
 * 同一件事（点第几项）只留一份几何，`list` 组件怎么画、这里就怎么算。
 *
 * 数据是**假数据**（20 件）：验的是「通用组件能接进游戏」，不是玩法。
 */

import { listIndexAt } from './deps';

/** 一件物品。 */
export interface InventoryItem {
  readonly id: number;
  /** 显示名（列表里画这个） */
  readonly name: string;
  /** 数量（列表右侧显示） */
  readonly count: number;
}

/** 单项高（逻辑像素）：与 `inventory.ui` 里 `itemH=56` 必须一致。 */
export const ITEM_H = 56;
/** 项间距：0（列表自带分割线，不需要额外空隙）。 */
export const ITEM_GAP = 0;

/** 20 件假物品：名字带序号，方便验收时肉眼确认「点的是第几项」。 */
export const ITEMS: readonly InventoryItem[] = Array.from({ length: 20 }, (_unused, index) => ({
  id: index + 1,
  name: `物品 ${String(index + 1).padStart(2, '0')}`,
  count: ((index * 7) % 13) + 1,
}));

/** 列表内容总高（含项间 gap，不含末尾 gap）——与 `list-window.ts` 同一口径。 */
export const contentHeight = (): number => ITEMS.length * ITEM_H + Math.max(0, ITEMS.length - 1) * ITEM_GAP;

/**
 * 手指落在列表视口里的 `y` → 物品下标（不在列表里返回 null）。
 *
 * **转调 core 的 `listIndexAt`**：几何换算只有一份实现（`core/ui/item-hit.ts`），
 * 这里不再复写 `floor((y - top + scroll) / pitch)`。传一个足够大的矩形当容器，
 * 因为调用方（`game.ts`）已经用 `pickHit` 保证点落在列表里了；
 * 这条薄包装保留是为了既有调用签名与测试不变。
 */
export const itemIndexAt = (y: number, listTop: number, scrollTop: number): number | null => {
  if (!Number.isFinite(y) || !Number.isFinite(listTop)) return null;
  const rect = { x: 0, y: listTop, w: Number.MAX_SAFE_INTEGER, h: Number.MAX_SAFE_INTEGER };
  return listIndexAt({ x: 0, y }, rect, scrollTop, {
    itemH: ITEM_H,
    gap: ITEM_GAP,
    count: ITEMS.length,
  });
};

/** 滚动条要画的比例（`scrollbar` 组件的 `value` / `viewport` 两个参数）。 */
export interface ScrollRatios {
  /** 当前滚动位占「可滚动距离」的比例（0..1） */
  readonly value: number;
  /** 可视高度占内容总高的比例（0..1） */
  readonly viewport: number;
}

/**
 * 算滚动条比例。
 *
 * 内容装得下（`viewHeight >= contentHeight`）时 `viewport = 1` —— `scrollbar`
 * 组件看到 1 会自动不画（没有滚动就不该有滚动条）。
 */
export const scrollRatios = (contentHeightPx: number, viewHeight: number, offset: number): ScrollRatios => {
  const content = Number.isFinite(contentHeightPx) && contentHeightPx > 0 ? contentHeightPx : 0;
  const view = Number.isFinite(viewHeight) && viewHeight > 0 ? viewHeight : 0;
  if (content <= 0 || view <= 0) return { value: 0, viewport: 1 };
  const maxOffset = Math.max(0, content - view);
  const viewport = Math.min(1, view / content);
  if (maxOffset <= 0) return { value: 0, viewport };
  const safeOffset = Number.isFinite(offset) ? Math.min(Math.max(offset, 0), maxOffset) : 0;
  return { value: safeOffset / maxOffset, viewport };
};

/** 选中的物品（下标非法时返回 null，不抛错）。 */
export const itemAt = (index: number | null): InventoryItem | null => {
  if (index === null || !Number.isFinite(index)) return null;
  const item = ITEMS[Math.floor(index)];
  return item ?? null;
};
