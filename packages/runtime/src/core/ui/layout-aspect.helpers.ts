/**
 * `aspect` 测试共用的容器构造（**不是测试文件**，不进 vitest 收集）。
 *
 * 容器用 `overlay + at + size` 精确造出来，这样断言不依赖视口尺寸；
 * 注意 `at` 的 `size` 超视口会被钳，所以容器的宽必须 ≤ 390、高 ≤ 844。
 */

import { fileURLToPath } from 'node:url';
import { layout } from './layout';
import type { Align, Justify, LayoutResult, LayoutSpec, NodeSpec } from './layout';

export const VIEW = { width: 390, height: 844 };
export const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));

/** 造一个 `w × h` 的容器（左上角落在 0,0）。 */
export const box = (
  w: number,
  h: number,
  direction: 'row' | 'column',
  align: Align,
  children: readonly NodeSpec[],
  justify?: Justify,
): LayoutSpec => ({
  regions: [
    {
      name: 'box',
      edge: 'fill',
      layer: 'overlay',
      at: { x: w / 2, y: h / 2 },
      size: { w, h },
      node: { stack: { direction, align, ...(justify === undefined ? {} : { justify }), children } },
    },
  ],
});

/** 在 `w × h` 容器里跑一次布局。 */
export const solve = (
  w: number,
  h: number,
  direction: 'row' | 'column',
  align: Align,
  children: readonly NodeSpec[],
  justify?: Justify,
): LayoutResult => layout(box(w, h, direction, align, children, justify), VIEW);

/** 取命名 rect；不存在直接失败（避免断言悄悄跳过）。 */
export const rectOf = (result: LayoutResult, name: string) => {
  const rect = result.rects[name];
  if (rect === undefined) throw new Error(`没有算出 ${name} 的矩形：${result.errors.join('; ')}`);
  return rect;
};
