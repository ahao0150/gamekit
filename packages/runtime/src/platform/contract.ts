/**
 * 平台适配层契约 —— gamekit 里唯一允许存在平台差异的地方。
 *
 * 铁律：业务代码与 core 里禁止出现 wx./tt./window./navigator. 判断，
 * 只能 `platform.can('ad-rewarded')` 这样按能力探测。
 *
 * 新增平台 = 新建一个目录实现 PlatformAdapter + 调一次 registerPlatform()，
 * core 与业务代码零改动。
 */

// 软键盘 / 滚轮 / 屏幕契约拆在独立文件（本文件贴着 300 行上限），见文件下方 re-export。
import type { KeyboardService } from './keyboard-contract';
import type { ScreenInfo } from './screen-contract';
import type { WheelEvent } from './wheel-contract';
import type { NetService } from './net-contract';

// ---------------------------------------------------------------------------
// 能力
// ---------------------------------------------------------------------------

/** 平台能力。业务侧只按能力写分支。 */
export type Capability =
  | 'pointer' // 单点指针（鼠标 / 单指触摸）
  | 'touch-multi' // 多点触摸
  | 'keyboard' // **物理**键盘（桌面浏览器）；小游戏没有
  | 'soft-keyboard' // **软键盘**（系统输入法）；三端都有，见 KeyboardService
  | 'safe-area' // 能拿到刘海 / 圆角 / Home 条的安全区
  | 'audio'
  | 'storage'
  | 'ad-banner'
  | 'ad-interstitial'
  | 'ad-rewarded'
  | 'share'
  | 'vibrate'
  | 'subpackage' // 支持分包加载
  | 'wasm' // 支持加载 WebAssembly（微信 WXWebAssembly / 抖音 TTWebAssembly）;
  | 'net' // HTTP 请求（三端都有，走各自平台 API）
  | 'websocket' // 长连接（三端都有）

// ---------------------------------------------------------------------------
// 屏幕 / 画布
// ---------------------------------------------------------------------------
// 屏幕契约（Insets / ZERO_INSETS / ScreenInfo / MenuButtonRect）在
// screen-contract.ts：T47 加 menuButton（系统胶囊）时把那一段整体搬了出去，
// 本文件才有位置继续加成员。对外导入路径不变，见下方 re-export。

/**
 * 2D 上下文。
 *
 * 直接沿用 DOM 的 `CanvasRenderingContext2D`：微信/抖音的 canvas 2d 上下文
 * 是它的兼容子集，运行时能对上。这样 AI 不需要读一份自定义类型就知道能用什么方法。
 * 用到的成员如果某平台没有，由该平台的实现负责兜底（例如 measureText）。
 */
export type Ctx2D = CanvasRenderingContext2D;

/** 最小画布契约，不暴露 DOM 细节。 */
export interface GameCanvas {
  readonly width: number;
  readonly height: number;
  getContext(type: '2d'): Ctx2D | null;
  /** 平台底层句柄（web 下是 HTMLCanvasElement），仅供调试与平台实现自身使用。 */
  readonly native: unknown;
}

/** 可绘制图像。web 为 HTMLImageElement，wx/tt 为平台 Image 对象。 */
export interface GameImage {
  readonly width: number;
  readonly height: number;
  readonly native: unknown;
}

// ---------------------------------------------------------------------------
// 输入
// ---------------------------------------------------------------------------

export interface PointerSample {
  /** 同一根手指/指针的稳定标识 */
  readonly id: number;
  /** 逻辑像素坐标，左上角为原点 */
  readonly x: number;
  readonly y: number;
}

export interface PointerEvent {
  readonly kind: 'down' | 'move' | 'up' | 'cancel';
  readonly pointer: PointerSample;
  /** 事件时间戳（ms） */
  readonly time: number;
}

export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// 存储 / 音频 / 广告 / 分享
// ---------------------------------------------------------------------------

