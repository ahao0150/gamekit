/**
 * `@mg/runtime` 根 barrel：模板与游戏应从此包名导入，不要写
 * `../../../../packages/runtime/src/...` 相对路径。
 *
 * 只 re-export 公开 API；平台探测实现仍通过 `./platform/adapters` 子路径按需取。
 */

// —— loop / ads / save ——
export { createLoop, tick, DEFAULT_STEP, DEFAULT_MAX_FRAME_TIME, DEFAULT_MAX_SUB_STEPS } from './core/loop/index';
export { createAds, DEFAULT_INTERSTITIAL_COOLDOWN_MS, DEFAULT_REWARDED_COOLDOWN_MS } from './core/ads/index';
export type { AdResult, AdsOptions } from './core/ads/contract';
export { createSave, saveKeys, DEFAULT_NAMESPACE } from './core/save/index';

// —— 网络（HTTP + WebSocket）：两个入口都不抛错，失败折成 NetResponse ——
export { request, openSocket, NET_DEFAULTS, NO_RETRY, SOCKET_QUEUE_LIMIT } from './core/net/index';
export type {
  Heartbeat,
  HttpMethod,
  NetError,
  NetErrorKind,
  NetResponse,
  ReconnectPolicy,
  RequestOptions,
  ResponseType,
  RetryPolicy,
  Socket,
  SocketEventMap,
  SocketOptions,
  SocketState,
} from './core/net/index';

// —— UI 锚点几何 ——
export { computeRect, isInside, clampInside, insetRect, createUi, EPSILON } from './core/ui/index';
export type { Rect, Insets, WidgetProps } from './core/ui/contract';

// —— .ui 布局链 ——
export { bindComponents, assertComponents } from './core/ui/bind';
export type { BindOptions, BoundUi } from './core/ui/bind';
export { layout, fill, auto, fixed, ratio, LAYER_INDEX, LAYER_ORDER } from './core/ui/layout';
export type {
  Align,
  HitMode as LayoutHitMode,
  Justify,
  LayerName,
  LayoutResult,
  LayoutSpec,
  LayoutViewport,
  Length,
  LengthInsets,
  NodeMeta,
  NodeSpec,
  RegionSpec,
  Size,
  StackSpec,
  StyleProps,
  StyleValue,
} from './core/ui/layout';
export { pickHit, hitTest, sortForPaint } from './core/ui/hit';
export type { HitEntry, HitMode, HitPoint } from './core/ui/hit';

// —— 组件注册表 ——
export {
  createComponentRegistry,
  defineComponent,
  DEFAULT_THEME,
  stringProp,
  numberProp,
  boolProp,
  estimateTextWidth,
  unknownComponentMessage,
  checkPropValue,
} from './core/ui/components';
export type {
  ComponentAssets,
  ComponentDef,
  ComponentRegistry,
  ComponentTheme,
  DefinedComponent,
  DrawDeps,
  MeasureEnv,
  PropDecls,
  PropType,
  UiData,
} from './core/ui/components';
export { createBuiltinRegistry, BUILTIN_COMPONENTS } from './core/ui/builtin';
export { WIDGET_COMPONENTS, createWidgetRegistry } from './core/ui/widgets/index';
export { createDefaultUiRegistry } from './core/ui/default-registry';
export { drawCenteredText, drawTextAt, drawIcon, fillRect } from './core/ui/builtin-draw';
export { resolveUiData } from './core/ui/data-channel';

// —— 平台 ——
export { resolvePlatform, createPlatformRegistry, registerAll, createRegistry, ZERO_INSETS } from './platform/index';
export type {
  Ctx2D,
  PlatformAdapter,
  PlatformBootOptions,
  PointerEvent,
  ScreenInfo,
} from './platform/contract';
