/**
 * 微信小游戏 API 的**最小**类型声明。
 *
 * 为什么单独一个文件：
 * 1. 仓库里没有装 @types/wechat-minigame，而 AGENTS 禁 `any`。
 *    与其用 any 蒙混，不如把「我们真正用到的那几个 API」精确写出来——
 *    写出来的形状就是我们的适配器对微信的假设，字段名写错会在编译期发现。
 * 2. 声明放在一起，实现文件（index.ts）就能只写逻辑，不掺杂类型噪音。
 *
 * 注意：这里只声明**我们用到的**成员，不是微信 API 的完整镜像。
 * 微信真实类型里这些接口的参数/返回值更宽，这里按「够用且真实」收窄。
 */

import type { RawMenuButtonRect } from '../screen-contract';

export interface WxTouch {
  readonly identifier: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pageX: number;
  readonly pageY: number;
}

export interface WxTouchEvent {
  /** 当前还在屏幕上的手指（end/cancel 时为空） */
  readonly touches: readonly WxTouch[];
  /** 本次事件涉及的手指 */
  readonly changedTouches: readonly WxTouch[];
  readonly timeStamp: number;
  preventDefault(): void;
}

export interface WxCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
}

export interface WxImage {
  width: number;
  height: number;
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

export interface WxInnerAudioContext {
  src: string;
  volume: number;
  loop: boolean;
  play(): void;
  pause(): void;
  stop(): void;
  destroy(): void;
}

/** 广告关闭回调。微信用 isEnded 表示是否完整看完。 */
export interface WxAdCloseResult {
  readonly isEnded: boolean;
}

export interface WxBannerAd {
  show(): Promise<void>;
  hide(): void;
  destroy(): void;
}

export interface WxInterstitialAd {
  show(): Promise<void>;
  onClose(cb: (res: WxAdCloseResult) => void): void;
  offClose?(cb: (res: WxAdCloseResult) => void): void;
}

export interface WxRewardedVideoAd {
  show(): Promise<void>;
  onClose(cb: (res: WxAdCloseResult) => void): void;
  offClose?(cb: (res: WxAdCloseResult) => void): void;
}

export interface WxSafeArea {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
  readonly height: number;
}

export interface WxSystemInfo {
  readonly screenWidth: number;
  readonly screenHeight: number;
  /** 主流机型都有；老版本可能没有 */
  readonly pixelRatio?: number;
  /** 仅 Android 提供，单位是物理 dpi */
  readonly screenDPI?: number;
  /** iOS 一定有；部分 Android 机型缺失 */
  readonly safeArea?: WxSafeArea;
}

/** 键盘（showKeyboard）参数：由系统弹出输入法，不是自己画的键盘。 */
export interface WxKeyboardOptions {
  readonly defaultValue?: string;
  readonly maxLength?: number;
  readonly multiple?: boolean;
  readonly confirmHold?: boolean;
  readonly confirmType?: 'done' | 'next' | 'search' | 'send';
}

/** 键盘回调参数（输入 / 确认 / 收起三个事件都是同一个形状）。 */
export interface WxKeyboardResult {
  readonly value: string;
}

/**
 * 滚轮回调（PC 微信 / 部分桌面基础库才有，手机端没有这个事件）。
 *
 * 字段依据微信的 `OnWheelListenerResult` 类型：`x` / `y` 是**画布逻辑坐标**，
 * `deltaX` / `deltaY` / `deltaZ` 是像素级增量，`timeStamp` 是事件时间戳。
 * 文档：https://developers.weixin.qq.com/minigame/dev/api/device/wheel-event/wx.onWheel.html
 */
export interface WxWheelEvent {
  readonly x: number;
  readonly y: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaZ: number;
  readonly timeStamp: number;
}

export interface WxApi {
  /** 第一次调用返回上屏 canvas，之后返回离屏 canvas */
  createCanvas(): WxCanvas;
  getSystemInfoSync(): WxSystemInfo;
  /**
   * 右上角胶囊的位置。**以屏幕左上角为原点、单位 px**（官方文档 + Taro 文档一致）。
   * 老基础库可能没有 → 可选成员，实现里探测不到就当没有（构造期不许崩）。
   */
  getMenuButtonBoundingClientRect?(): RawMenuButtonRect;

  onTouchStart(cb: (e: WxTouchEvent) => void): void;
  onTouchMove(cb: (e: WxTouchEvent) => void): void;
  onTouchEnd(cb: (e: WxTouchEvent) => void): void;
  onTouchCancel(cb: (e: WxTouchEvent) => void): void;

  /** 鼠标滚轮（PC 微信才有）。老基础库 / 手机端没有 → 可选成员 + 运行时探测。 */
  onWheel?(cb: (res: WxWheelEvent) => void): void;
  /** 取消滚轮监听（有就调用，老基础库可能没有）。 */
  offWheel?(cb?: (res: WxWheelEvent) => void): void;

  /** 弹系统键盘。maxLength 与 confirmType 由系统执行，这里只是透传。 */
  showKeyboard(opts: WxKeyboardOptions): void;
  hideKeyboard(opts?: { success?: () => void; fail?: (err: unknown) => void }): void;
  onKeyboardInput(cb: (res: WxKeyboardResult) => void): void;
  onKeyboardConfirm(cb: (res: WxKeyboardResult) => void): void;
  /** 键盘收起。基础库 2.13.0+ 才有，老基础库可能缺失 → 实现里按可选调用 */
  onKeyboardComplete?(cb: (res: WxKeyboardResult) => void): void;

  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): void;

  createImage(): WxImage;
  createInnerAudioContext(): WxInnerAudioContext;

  createBannerAd(opts: {
    readonly adUnitId: string;
    readonly style: { left: number; top: number; width: number; height: number };
  }): WxBannerAd;
  createInterstitialAd(opts: { readonly adUnitId: string }): WxInterstitialAd;
  createRewardedVideoAd(opts: { readonly adUnitId: string }): WxRewardedVideoAd;

  shareAppMessage(opts: { title?: string; imageUrl?: string; query?: string }): void;
  vibrateShort(opts: { type?: 'light' | 'medium' | 'heavy' }): void;
  loadSubpackage(opts: {
    readonly name: string;
    readonly success?: () => void;
    readonly fail?: (err: unknown) => void;
  }): void;

  onShow(cb: () => void): void;
  onHide(cb: () => void): void;
}

/** 微信的 WASM 加载器（全局 WXWebAssembly，不是 wx.* 下的成员）。 */
export interface WxWebAssemblyApi {
  instantiate(
    path: string,
    importObject?: Record<string, unknown>,
  ): Promise<WebAssembly.Instance>;
}
