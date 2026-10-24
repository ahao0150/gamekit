/**
 * `at` 的矩形求解（v0.6）：任意位置 region。
 *
 * 口径（写进文档，改之前先问）：
 * - `at <x> <y>` 是 region 的**中心点**，不是左上角。这样「角色头顶」「某个坐标」这类
 *   语义直接对应（中心点在角色头顶，矩形自然向四周展开），不需要作者自己减半宽。
 * - 百分比按方向取基数：x 用视口宽、y 用视口高。
 * - **中心点钳制在视口内**：`at 150% -50%` 这种完全跑出视口的写法不会让内容消失，
 *   而是把中心拉回最近的视口边缘（矩形至少有一半可见）。
 * - `size` 大于视口时钳到视口，并往 errors 里放一条提示（不报错——AI 从 ui.check 能看到，
 *   但布局仍然可用）。
 *
 * 纯函数：只读入参、只返回矩形，不碰 canvas、不写全局状态。
 */

import type { Rect } from './contract';
import type { Length } from './layout-spec';
import { resolveLength, round2 } from './layout-geometry';

/** `at` + `size` 的最小输入（RegionSpec 的子集，便于单测直接构造）。 */
export interface AtBox {
  readonly at: { readonly x: Length; readonly y: Length };
  readonly size: { readonly w: Length; readonly h: Length };
}

/**
 * 求 `at` region 的矩形。
 *
 * @param name region 名（错误文案用）
 * @param viewport 内边距后的视口矩形（百分比基数、钳制边界都用它）
 * @param pushError 错误收集回调（布局层直接 push 到 `LayoutResult.errors`）
 */
export const resolveAtRect = (
  name: string,
  box: AtBox,
  viewport: Rect,
  pushError: (message: string) => void,
): Rect => {
  const rawW = resolveLength(box.size.w, viewport.w);
  const rawH = resolveLength(box.size.h, viewport.h);
  const w = Math.min(Math.max(0, rawW), Math.max(0, viewport.w));
  const h = Math.min(Math.max(0, rawH), Math.max(0, viewport.h));
  if (rawW > viewport.w + 0.001 || rawH > viewport.h + 0.001) {
    pushError(
      `region '${name}' 的 size 超出视口：${round2(rawW)}×${round2(rawH)}，已钳到 ${round2(w)}×${round2(h)}`,
    );
  }

  // 中心点钳到视口内：完全跑出视口的 at 也会被拉回边缘，内容不会消失
  const centerX = Math.min(Math.max(resolveLength(box.at.x, viewport.w), 0), Math.max(0, viewport.w));
  const centerY = Math.min(Math.max(resolveLength(box.at.y, viewport.h), 0), Math.max(0, viewport.h));

  return {
    x: round2(viewport.x + centerX - w / 2),
    y: round2(viewport.y + centerY - h / 2),
    w: round2(w),
    h: round2(h),
  };
};
