/**
 * runtime 依赖汇聚点 —— 本工程里唯一直接 import 引擎源码的文件。
 *
 * 用相对路径的理由与模板 / ui-demo 一致（引擎内部路径稳定、不经过包解析）；
 * 包名版本见 `docs/NETWORK.md` 的说明，这里不混用两套。
 */

export { createLoop } from '../../../../packages/runtime/src/core/loop/index';
export { bindComponents } from '../../../../packages/runtime/src/core/ui/bind';
export { layout } from '../../../../packages/runtime/src/core/ui/layout';
export { createBuiltinRegistry } from '../../../../packages/runtime/src/core/ui/builtin';
export { defineComponent, DEFAULT_THEME } from '../../../../packages/runtime/src/core/ui/components';
export { drawCenteredText } from '../../../../packages/runtime/src/core/ui/builtin-draw';
export { button, label, panel } from '../../../../packages/runtime/src/core/ui/widgets/index';

export type {
  ComponentDef,
  ComponentRegistry,
  ComponentTheme,
  DefinedComponent,
  DrawDeps,
  MeasureEnv,
} from '../../../../packages/runtime/src/core/ui/components';
export type { LayoutSpec, LayoutViewport, StyleProps } from '../../../../packages/runtime/src/core/ui/layout';
export type { Rect } from '../../../../packages/runtime/src/core/ui/contract';
export type { Ctx2D, PlatformAdapter } from '../../../../packages/runtime/src/platform/contract';
