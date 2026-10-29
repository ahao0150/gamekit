/**
 * 通用组件：列表（T16，虚拟渲染 + 实渲染两种模式）。
 *
 * 边界（写死，别扩散）：
 * 1. **数据从 `DrawDeps.data` 拿**：`items` 是只读数组，可选 `renderItem` 由游戏注入——
 *    组件不 import 任何游戏代码（AGENTS §7）；
 * 2. 组件只画**每项的背景块 + 分割线**，内容交给 `renderItem`；没有 `renderItem` 就只画背景；
 * 3. `virtual: true`（默认）用 `listWindow()` 只画可见项，长列表不会每帧遍历一万项；
 *    `virtual: false` 全画，用于数据量小的场景，也是两条路径的对照。
 */

import type { Ctx2D } from '../../../platform/contract';
import type { Rect } from '../contract';
import type { DefinedComponent, DrawDeps, UiData } from '../components';
import { boolProp, defineComponent, numberProp, stringProp } from '../components';
import type { StyleProps } from '../layout-spec';
import { drawCenteredText, fillRect } from '../builtin-draw';
import { listWindow } from '../list-window';
import { buildVariableIndex, variableWindow } from '../variable-window';

/** 单项绘制回调：游戏侧注入，组件只负责算好矩形。 */
export type ListRenderItem = (ctx: Ctx2D, item: unknown, rect: Rect, index: number) => void;

const DEFAULT_ITEM_H = 56;
/** 分割线厚度（像素）。 */
const DIVIDER_H = 1;

/** 读游戏数据里的 `items`；不是数组就当空列表（不崩）。 */
const readItems = (data: UiData | undefined): readonly unknown[] => {
  const raw: unknown = data?.items;
  return Array.isArray(raw) ? (raw as readonly unknown[]) : [];
};

/** 读游戏数据里的 `renderItem`；不是函数就当没有。 */
const readRenderItem = (data: UiData | undefined): ListRenderItem | null => {
  const raw: unknown = data?.renderItem;
  return typeof raw === 'function' ? (raw as unknown as ListRenderItem) : null;
};

/**
 * 读变高通道 `data.itemHeights`。没有就返回 `null`（走原来的定高路径，旧界面零改动）。
 *
 * 长度必须与 `items` 一一对应：**不匹配直接抛**，不许静默按短的画 ——
 * 那样每一项都会错位到别的数据上，症状是「点 A 打开 B」，比空白更难查。
 */
const readItemHeights = (data: UiData | undefined, itemCount: number): readonly number[] | null => {
  const raw: unknown = data?.itemHeights;
  if (!Array.isArray(raw)) return null;
  const heights = raw as readonly number[];
  if (heights.length !== itemCount) {
    throw new Error(
      `list: data.itemHeights 长度 ${heights.length} 与 items 长度 ${itemCount} 不一致。`
      + '每项都要有一个高度，用 core/render 的 measureItemHeights(items, width, opts) 算。',
    );
  }
  return heights;
};

/** 有效滚动位（钳到 [0, totalH - viewH]；NaN 当 0）。 */
const clampScroll = (scrollTop: number, totalH: number, viewH: number): number => {
  if (!Number.isFinite(scrollTop)) return 0;
  return Math.min(Math.max(scrollTop, 0), Math.max(0, totalH - viewH));
};

