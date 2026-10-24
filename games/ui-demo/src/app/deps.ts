/**
 * runtime 依赖汇聚点 —— demo 里唯一直接 import runtime 的文件。
 *
 * 为什么用相对路径：runtime 还没有根 barrel（模板同款说明）。
 * 等 barrel 落地后把下面几行换成 `@mg/runtime`，业务代码一行都不用动。
 */

export { createLoop } from '../../../../packages/runtime/src/core/loop/index';
export { bindComponents, assertComponents } from '../../../../packages/runtime/src/core/ui/bind';
export { layout } from '../../../../packages/runtime/src/core/ui/layout';
export { pickHit } from '../../../../packages/runtime/src/core/ui/hit';
export { createBuiltinRegistry } from '../../../../packages/runtime/src/core/ui/builtin';
export { DEFAULT_THEME, defineComponent } from '../../../../packages/runtime/src/core/ui/components';
export { drawCenteredText, fillRect } from '../../../../packages/runtime/src/core/ui/builtin-draw';

// 通用组件库（T15–T31，21 个）：注册进 demo 注册表，构建期校验与运行时绑定同一份。
export { WIDGET_COMPONENTS } from '../../../../packages/runtime/src/core/ui/widgets/index';

// 交互状态机（T17 / T20）：按钮三态与滚动的纯函数层
export { IDLE_PRESS, pressDown, pressMove, pressUp } from '../../../../packages/runtime/src/core/ui/press';
export { IDLE_SCROLL, scrollDragEnd, scrollDragMove, scrollDragStart } from '../../../../packages/runtime/src/core/ui/scroll';

// 滚轮（T38）：离散增量 → 滚动位；钳制口径与拖动共用 `scrollClamp`
export { scrollByWheel } from '../../../../packages/runtime/src/core/ui/wheel';

// 子项命中（T31）：列表项 / 网格格「点第几项」的几何换算，游戏不再自己推公式
export { gridIndexAt, listIndexAt } from '../../../../packages/runtime/src/core/ui/item-hit';

// 网格的单元格宽（与 grid 绘制**同源**：命中用它算，避免「看得见点不到」）
export { cellWidth } from '../../../../packages/runtime/src/core/ui/widgets/grid';

export type {
  ComponentAssets,
  ComponentDef,
  ComponentRegistry,
  ComponentTheme,
  DrawDeps,
  MeasureEnv,
  UiData,
} from '../../../../packages/runtime/src/core/ui/components';
export type { HitEntry, HitMode } from '../../../../packages/runtime/src/core/ui/hit';
export type { PressState } from '../../../../packages/runtime/src/core/ui/press';
export type { ScrollState } from '../../../../packages/runtime/src/core/ui/scroll';
export type { GridHitOptions, ListHitOptions } from '../../../../packages/runtime/src/core/ui/item-hit';
export type { ListRenderItem } from '../../../../packages/runtime/src/core/ui/widgets/index';
export type { ScrollRenderContent } from '../../../../packages/runtime/src/core/ui/widgets/scroll';
export type { LayoutSpec, LayoutViewport, NodeMeta, NodeSpec, StyleProps } from '../../../../packages/runtime/src/core/ui/layout';
export type { Rect } from '../../../../packages/runtime/src/core/ui/contract';
export type {
  Ctx2D,
  PlatformAdapter,
  PointerEvent,
  ScreenInfo,
  WheelEvent,
} from '../../../../packages/runtime/src/platform/contract';
