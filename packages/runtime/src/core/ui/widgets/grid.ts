/**
 * 通用组件：网格（T31，虚拟行渲染 + 实渲染两种模式）。
 *
 * 与 `list` 的分工：`list` 是一维列表（每项占满宽），`grid` 是二维网格
 * （每行 `cols` 个等宽单元格）。两者共用同一套滚动口径（`gridWindow` 内部
 * 复用 `listWindow` 的 clamp / floor / ceil 语义），所以同一个 `scrollTop`
 * 在列表和网格里滚到的位置是一致的。
 *
 * 边界（写死，别扩散）：
 * 1. **数据从 `DrawDeps.data` 拿**：`items` 是只读数组，可选 `renderItem` 由游戏注入，
 *    组件不 import 任何游戏代码；
 * 2. 组件只画**每个单元格的底色**，内容交给 `renderItem`；没有 `renderItem` 就只画底色；
 * 3. `virtual: true`（默认）只画可见行，一千项不会每帧遍历一千项；
 *    `virtual: false` 全画，用于数据量小的场景，也是两条路径的对照；
 * 4. **必须 clip 到自己的 box**：部分可见的行会整行画出来（含溢出容器的那一段），
 *    不裁就盖住上下相邻区域，滚动时表现为「容器上半边在抖」——`list` 就是这么修的；
 * 5. 最后一行不满时 `index >= count` 直接跳过，不画空格子。
 */

import type { Ctx2D } from '../../../platform/contract';
import type { Rect } from '../contract';
import type { DefinedComponent, DrawDeps, UiData } from '../components';
import { boolProp, defineComponent, numberProp, stringProp } from '../components';
import type { StyleProps } from '../layout-spec';
import { drawCenteredText, fillRect } from '../builtin-draw';
import { gridWindow } from '../grid-window';
import { readList } from './data-read';
import type { ListRenderItem } from './list';

/** 默认列数：4 列在 390 宽上每格约 90px，手指好点。 */
const DEFAULT_COLS = 4;
/** 默认单元格高。 */
const DEFAULT_CELL_H = 56;
/** 默认间距。 */
const DEFAULT_GAP = 8;

/** 读游戏数据里的 `items`；不是数组就当空网格（不崩）。 */
const readItems = (data: UiData | undefined): readonly unknown[] => readList(data, 'items');

/** 读游戏数据里的 `renderItem`；不是函数就当没有。 */
const readRenderItem = (data: UiData | undefined): ListRenderItem | null => {
  const raw: unknown = data?.renderItem;
  return typeof raw === 'function' ? (raw as unknown as ListRenderItem) : null;
};

/** 列数：至少 1（0 列没有「格子」这回事）。 */
const colsOf = (props: StyleProps): number => Math.max(1, Math.floor(numberProp(props, 'cols', DEFAULT_COLS)));

/** 单元格宽：`(box.w - gapX × (cols - 1)) / cols`。 */
export const cellWidth = (boxWidth: number, cols: number, gapX: number): number => {
  const safeCols = Math.max(1, Math.floor(Number.isFinite(cols) ? cols : 1));
  const safeGap = Number.isFinite(gapX) && gapX > 0 ? gapX : 0;
  const width = Number.isFinite(boxWidth) ? boxWidth : 0;
  return (width - safeGap * (safeCols - 1)) / safeCols;
};

export const grid: DefinedComponent = defineComponent('grid', {
  props: {
    cols: 'number',
    cellH: 'number',
    gapX: 'number',
    gapY: 'number',
    scrollTop: 'number',
    virtual: 'boolean',
    itemColor: 'string',
    emptyText: 'string',
  },
  defaultSize: { w: 320, h: 240 },
  // 尺寸由外层 `size fill` 决定，这里回显可用框（auto 时才被调用）
  measure: (_env, box) => ({ w: box.w, h: box.h }),
  draw: (ctx, box, props, deps: DrawDeps) => {
    const cols = colsOf(props);
    const cellH = numberProp(props, 'cellH', DEFAULT_CELL_H);
    const gapX = Math.max(0, numberProp(props, 'gapX', DEFAULT_GAP));
    const gapY = Math.max(0, numberProp(props, 'gapY', DEFAULT_GAP));
    const virtual = boolProp(props, 'virtual', true);
    const itemColor = stringProp(props, 'itemColor', deps.theme.panel);
    if (!(cellH > 0) || !(box.h > 0) || !(box.w > 0)) return;

    const cellW = cellWidth(box.w, cols, gapX);
    if (!(cellW > 0)) return;

    // 裁到自己的 box（与 list 同一口径）：溢出容器的部分不画。
    // `save` / `restore` 必须配对，否则 clip 会永久生效、影响后续所有组件。
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();

    const items = readItems(deps.data);
    if (items.length === 0) {
      drawCenteredText(ctx, box, stringProp(props, 'emptyText', ''), deps.theme.disabled, deps.theme.fontFamily);
      ctx.restore();
      return;
    }

    const pitch = cellH + gapY;
    const rawScrollTop = numberProp(props, 'scrollTop', 0);
    const win = gridWindow({ scrollTop: rawScrollTop, count: items.length, cols, cellH, gapY, viewH: box.h });
    // 两种模式共用同一坐标系（同一 clamped 滚动位），只有「画几行」不同
    const scrolled = Math.min(Math.max(rawScrollTop, 0), Math.max(0, win.totalH - box.h));
    const top = box.y - scrolled;
    const renderItem = readRenderItem(deps.data);
    const rows = Math.ceil(items.length / cols);
    const firstRow = virtual ? win.rowStart : 0;
    const lastRow = virtual ? win.rowEnd : rows;

    for (let row = firstRow; row < lastRow; row += 1) {
      const y = top + row * pitch;
      // 虚拟模式多带的那 1 行（gap 区取整）完全在视口外：不画，省掉整行工作
      if (virtual && (y + cellH <= box.y || y >= box.y + box.h)) continue;
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        // 最后一行不满：跳过，不画空格子
        if (index >= items.length) break;
        const cellRect: Rect = { x: box.x + col * (cellW + gapX), y, w: cellW, h: cellH };
        fillRect(ctx, cellRect, itemColor);
        if (renderItem !== null) renderItem(ctx, items[index], cellRect, index);
      }
    }

    ctx.restore();
  },
  assert: (box, props: StyleProps) => {
    const issues: string[] = [];
    const cols = colsOf(props);
    const cellH = numberProp(props, 'cellH', DEFAULT_CELL_H);
    const gapX = Math.max(0, numberProp(props, 'gapX', DEFAULT_GAP));
    const gapY = Math.max(0, numberProp(props, 'gapY', DEFAULT_GAP));
    if (!(cellH > 0)) issues.push(`cellH 必须大于 0，收到 ${cellH}（网格会什么都不画）`);
    if (gapX < 0 || gapY < 0) issues.push(`gapX / gapY 不能是负数，收到 ${gapX} / ${gapY}（绘制时按 0 处理）`);
    const cellW = cellWidth(box.w, cols, gapX);
    if (!(cellW > 0)) issues.push(`列数 ${cols} 太密：可用宽 ${box.w}px - ${gapX}×${cols - 1}px 间距后每格 ${cellW.toFixed(1)}px`);
    if (box.h < cellH) issues.push(`网格视口高 ${box.h}px 装不下一行（cellH=${cellH}）`);
    return issues;
  },
});
