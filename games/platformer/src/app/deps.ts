/**
 * runtime 依赖汇聚点 —— 游戏里唯一直接 import runtime / 新包的文件。
 *
 * 用相对路径的理由与模板一致：runtime 的根 barrel 还没落地、子路径也没在
 * package.json 的 exports 里开放；等 barrel 就位后换成包名即可。
 */

export { createLoop } from '../../../../packages/runtime/src/core/loop/index';
export { createCamera } from '../../../../packages/runtime/src/core/camera/index';
export { activeWindow, intersects, isVisible, partitionByVisibility } from '../../../../packages/runtime/src/core/cull/index';
export { createPhysicsWorld } from '../../../../packages/physics-2d/src/index';

// `.ui` 布局链（T45）：compile（构建期插件）→ bind（量尺寸）→ layout（求解）→ 游戏自己画
export { bindComponents } from '../../../../packages/runtime/src/core/ui/bind';
export { layout } from '../../../../packages/runtime/src/core/ui/layout';
export { DEFAULT_THEME } from '../../../../packages/runtime/src/core/ui/components';
// 自定义组件用的工厂与绘制工具（T80：触屏按键）
export { boolProp, defineComponent, stringProp } from '../../../../packages/runtime/src/core/ui/components';
export { drawCenteredText } from '../../../../packages/runtime/src/core/ui/builtin-draw';

// 多点按压（T48）：UI 按钮语义用 press.ts（单指针独占），游戏虚拟按键用 multi-press
// （每个 pointerId 独立绑定、互不打断 —— 这修的就是「按住左再按跳，左被打断」）
export {
  EMPTY_MULTI_PRESS,
  isPressed,
  multiDown,
  multiMove,
  multiUp,
  pressedNames,
} from '../../../../packages/runtime/src/core/ui/multi-press';
export type { MultiPressState } from '../../../../packages/runtime/src/core/ui/multi-press';
export type { HitEntry, HitPoint } from '../../../../packages/runtime/src/core/ui/hit';

export type { Camera, CameraConfig } from '../../../../packages/runtime/src/core/camera/contract';
export type { CullRect } from '../../../../packages/runtime/src/core/cull/contract';
export type { BodyHandle, BodyPose, PhysicsWorld } from '../../../../packages/physics-2d/src/index';
export type { Rect } from '../../../../packages/runtime/src/core/ui/contract';
export type {
  ComponentDef,
  ComponentRegistry,
  DrawDeps,
  UiData,
} from '../../../../packages/runtime/src/core/ui/components';
export type { LayoutSpec, LayoutViewport, StyleProps } from '../../../../packages/runtime/src/core/ui/layout';
export type {
  Ctx2D,
  MenuButtonRect,
  PlatformAdapter,
  PointerEvent,
  ScreenInfo,
} from '../../../../packages/runtime/src/platform/contract';
