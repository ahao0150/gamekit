/**
 * 界面布局：纯函数，输入屏型 + 安全区，输出全部 widget 矩形。
 * 布局错误在单测里枚举屏型断言（含 320×480 与 1000×300 这类极端比例）。
 */
import { computeRect, insetRect, isInside } from './deps';
import type { Insets, Rect, WidgetProps } from './deps';

/** 布局结果，逻辑像素，左上角原点。 */
export interface Layout {
  readonly safe: Rect;
  readonly scoreBar: Rect;
  readonly tapButton: Rect;
  readonly rewardedButton: Rect;
  /** 无 banner 能力时为零矩形 */
  readonly bannerSlot: Rect;
  readonly hintArea: Rect;
}

export interface LayoutInput {
  readonly screen: Rect;
  readonly insets: Insets;
  /** 平台有 `ad-banner` 能力时预留广告位 */
  readonly reserveBanner: boolean;
}

const ZERO: Rect = { x: 0, y: 0, w: 0, h: 0 };
const at = (x: number, y: number): { x: number; y: number } => ({ x, y });
const ratio = (w: number, h: number): WidgetProps['size'] => ({ kind: 'ratio', w, h });

/** 纯函数：算出整个界面。 */
export const computeLayout = (input: LayoutInput): Layout => {
  const safe = insetRect(input.screen, input.insets);
  const bannerSlot = input.reserveBanner
    ? computeRect(safe, {
        anchor: at(0.5, 1), pivot: at(0.5, 1), offset: at(0, -8),
        size: ratio(0.92, 0.1), minSize: at(160, 48), maxSize: at(640, 96),
      })
    : ZERO;
  const scoreBar = computeRect(safe, {
    anchor: at(0, 1), pivot: at(0, 1), offset: at(16, -(bannerSlot.h + 16)),
    size: ratio(0.5, 0.02), minSize: at(120, 8), maxSize: at(280, 20),
  });
  const tapButton = computeRect(safe, {
    anchor: at(0.5, 0.42), pivot: at(0.5, 0.5),
    size: ratio(0.56, 0.12), minSize: at(180, 64), maxSize: at(280, 96),
  });
  const rewardedButton = computeRect(safe, {
    anchor: at(0.5, 0.62), pivot: at(0.5, 0.5),
    size: ratio(0.56, 0.09), minSize: at(180, 44), maxSize: at(280, 64),
  });
  const hintArea = computeRect(safe, {
    anchor: at(0.5, 0), pivot: at(0.5, 0), offset: at(0, 16),
    size: ratio(0.8, 0.05), minSize: at(120, 18), maxSize: at(400, 40),
  });
  return { safe, scoreBar, tapButton, rewardedButton, bannerSlot, hintArea };
};

/** 分数条填充部分：比例夹到 0..1。 */
export const scoreFillRect = (bar: Rect, score: number, goal: number): Rect => {
  const value = goal > 0 ? Math.min(1, Math.max(0, score / goal)) : 0;
  return { x: bar.x, y: bar.y, w: bar.w * value, h: bar.h };
};

/** 点是否命中矩形；指针坐标就是逻辑坐标。 */
export const hitTest = (rect: Rect, point: { readonly x: number; readonly y: number }): boolean =>
  rect.w > 0 && rect.h > 0 && isInside({ x: point.x, y: point.y, w: 1, h: 1 }, rect);
