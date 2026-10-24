/**
 * 安全区换算（微信 / 抖音共用）。
 *
 * 为什么单独一个文件：两个小游戏平台的 `getSystemInfoSync().safeArea` 形状相同、
 * 四边换算规则也相同。「顶部到安全区上沿、底部到安全区下沿」这种方向最容易写错，
 * 只实现一份才不会两边漂。web 走 CSS `env(safe-area-inset-*)`，不用这个文件。
 *
 * 规则（写死，别自己发挥）：
 * ```
 * top    = safeArea.top
 * left   = safeArea.left
 * right  = 屏宽 - (safeArea.left + safeArea.width)
 * bottom = 屏高 - (safeArea.top + safeArea.height)
 * ```
 *
 * 兜底：
 * - `safeArea` 缺失（老基础库 / 部分 Android）→ 四边全 0；
 * - 任一字段非有限值 → 整体退化成全 0（数据不可信时不要半对半错）；
 * - **任何情况不产出 NaN / 负数**：安全区比屏幕大时 right/bottom 会算成负数，钳成 0。
 */

import { ZERO_INSETS } from './contract';
import type { Insets } from './contract';

/** 安全区矩形（与 wx / tt 的 `safeArea` 字段同形）。 */
export interface SafeAreaRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** 屏幕尺寸（与 wx / tt 的 screenWidth / screenHeight 同义）。 */
export interface ScreenBox {
  readonly width: number;
  readonly height: number;
}

/** 非有限值 / 负数 → 0。布局拿到 NaN 或负内缩就是灾难，宁可退成 0。 */
export const clampInset = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

/** 从「屏幕尺寸 + 安全区矩形」算四边内缩。 */
export const insetsFromSafeArea = (screen: ScreenBox, area: SafeAreaRect | undefined): Insets => {
  if (area === undefined) return ZERO_INSETS;
  const fields = [screen.width, screen.height, area.top, area.left, area.width, area.height];
  if (!fields.every((value) => Number.isFinite(value))) return ZERO_INSETS;
  return {
    top: clampInset(area.top),
    left: clampInset(area.left),
    right: clampInset(screen.width - (area.left + area.width)),
    bottom: clampInset(screen.height - (area.top + area.height)),
  };
};