/** 同步键值存储。三端都有同步版本，异步接口留给以后。 */
export interface KeyValueStore {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): boolean;
  remove(key: string): void;
}

export interface AudioHandle {
  play(): void;
  pause(): void;
  stop(): void;
  /** 0..1 */
  setVolume(v: number): void;
  setLoop(loop: boolean): void;
  destroy(): void;
}

export interface BannerOptions {
  /** 逻辑像素，相对屏幕左上角 */
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface RewardResult {
  /** 用户是否完整看完 */
  readonly ok: boolean;
  /** 失败原因：未看完 / 无库存 / 平台错误 */
  readonly reason?: 'incomplete' | 'no-fill' | 'error';
}

/** 广告服务。没有对应能力的平台不实现该属性，业务侧必须先 `can()`。 */
export interface AdService {
  showBanner(opts?: BannerOptions): void;
  hideBanner(): void;
  showInterstitial(): Promise<void>;
  showRewarded(): Promise<RewardResult>;
}

export interface ShareOptions {
  readonly title?: string;
  readonly imageUrl?: string;
  readonly query?: string;
}

// ---------------------------------------------------------------------------
// 软键盘（系统输入法）
// ---------------------------------------------------------------------------
// 类型在 keyboard-contract.ts：本文件已贴着 300 行上限（AGENTS 铁律 2），
// 而键盘是一个独立能力面，拆开不影响「契约只在一处」——
// 对外导入路径仍然是 `platform/contract`，这里 re-export。
export type {
  KeyboardOptions,
  KeyboardRect,
  KeyboardService,
} from './keyboard-contract';
export type { OnWheel, WheelEvent, WheelListener } from './wheel-contract';
/** 网络传输层契约（HTTP / WebSocket），见 net-contract.ts。 */
export type { NetService, RawNetResponse, SocketTransport } from './net-contract';
// 屏幕 / 胶囊（T47）：类型与纯函数在 screen-contract.ts，导入路径不变。
export { ZERO_INSETS } from './screen-contract';
export type { Insets, MenuButtonRect, ScreenInfo } from './screen-contract';

// ---------------------------------------------------------------------------
// 平台适配器
// ---------------------------------------------------------------------------

/**
 * 适配策略（唯一真源：`@mg/vite` 的 MgFit 与各平台实现都对齐这里）。
 *
 * - `contain`：短边贴住视口，画布完整可见 —— 设计比例与设备比例不同时必然留边；
 * - `height` / `width`：贴住一条边，另一条按设计比例走（可能超出视口）；
 * - `fill`：**画布 = 视口**，不缩放设计稿；留白与自适应交给布局引擎（region）。
 */
export type FitMode = 'height' | 'width' | 'contain' | 'fill';

/** 启动参数，由宿主环境（web 的 index.html / wx 的 game.js）提供。 */
export interface PlatformBootOptions {
  /** web：页面里的 <canvas>；wx/tt：首次 createCanvas 得到的 canvas */
  readonly canvas?: unknown;
  /** 设计分辨率，用于计算逻辑尺寸与 dpr 映射 */
  readonly design: { readonly width: number; readonly height: number };
  /** 适配策略：按高 / 按宽 / 取小 / 铺满 */
  readonly fit?: FitMode;
  /** 额外参数，平台实现自行解释 */
  readonly extra?: Record<string, unknown>;
}

/**
 * 平台适配器。core 只通过这个接口与外界打交道。
 *
 * 必需成员保持最小，可选成员表达能力差异。
 */
export interface PlatformAdapter {
  /** 平台标识，如 'web' | 'wechat' | 'douyin' | 'mock' */
  readonly name: string;

  readonly canvas: GameCanvas;
  readonly screen: ScreenInfo;

  /** 能力查询。业务代码的唯一平台分支依据。 */
  can(cap: Capability): boolean;

