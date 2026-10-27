/**
 * 抖音小游戏 API 的**最小**类型声明。
 *
 * 与微信版（platform/wechat/api.ts）是**两套独立声明**，不是共用一套：
 * 抖音和微信的 API 虽然同名，但字段与行为有真实差异（见 index.ts 的差异清单）。
 * 共用一份类型会逼着两边都按「微信的形状」写，差异就藏掉了 ——
 * 而这正是适配层最该记录的东西。
 *
 * 同样只声明我们真正用到的成员，不用 any。
 */

import type { RawMenuButtonRect } from '../screen-contract';

export interface TtTouch {
  readonly identifier: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pageX: number;
  readonly pageY: number;
}

export interface TtTouchEvent {
  readonly touches: readonly TtTouch[];
  readonly changedTouches: readonly TtTouch[];
  readonly timeStamp: number;
  preventDefault(): void;
}

export interface TtCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
}

export interface TtImage {
  width: number;
  height: number;
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

export interface TtInnerAudioContext {
  src: string;
  volume: number;
  loop: boolean;
  /** 抖音独有：是否跟随手机静音键。微信没有这个开关。 */
  obeyMuteSwitch: boolean;
  play(): void;
  pause(): void;
  stop(): void;
  destroy(): void;
}

/** 广告关闭回调。抖音同微信：isEnded 表示是否完整看完。 */
export interface TtAdCloseResult {
  readonly isEnded?: boolean;
}

export interface TtBannerAd {
  show(): Promise<void>;
  hide(): void;
  destroy(): void;
}

export interface TtInterstitialAd {
  show(): Promise<void>;
  onClose(cb: (res?: TtAdCloseResult) => void): void;
  offClose?(cb: (res?: TtAdCloseResult) => void): void;
}

export interface TtRewardedVideoAd {
  show(): Promise<void>;
  onClose(cb: (res?: TtAdCloseResult) => void): void;
  offClose?(cb: (res?: TtAdCloseResult) => void): void;
}

export interface TtSafeArea {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
  readonly height: number;
}

export interface TtSystemInfo {
  readonly screenWidth: number;
  readonly screenHeight: number;
  /** 抖音同样以 pixelRatio 表示倍率（不像微信还有 screenDPI 字段） */
  readonly pixelRatio?: number;
  /** 部分机型缺失，缺失就退化成零安全区 */
  readonly safeArea?: TtSafeArea;
}

/** 键盘（showKeyboard）参数：与微信同形。 */
export interface TtKeyboardOptions {
  readonly defaultValue?: string;
  readonly maxLength?: number;
  readonly multiple?: boolean;
  readonly confirmHold?: boolean;
  readonly confirmType?: 'done' | 'next' | 'search' | 'send';
}

/** 键盘回调参数（输入 / 确认 / 收起）。 */
export interface TtKeyboardResult {
  readonly value: string;
}

/**
 * 滚轮回调（PC 抖音 / 桌面端，手机端没有）。
 *
 * ⚠ **字段未在官方文档确认**：抖音的 API 文档页由 JS 渲染，抓不到正文，
 * 只在文档站目录里看到 `tt.offWheel` 存在（说明有 `tt.onWheel`）。
 * 这里按微信 `OnWheelListenerResult` 的同一套语义声明（x / y / deltaX / deltaY /
 * timeStamp）；实现里对 `deltaX` / `deltaY` 缺失也按 0 处理 ——
 * 字段名若与真机不同，最坏情况是「滚轮不响应」，不会把滚动位污染成 NaN。
 * 真机拿到事件后应核对一次并更新本注释。
 */
export interface TtWheelEvent {
  readonly x: number;
  readonly y: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly timeStamp: number;
}

/** `tt.request` 的返回：字段名与微信同形（`statusCode` / `header`）。 */
export interface TtRequestResult {
  readonly statusCode: number;
  readonly header: Record<string, string>;
  /** 默认受 `dataType` 影响；我们显式传 'text' 让解析权留在 core */
  readonly data: unknown;
}

/** `tt.request` 返回的任务句柄，可中断。 */
export interface TtRequestTask {
  abort(): void;
}

export interface TtRequestOptions {
  readonly url: string;
  /** **PATCH 不在小游戏合法集合里**（同微信），如实声明、如实传，基础库会走 fail。 */
  readonly method?: 'OPTIONS' | 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'TRACE' | 'CONNECT' | 'PATCH';
  readonly header?: Record<string, string>;
  readonly data?: unknown;
  readonly dataType?: 'json' | 'text';
  readonly responseType?: 'text' | 'arraybuffer';
  readonly success?: (res: TtRequestResult) => void;
  readonly fail?: (err: unknown) => void;
}

/** `tt.connectSocket` 返回的 SocketTask（与微信同形）。 */
export interface TtSocketTask {
  send(opts: { readonly data: string | ArrayBuffer }): void;
  close(opts?: { readonly code?: number; readonly reason?: string }): void;
  onOpen(cb: () => void): void;
  onMessage(cb: (res: { readonly data: string | ArrayBuffer }) => void): void;
  onClose(cb: (res: { readonly code: number; readonly reason: string }) => void): void;
  onError(cb: (res: { readonly errMsg?: string }) => void): void;
}

export interface TtApi {
  /** 第一次调用返回上屏 canvas，之后返回离屏 canvas */
  createCanvas(): TtCanvas;  getSystemInfoSync(): TtSystemInfo;
  /**
   * 右上角胶囊位置（**未在官方文档确认字面量**：抖音小游戏文档页 JS 渲染抓不到正文；
   * 小程序侧文档站目录里有同名 API，真机采样字段与微信同形 top/right/bottom/left/width/height）。
   * 老基础库没有 → 可选成员。
   */
  getMenuButtonBoundingClientRect?(): RawMenuButtonRect;
  /** 抖音小游戏文档目录里的另一个名字（`tt.getMenuButtonLayout`），字段形状未确认。 */
  getMenuButtonLayout?(): RawMenuButtonRect;

