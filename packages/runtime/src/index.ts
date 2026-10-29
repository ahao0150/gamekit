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

// —— 缓动 / 弹簧 / 时间轴 ——
// 整块能力此前没进 barrel：游戏拿不到，要么写引擎内部相对路径
// （早先的游戏里就是这么绕的），要么自己抄一份缓动近似
// （games/pindou-workshop/src/app/anim.ts:116 的注释写着「同 core/tween 的 out 手感」）。
export {
  createEasing,
  createSpring,
  createTimeline,
  createTween,
  createTweenRunner,
  createTweenSystem,
  CURVES,
  easingAt,
  easingAtParam,
  easingProgressAt,
  MOTION,
  sampleSpring,
  sampleTimeline,
} from './core/tween/index';
export type {
  BezierCurve,
  EasingName,
  EasingSample,
  Keyframe,
  Spring,
  SpringConfig,
  Timeline,
  Tween,
  TweenOptions,
  TweenRunner,
} from './core/tween/index';

// —— 网络（HTTP + WebSocket）：两个入口都不抛错，失败折成 NetResponse ——
export {
  createCancel,
  request,
  openSocket,
  NET_DEFAULTS,
  NO_RETRY,
  SOCKET_QUEUE_LIMIT,
} from './core/net/index';
export type {
  CancelSignal,
  CancelSource,
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
// 切分 / 重叠检测：自绘层「按比例均分」要用的纯函数（`splitCols` / `splitRows` / `gridOf`），
// 此前同样只在二级 barrel。
export { findOverlaps, gridOf, ratiosSum, splitCols, splitRows } from './core/ui/index';
export type { Rect, Insets, WidgetProps } from './core/ui/contract';

// —— 滚动状态机（拖动 / 惯性 / 边界钳制，纯函数）——
// 此前 `core/ui/index.ts` 没导出这几个符号，根 barrel 自然也拿不到；游戏要用只能写
// 引擎内部相对路径。第三次 barrel 缺漏，成因与防线见 src/index.test.ts 文件头。
export {
  IDLE_SCROLL,
  scrollClamp,
  scrollDragEnd,
  scrollDragMove,
  scrollDragStart,
  scrollTick,
} from './core/ui/index';
export type { ScrollState } from './core/ui/index';

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

// —— 文本折行 / 变高列表 ——
// 聊天这类「按文本变高」的内容：`wrapText` 折行，`measureItemHeights` 预算每项高度
// 塞进 `list` 的 `data.itemHeights`；定位/命中走前缀和二分，1 万项不线性扫。
export { measureItemHeights, wrapText } from './core/render/index';
export { createLayerCache, createLayerCacheFor, createRender } from './core/render/index';
export type { LayerCache, LayerCacheOptions } from './core/render/index';
export type { ItemHeightOptions, MeasureFn } from './core/render/index';
export {
  buildVariableIndex,
  listIndexAtVariable,
  variableWindow,
} from './core/ui/widgets/index';
export type { VariableIndex, VariableWindow } from './core/ui/widgets/index';

// —— 聊天 UI（气泡 / 变高消息列表 / 输入条）——
// 三个组件的铁律是「画与点同源」：游戏侧做命中必须调 `bubbleParts` / `composerParts` /
// `chatListIndexAt`，与组件内部绘制共用同一份几何。拿不到这些符号，调用方只能自己再算
// 一套，而两套几何必然漂移（「点到的」与「画出的」错位）。
export {
  AVATAR_GAP,
  AVATAR_SIZE,
  BUBBLE_RADIUS,
  PAD_X,
  PAD_Y,
  TIME_H,
  bubbleHeight,
  bubbleLineHeight,
  bubbleParts,
  bubbleTextWidth,
  chatBubble,
  chatComposer,
  chatList,
  chatListHeights,
  chatListIndexAt,
  chatListOptions,
  checkBubbleFit,
  composerHit,
  composerParts,
  drawBubble,
  rawBubbleTextWidth,
  readMessages,
} from './core/ui/widgets/index';
export type {
  BubbleOptions,
  BubbleParts,
  ChatListOptions,
  ChatMessage,
  ComposerParts,
} from './core/ui/widgets/index';

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
// 25 个通用组件本体 + 组件内工具。此前只在二级 barrel：`createWidgetRegistry()` 能用，
// 但想「只注册其中几个」或自己手写注册表时，拿不到组件本体（`button` / `panel` / `list`…），
// 只能写引擎内部相对路径。2026-10-27 由 index.test.ts 的自动对比扫出（33 个符号里的 25 个）。
export {
  avatar,
  badge,
  button,
  carousel,
  checkbox,
  cursorVisibleAt,
  divider,
  fitText,
  grid,
  icon,
  input,
  keypad,
  keypadHit,
  label,
  list,
  panel,
  progress,
  radio,
  scroll,
  scrollbar,
  segmented,
  slider,
  switchToggle,
  tabs,
  toast,
} from './core/ui/widgets/index';
export type { KeypadOptions, ListRenderItem, ScrollRenderContent } from './core/ui/widgets/index';
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