  onResize(cb: (screen: ScreenInfo) => void): Unsubscribe;
  onPointer(cb: (e: PointerEvent) => void): Unsubscribe;
  onKey?(cb: (key: string, down: boolean) => void): Unsubscribe;
  onWheel?(cb: (e: WheelEvent) => void): Unsubscribe; // 可选：鼠标滚轮（PC 才有）

  /** 前后台切换。用于暂停音频、暂停计时、重新拉 banner。 */
  onShow?(cb: () => void): Unsubscribe;
  onHide?(cb: () => void): Unsubscribe;

  /** 加载图片；失败返回 null，由 Game.assets 决定回落策略。 */
  loadImage(src: string): Promise<GameImage | null>;

  /**
   * 可选：网络能力（HTTP + WebSocket 传输层）。
   *
   * 可选成员保持向后兼容：老平台实现不加它也能编过，调用方用前先判存在
   * （或 `can('net')`）。契约与归一化在 `./net-contract`，业务侧应当用
   * `core/net` 的 `request()` / `openSocket()`，而不是直接碰这个成员。
   */
  readonly net?: NetService;

  readonly storage: KeyValueStore;

  /**
   * 可选：创建**离屏**画布（不上屏、不插 DOM）。
   *
   * 为什么是可选成员：不是所有宿主都保证有离屏能力。调用方用之前先判
   * `adapter.createCanvas !== undefined`；`core/render/cache.ts` 已经把「没有它」
   * 的降级路径做好（退化成每帧直画，不崩）。
   *
   * 尺寸用**物理像素**（调用方自己乘 dpr），否则高 dpr 屏上缓存层会糊。
   */
  readonly createCanvas?: (width: number, height: number) => GameCanvas;

  createAudio?(src: string): AudioHandle;
  readonly ads?: AdService;

  /** 加载分包；没有分包能力时 resolved 立即成功。 */
  loadSubpackage?(name: string): Promise<void>;

  vibrate?(kind: 'light' | 'medium' | 'heavy'): void;
  share?(opts: ShareOptions): void;

  /**
   * 可选：系统软键盘（输入昵称 / 金额 / 兑换码）。三端都实现了它，
   * 但调用方仍要先判存在：老平台实现可能没接（契约是可选成员）。
   */
  readonly keyboard?: KeyboardService;

  /** 可选：WASM 加载能力，供 box2d-wasm 这类实现使用。纯 JS 物理不需要它。 */
  readonly wasm?: WasmLoader;
}

/**
 * WASM 加载。小游戏里没有 `fetch`，必须走平台自己的 API：
 * 微信 `WXWebAssembly.instantiate`、抖音 `TTWebAssembly.instantiate`。
 * 属于可选能力，不用 WASM 的游戏完全不感知它。
 */
export interface WasmLoader {
  instantiate(
    path: string,
    imports?: Record<string, unknown>,
  ): Promise<WebAssembly.Instance>;
}

// ---------------------------------------------------------------------------
// 注册表：可扩展点
// ---------------------------------------------------------------------------

export type PlatformFactory = (
  opts: PlatformBootOptions,
) => PlatformAdapter | Promise<PlatformAdapter>;

/** 平台探测函数：返回 true 表示当前环境是该平台。 */
export type PlatformProbe = () => boolean;

export interface PlatformRegistration {
  readonly name: string;
  readonly probe: PlatformProbe;
  readonly factory: PlatformFactory;
  /** 数值越大越先探测；web 兜底用 -1 */
  readonly priority?: number;
}

export interface PlatformRegistry {
  /** 注册一个平台实现。重复注册同名会抛错（防止静默覆盖）。 */
  register(reg: PlatformRegistration): void;
  /** 按优先级探测并创建平台适配器。全部失败时抛错。 */
  resolve(opts: PlatformBootOptions): Promise<PlatformAdapter>;
  /** 当前已注册的平台名，用于 doctor 与测试。 */
  names(): string[];
}

/** 由 `platform/registry.ts` 提供实现。 */
export type CreateRegistry = () => PlatformRegistry;