export const list: DefinedComponent = defineComponent('list', {
  props: {
    itemH: 'number',
    gap: 'number',
    scrollTop: 'number',
    virtual: 'boolean',
    divider: 'boolean',
    itemColor: 'string',
    dividerColor: 'string',
    emptyText: 'string',
  },
  defaultSize: { w: 296, h: 320 },
  // 高度由外层 `size fill` 决定，这里回显可用框（auto 时才被调用）
  measure: (_env, box) => ({ w: box.w, h: box.h }),
  draw: (ctx, box, props, deps: DrawDeps) => {
    const itemH = numberProp(props, 'itemH', DEFAULT_ITEM_H);
    const gap = Math.max(0, numberProp(props, 'gap', 0));
    const virtual = boolProp(props, 'virtual', true);
    const divider = boolProp(props, 'divider', false);
    const itemColor = stringProp(props, 'itemColor', deps.theme.panel);
    const dividerColor = stringProp(props, 'dividerColor', deps.theme.gridLine);
    if (!(box.h > 0) || !(box.w > 0)) return;

    const items = readItems(deps.data);
    if (items.length === 0) {
      drawCenteredText(ctx, box, stringProp(props, 'emptyText', ''), deps.theme.disabled, deps.theme.fontFamily);
      return;
    }

    // 变高通道优先：给了 itemHeights 就用每项自己的高度，`itemH` 不再参与定位
    const heights = readItemHeights(deps.data, items.length);
    if (heights === null && !(itemH > 0)) return;

    // 裁到自己的 box（T31 修）：
    // 部分可见的项会**整块**画出来（含溢出容器的那一段），不裁就盖住上下相邻区域。
    // 滚动时溢出高度逐帧变化 → 视觉上表现为「列表容器上半边在抖」。
    // `carousel` 一直有 clip，`list` 漏了；`ctx.save/restore` 必须配对，
    // 否则 clip 会永久生效并影响后续所有组件。
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();

    const pitch = itemH + gap;
    const win = listWindow({
      scrollTop: numberProp(props, 'scrollTop', 0),
      count: items.length,
      itemH,
      gap,
      viewH: box.h,
    });
    const renderItem = readRenderItem(deps.data);
    const scrollTop = numberProp(props, 'scrollTop', 0);

    if (heights === null) {
      // —— 定高路径（原样保留，旧界面零改动）——
      // 两种模式共用同一坐标系（同一 clamped 滚动位），只有「画几项」不同
      const scrolled = clampScroll(scrollTop, win.totalH, box.h);
      const top = box.y - scrolled;
      const first = virtual ? win.start : 0;
      const last = virtual ? win.end : items.length;

      for (let index = first; index < last; index += 1) {
        const y = top + index * pitch;
        // 虚拟模式多带的那 1 项（gap 区取整）完全在视口外：不画，省一次 fillRect。
        // 实渲染模式故意不跳（它的语义就是「全部画」，让 canvas 裁）。
        if (virtual && (y + itemH <= box.y || y >= box.y + box.h)) continue;
        const itemRect: Rect = { x: box.x, y, w: box.w, h: itemH };
        fillRect(ctx, itemRect, itemColor);
        if (divider && index < items.length - 1) {
          fillRect(ctx, { x: box.x, y: y + itemH - DIVIDER_H, w: box.w, h: DIVIDER_H }, dividerColor);
        }
        if (renderItem !== null) renderItem(ctx, items[index], itemRect, index);
      }
      ctx.restore();
      return;
    }

    // —— 变高路径：前缀和 + 二分定位，不遍历全部项 ——
    const index = buildVariableIndex(heights, gap);
    const vwin = variableWindow(index, scrollTop, box.h);
    const vScrolled = clampScroll(scrollTop, vwin.totalH, box.h);
    const vTop = box.y - vScrolled;
    const vFirst = virtual ? vwin.start : 0;
    const vLast = virtual ? vwin.end : items.length;

    for (let i = vFirst; i < vLast; i += 1) {
      const y = vTop + (index.offsets[i] as number);
      const h = index.heights[i] as number;
      if (h <= 0) continue; // 空项：不画背景块，也不给它分割线
      if (virtual && (y + h <= box.y || y >= box.y + box.h)) continue;
      const itemRect: Rect = { x: box.x, y, w: box.w, h };
      fillRect(ctx, itemRect, itemColor);
      if (divider && i < items.length - 1) {
        fillRect(ctx, { x: box.x, y: y + h - DIVIDER_H, w: box.w, h: DIVIDER_H }, dividerColor);
      }
      if (renderItem !== null) renderItem(ctx, items[i], itemRect, i);
    }
    ctx.restore();
  },
  assert: (box, props: StyleProps) => {
    const issues: string[] = [];
    const itemH = numberProp(props, 'itemH', DEFAULT_ITEM_H);
    const gap = numberProp(props, 'gap', 0);
    if (!(itemH > 0)) issues.push(`itemH 必须大于 0，收到 ${itemH}（列表会什么都不画）`);
    if (gap < 0) issues.push(`gap 不能是负数，收到 ${gap}（绘制时按 0 处理）`);
    if (box.h < itemH) issues.push(`列表视口高 ${box.h}px 装不下一项（itemH=${itemH}）`);
    return issues;
  },
});
