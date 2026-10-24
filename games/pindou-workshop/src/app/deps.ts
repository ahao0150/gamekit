/**
 * runtime 依赖汇聚点 —— 模板里唯一直接 import runtime 的文件。
 *
 * 为什么用相对路径：runtime 的根 barrel（`@mg/runtime` 的 `src/index.ts`）还没落地，
 * 子路径也还没在 package.json 的 exports 里开放。等 barrel 就位后，把下面几行换成
 * `from '@mg/runtime'`，业务代码一行都不用动。
 */

export { createLoop } from '../../../../packages/runtime/src/core/loop/index';

// `.ui` 界面链：解析（构建期）→ 绑定 measure → 布局 → 命中
export { bindComponents } from '../../../../packages/runtime/src/core/ui/bind';
export { layout } from '../../../../packages/runtime/src/core/ui/layout';
export { pickHit } from '../../../../packages/runtime/src/core/ui/hit';
export { keypadHit } from '../../../../packages/runtime/src/core/ui/widgets/keypad-hit';

// 自绘区域切分原语（T63）：比例切带 / 均匀网格 / 重叠检测
export { findOverlaps, gridOf, splitCols, splitRows } from '../../../../packages/runtime/src/core/ui/index';

// IAA 三件套（T65）：广告 / 存档 / 音频
export { createAds } from '../../../../packages/runtime/src/core/ads/index';
export { createAudio } from '../../../../packages/runtime/src/core/audio/index';
export { createSave } from '../../../../packages/runtime/src/core/save/index';

// 资源加载与九宫格原语（T73 美术接入）：
// runtime 的 barrel 还没转出 nine-slice，按本文件既有惯例深路径 import，不动 packages。
export { createAssets } from '../../../../packages/runtime/src/core/assets/index';
export { drawCapsule, drawNineSlice, DEFAULT_CAPSULE } from '../../../../packages/runtime/src/core/ui/nine-slice';

// 特效与补间（T63 第二轮动效）
export * from '../../../../packages/runtime/src/core/fx/index';
export * from '../../../../packages/runtime/src/core/tween/index';

// 组件注册表：内置 9 个业务件 + 22 个通用组件 = 31 个（见 ui-registry.ts）
export { createBuiltinRegistry } from '../../../../packages/runtime/src/core/ui/builtin';
// 内置业务件：游戏侧复用它们的 def（例如给 `primaryButton` 再注册一个名字）
export { primaryButton, secondaryButton, statusText } from '../../../../packages/runtime/src/core/ui/builtin-parts';
export { createComponentRegistry, DEFAULT_THEME, defineComponent } from '../../../../packages/runtime/src/core/ui/components';
export { WIDGET_COMPONENTS } from '../../../../packages/runtime/src/core/ui/widgets/index';
export { drawCenteredText, fillRect } from '../../../../packages/runtime/src/core/ui/builtin-draw';

export type {
  ComponentAssets,
  ComponentDef,
  ComponentRegistry,
  ComponentTheme,
  DrawDeps,
  MeasureEnv,
} from '../../../../packages/runtime/src/core/ui/components';
export type { HitEntry, HitMode } from '../../../../packages/runtime/src/core/ui/hit';
export type { LayoutSpec, LayoutViewport, NodeMeta, NodeSpec, StyleProps } from '../../../../packages/runtime/src/core/ui/layout';
export type { Rect } from '../../../../packages/runtime/src/core/ui/contract';
export type { UiData } from '../../../../packages/runtime/src/core/ui/components';
export type { Ctx2D, PlatformAdapter, PointerEvent, ScreenInfo } from '../../../../packages/runtime/src/platform/contract';
export type { AdResult, AdsOptions } from '../../../../packages/runtime/src/core/ads/contract';
export type { AssetManifest, AssetService, AssetStatus, AtlasManifest, ImageAsset } from '../../../../packages/runtime/src/core/assets/contract';
export type { AudioService, PlayingAudio } from '../../../../packages/runtime/src/core/audio/contract';
export type { AudioHandle } from '../../../../packages/runtime/src/platform/contract';