  onTouchStart(cb: (e: TtTouchEvent) => void): void;
  onTouchMove(cb: (e: TtTouchEvent) => void): void;
  onTouchEnd(cb: (e: TtTouchEvent) => void): void;
  onTouchCancel(cb: (e: TtTouchEvent) => void): void;

  /** 鼠标滚轮（PC 抖音才有；字段见 TtWheelEvent 的「未确认」说明）。 */
  onWheel?(cb: (res: TtWheelEvent) => void): void;
  /** 取消滚轮监听（文档站目录里有 tt.offWheel，按可选调用）。 */
  offWheel?(cb?: (res: TtWheelEvent) => void): void;

  /** 弹系统键盘（同微信）。 */
  showKeyboard(opts: TtKeyboardOptions): void;
  hideKeyboard(opts?: { success?: () => void; fail?: (err: unknown) => void }): void;
  onKeyboardInput(cb: (res: TtKeyboardResult) => void): void;
  onKeyboardConfirm(cb: (res: TtKeyboardResult) => void): void;
  /**
   * 键盘收起。**差异：抖音部分版本没有这个事件**（微信 2.13.0+ 有），
   * 所以声明成可选，实现里缺就用 confirm + hideKeyboard 兜底。
   */
  onKeyboardComplete?(cb: (res: TtKeyboardResult) => void): void;

  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): void;

  createImage(): TtImage;
  createInnerAudioContext(): TtInnerAudioContext;

  createBannerAd(opts: {
    readonly adUnitId: string;
    readonly style: { left: number; top: number; width: number; height: number };
  }): TtBannerAd;
  createInterstitialAd(opts: { readonly adUnitId: string }): TtInterstitialAd;
  createRewardedVideoAd(opts: { readonly adUnitId: string }): TtRewardedVideoAd;

  /**
   * 分享。**与微信的差异**：抖音要带 channel（'video' / 'article' / 'aweme' …），
   * 不带 channel 常常拉不起分享面板；微信直接传 title/imageUrl/query 即可。
   */
  shareAppMessage(opts: {
    title?: string;
    imageUrl?: string;
    query?: string;
    channel?: 'video' | 'article' | 'aweme' | string;
  }): void;

  vibrateShort(opts: { type?: 'light' | 'medium' | 'heavy' }): void;
  loadSubpackage(opts: {
    readonly name: string;
    readonly success?: () => void;
    readonly fail?: (err: unknown) => void;
  }): void;

  onShow(cb: () => void): void;
  onHide(cb: () => void): void;

  /** HTTP 请求（与微信同形）。 */
  request(opts: TtRequestOptions): TtRequestTask;
  /** 建长连接，返回 SocketTask。 */
  connectSocket(opts: { readonly url: string; readonly protocols?: readonly string[] }): TtSocketTask;
}

/** 抖音的 WASM 加载器（全局 TTWebAssembly，与微信的 WXWebAssembly 同名不同物）。 */
export interface TtWebAssemblyApi {
  instantiate(
    path: string,
    importObject?: Record<string, unknown>,
  ): Promise<WebAssembly.Instance>;
}
