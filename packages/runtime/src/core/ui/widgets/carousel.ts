/**
 * 通用组件：轮播（carousel，T21，纯绘制）。
 *
 * 状态由游戏传（`index` / `offset`，吸附状态机在 `core/ui/carousel.ts`）。
 * 数据从 `deps.data` 拿：`pages` + 可选 `renderItem(ctx, page, rect, index)`（游戏注入）。
 *
 * 绘制顺序：`save → clip 到自己的框 → 按 offset 平移 → 只画可见页 → restore → 画指示点`。
 * **只画可见页**：100 页也只调 2 次 `renderItem`（横向滑动时最多两页同时可见）。
 */

import type { Ctx2D } from '../../../platform/contract';
import type { Rect } from '../contract';
import type { DefinedComponent, DrawDeps, UiData } from '../components';
import { boolProp, defineComponent, numberProp, stringProp } from '../components';
import type { StyleProps } from '../layout-spec';
import { readList } from './data-read';

/** 单页绘制回调：游戏侧注入，组件只算好矩形。 */
export type CarouselRenderItem = (ctx: Ctx2D, page: unknown, rect: Rect, index: number) => void;

/** 指示点距底边。 */
const INDICATOR_BOTTOM = 4;
/** 当前页指示点的放大倍数。 */
const ACTIVE_SCALE = 1.35;

const readRenderItem = (data: UiData | undefined): CarouselRenderItem | null => {
  const raw: unknown = data?.renderItem;
  return typeof raw === 'function' ? (raw as unknown as CarouselRenderItem) : null;
};

/** index 钳到 [0, count-1]（NaN 当 0）。 */
const clampIndex = (raw: number, count: number): number => {
  const safe = Number.isFinite(raw) ? Math.floor(raw) : 0;
  return Math.min(Math.max(safe, 0), Math.max(0, count - 1));
};

export const carousel: DefinedComponent = defineComponent('carousel', {
  props: {
    index: 'number',
    offset: 'number',
    loop: 'boolean',
    indicator: 'boolean',
    indicatorSize: 'number',
    indicatorGap: 'number',
    indicatorColor: 'string',
    indicatorActiveColor: 'string',
    pageGap: 'number',
  },
  defaultSize: { w: 296, h: 200 },
  measure: (_env, box) => ({ w: box.w, h: box.h }),
  draw: (ctx, box, props: StyleProps, deps: DrawDeps) => {
    if (!(box.w > 0) || !(box.h > 0)) return;
    const pages = readList(deps.data, 'pages');
    if (pages.length === 0) return; // 空数据：零绘制（连指示点都不画）

    const pageGap = Math.max(0, numberProp(props, 'pageGap', 0));
    const pageStep = box.w + pageGap; // 相邻页起点之差
    const index = clampIndex(numberProp(props, 'index', 0), pages.length);
    const offset = numberProp(props, 'offset', 0);
    const render = readRenderItem(deps.data);
    const shift = -(index * pageStep + offset); // 内容整体平移量

    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.translate(shift, 0);
    if (render !== null) {
      for (let i = 0; i < pages.length; i += 1) {
        const contentX = box.x + i * pageStep;
        const screenX = contentX + shift;
        // 只画与框相交的页：100 页也只画 2 页
        if (screenX + box.w <= box.x || screenX >= box.x + box.w) continue;
        render(ctx, pages[i], { x: contentX, y: box.y, w: box.w, h: box.h }, i);
      }
    }
    ctx.restore();

    if (!boolProp(props, 'indicator', true) || pages.length <= 1) return; // 一个点没意义
    const size = Math.max(2, numberProp(props, 'indicatorSize', 6));
    const dotGap = Math.max(0, numberProp(props, 'indicatorGap', 8));
    const total = pages.length * size + (pages.length - 1) * dotGap;
    const startX = box.x + (box.w - total) / 2;
    const cy = box.y + box.h - size / 2 - INDICATOR_BOTTOM;
    const normalColor = stringProp(props, 'indicatorColor', deps.theme.light);
    const activeColor = stringProp(props, 'indicatorActiveColor', deps.theme.primary);
    for (let i = 0; i < pages.length; i += 1) {
      const active = i === index;
      ctx.fillStyle = active ? activeColor : normalColor;
      ctx.beginPath();
      ctx.arc(startX + i * (size + dotGap) + size / 2, cy, (size / 2) * (active ? ACTIVE_SCALE : 1), 0, Math.PI * 2);
      ctx.fill();
    }
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const offset = numberProp(props, 'offset', 0);
    if (Math.abs(offset) > box.w) issues.push(`offset ${offset} 超过一页宽 ${box.w}，吸附时会被钳制`);
    if (box.w <= 0 || box.h <= 0) issues.push(`carousel 尺寸非法：${box.w}×${box.h}`);
    return issues;
  },
});
