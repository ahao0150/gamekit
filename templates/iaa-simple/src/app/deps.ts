/**
 * runtime 依赖汇聚点 —— 模板里唯一直接 import runtime 的文件。
 * 一律用 `@mg/runtime` 包名，不要写 packages/runtime 相对路径。
 */

export { createAds, createLoop, createSave, computeRect, insetRect, isInside } from '@mg/runtime';
export type { AdResult, AdsOptions, Rect, Insets, WidgetProps } from '@mg/runtime';
export type { Ctx2D, PlatformAdapter, PointerEvent, ScreenInfo } from '@mg/runtime';
