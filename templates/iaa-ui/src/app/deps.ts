/**
 * runtime 依赖汇聚点 —— 模板里唯一直接 import runtime 的文件。
 * 一律用 `@mg/runtime` 包名，不要写 packages/runtime 相对路径。
 */

export { createLoop, createWidgetRegistry } from '@mg/runtime';

// `.ui` 界面链：解析（构建期）→ 绑定 measure → 布局 → 命中
export { bindComponents, layout, pickHit, resolveUiData } from '@mg/runtime';

// 通用组件来自 WIDGET_COMPONENTS；旧业务件仅用于兼容既有游戏。
export {
  createBuiltinRegistry,
  createComponentRegistry,
  DEFAULT_THEME,
  defineComponent,
  WIDGET_COMPONENTS,
  drawCenteredText,
  fillRect,
} from '@mg/runtime';

export type {
  ComponentAssets,
  ComponentDef,
  ComponentRegistry,
  ComponentTheme,
  DrawDeps,
  MeasureEnv,
  UiData,
  HitEntry,
  HitMode,
  LayoutSpec,
  LayoutViewport,
  NodeMeta,
  NodeSpec,
  StyleProps,
  Rect,
  Ctx2D,
  PlatformAdapter,
  PointerEvent,
  ScreenInfo,
} from '@mg/runtime';
