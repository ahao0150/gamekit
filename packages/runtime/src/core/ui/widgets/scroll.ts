/**
 * 通用组件：滑动容器（T31）。
 *
 * `.ui` 是**扁平布局、没有嵌套**，所以「容器里装任意内容」只能靠回调：
 * 组件负责裁剪 + 偏移，内容由游戏在 `renderContent` 里画。这跟 `list` / `grid`
 * 把「每项内容」交给 `renderItem` 是同一个套路，只是粒度从「一项」升到「整块」。
 *
 * 行为（写死）：
 * - 有 `bgColor` 就先填底色（没有 `renderContent` 时容器不至于透明看不见）；
 * - `ctx.save() → clip 到 box → translate(0, -scrollTop) → renderContent → restore()`；
 * - **`renderContent` 收到的 `box` 是原始坐标**（即 `y - scrollTop` 之前的值），
 *   游戏按「内容坐标系」画：内容从 `box.y` 开始、可以画到 `box.y + contentH`；
 * - `scrollTop` 由调用方钳制（组件不做 clamp，这样 `translate` 的值和调用方给的
 *   完全一致，测试可以断言精确值）；传超范围的值也不会崩 —— clip 之后超出部分
 *   根本不会落到屏幕上。
 *
 * 和 `scrollbar` 组件的关系：`scrollbar` 只画滑块（纯绘制、无裁剪），
 * `scroll` 负责内容裁剪与偏移。两者通常一起用，但互不依赖。
 */

import type { Ctx2D } from '../../../platform/contract';
import type { Rect } from '../contract';
import type { DefinedComponent, UiData } from '../components';
import { defineComponent, numberProp, stringProp } from '../components';
import type { StyleProps } from '../layout-spec';
import { fillRect } from '../builtin-draw';

/**
 * 内容绘制回调：游戏在里面按内容坐标系画任意东西。
 *
 * - `ctx`：已经被裁剪 + 平移过的上下文（直接画即可）；
 * - `box`：**原始**矩形（未平移），内容坐标系的原点；
 * - `scrollTop`：当前滚动位（与 props 一致，方便内容自己算可见区间）。
 */
export type ScrollRenderContent = (ctx: Ctx2D, box: Rect, scrollTop: number) => void;

/** 从 data 里读 `renderContent`；不是函数就当没有（只填底色）。 */
export const readRenderContent = (data: UiData | undefined): ScrollRenderContent | null => {
  const raw: unknown = data?.renderContent;
  return typeof raw === 'function' ? (raw as ScrollRenderContent) : null;
};

export const scroll: DefinedComponent = defineComponent('scroll', {
  props: {
    scrollTop: 'number',
    contentH: 'number',
    bgColor: 'string',
  },
  defaultSize: { w: 320, h: 240 },
  // 尺寸由外层 `size fill` 决定，这里回显可用框（auto 时才被调用）
  measure: (_env, box) => ({ w: box.w, h: box.h }),
  draw: (ctx, box, props, deps) => {
    if (!(box.w > 0) || !(box.h > 0)) return;

    const bgColor = stringProp(props, 'bgColor', deps.theme.panel);
    if (bgColor.length > 0) fillRect(ctx, box, bgColor);

    const renderContent = readRenderContent(deps.data);
    if (renderContent === null) return;

    const scrollTop = numberProp(props, 'scrollTop', 0);
    // `-0` 与 `0` 在 canvas 里等价，但在断言/序列化里是两种值：
    // 显式消掉，免得测试要写 `-0`（读日志时也更容易看）。
    const shift = scrollTop === 0 ? 0 : -scrollTop;
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    // 只做纵向偏移：横向滑动不在这个组件的契约里
    ctx.translate(0, shift);
    // box 传**原始**坐标：游戏按内容坐标系画，不用自己减 scrollTop
    renderContent(ctx, box, scrollTop);
    ctx.restore();
  },
  assert: (box, props: StyleProps) => {
    const issues: string[] = [];
    const contentH = numberProp(props, 'contentH', 0);
    const scrollTop = numberProp(props, 'scrollTop', 0);
    if (contentH < 0) issues.push(`contentH 不能是负数，收到 ${contentH}`);
    if (scrollTop < 0) issues.push(`scrollTop 不能是负数，收到 ${scrollTop}（绘制时按原值偏移）`);
    if (contentH > 0 && scrollTop > Math.max(0, contentH - box.h)) {
      issues.push(`scrollTop ${scrollTop} 超过最大滚动位 ${(contentH - box.h).toFixed(1)}（调用方应该先钳制）`);
    }
    if (!(box.h > 0)) issues.push(`scroll 容器高 ${box.h}px 非法`);
    return issues;
  },
});
