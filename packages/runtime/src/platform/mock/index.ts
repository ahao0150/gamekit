// @long-file mock 适配器：契约的每个可选能力都要在这里挂一个可编程开关（键盘/滚轮/广告/分包/WASM/网络），拆开会让「哪些能注入」散落
/**
 * mock 平台：一个可编程的假平台。
 *
 * 为什么要有它：
 * 1. **测试不能依赖 DOM**。vitest 跑在 node 环境，没有 window/document，
 *    所以 web 平台无法在单测里直接验证。要测「core 只通过 PlatformAdapter
 *    取能力」这件事，就必须有一个能精确控制行为的替身。
 * 2. **它是「加平台不碰 core」的活证据**。mock 走的是和其它平台完全一样的
 *    路径：实现 PlatformAdapter → 写 probe → 导出 register() → 注册表按
 *    priority 选中它。以后真接第 5 个厂商，抄的就是这条路。
 *
 * 能力怎么控制：
 * - 屏幕尺寸 / dpr / 安全区：构造时注入，可随时 emitResize 改。
 * - 能力集合：构造时注入；**pointer 与 storage 是契约的必需成员**，
 *   无论注入什么都恒为 true（不然就是「can 说没有、方法却存在」的自相矛盾）。
 * - 指针 / 键盘 / 前后台 / 滚轮：emit* 手动触发。
 * - loadImage：ok / fail / 按 src 判定三条路径。
 * - storage：内存版，get 未命中返回 null。
 * - 假画布 / 假音频 / 假广告：零件都在 parts.ts，这里只做装配。
 *
 * 注意：probe 默认**恒 false**。真实环境里绝不能误选 mock，
 * 想要它被 resolve() 选中必须显式 register(registry, { enabled: true })。
 */

import type {
  Capability,
  Ctx2D,
  GameCanvas,
  Insets,
  KeyboardOptions,
  MenuButtonRect,
  PlatformAdapter,
  PlatformBootOptions,
  PlatformRegistry,
  PointerEvent as GamePointerEvent,
  RewardResult,
  ScreenInfo,
  ShareOptions,
  Unsubscribe,
} from '../contract';
import { createMockKeyboard } from './keyboard';
import { createMockWheel } from './wheel';
import { createMockNet } from './net';
import type { MockNet, MockNetOptions } from './net';
import type { MockWheelControls } from './wheel';
import {
  createMemoryStorage,
  createMockAds,
  createMockAudio,
  createMockCanvas,
  createMockImageLoader,
  createMockOffscreenCanvas,
  createMockPlayingAudio,
  createMockScreen,
  createMockSubpackage,
  createMockWasm,
} from './parts';
import type { MockAudioOptions, MockImageBehavior, MockPlayingAudio } from './parts';

export type { MockAudioOptions, MockImageBehavior, MockPlayingAudio } from './parts';
export { createMockPlayingAudio } from './parts';
export type { MockNet, MockNetOptions, MockNetSocket } from './net';
export { createMockNet } from './net';

/** mock 模拟出来的指针事件类型（与契约的 kind 同值）。 */
export type MockPointerKind = 'down' | 'move' | 'up' | 'cancel';

export interface MockOptions {
  /** 屏幕尺寸，默认 375×667 / dpr 2 */
  readonly screen?: {
    readonly width: number;
    readonly height: number;
    readonly dpr?: number;
    readonly insets?: Insets;
  };
  /** 注入的能力集合。pointer 与 storage 恒为 true（契约必需成员）。 */
  readonly capabilities?: readonly Capability[];
  /** 图片加载行为，默认 'ok' */
  readonly imageBehavior?: MockImageBehavior;
  /** 注入一个假 2d 上下文（默认 null，契约允许 null） */
  readonly ctx?: Ctx2D | null;
  /** 离屏画布用的假 ctx（T30，默认 null）；与主画布分开，测试互不污染 */
  readonly offscreenCtx?: Ctx2D | null;
  /** 激励视频结果，默认 { ok: true } */
  readonly rewarded?: RewardResult;
  readonly menuButton?: MenuButtonRect; // 系统胶囊（T47）：注入后 screen.menuButton 有值
  /** 网络假实现（应答 / 延迟 / socket 是否自动 open），默认 200 + '{}' */
  readonly net?: MockNetOptions;
}

/** mock 适配器 = 契约的 PlatformAdapter + 一组手动触发用的控制口子。 */
export interface MockAdapter extends PlatformAdapter, MockWheelControls {
  /** 触发一次指针事件 */
  emitPointer(kind: MockPointerKind, x: number, y: number, id?: number, time?: number): void;
  /** 改屏幕尺寸并通知 onResize 订阅者 */
  emitResize(width: number, height: number, dpr?: number): void;
  /** 触发一次按键 */
  emitKey(key: string, down: boolean): void;
  /** 触发一次「前台」 */
  emitShow(): void;
  /** 触发一次「后台」 */
  emitHide(): void;
  /** 震动调用次数 */
  readonly vibrateCount: number;
  /** 分享调用记录 */
  readonly shareCalls: readonly ShareOptions[];
  /** 广告调用记录（方法名序列） */
  readonly adCalls: readonly string[];
  /** 音频调用记录（方法名序列） */
  readonly audioCalls: readonly string[];
  /**
   * 造一个 core 形态的假音频（PlayingAudio 结构兼容）。
   * 用来测 core 的两条路径：支持 pause/resume 时走「从原处继续」，
   * 不支持时走「stop + 重播」的降级分支。调用记录进 audioCalls。
   */
  createPlayingAudio(opts?: MockAudioOptions): MockPlayingAudio;
  /** 已经创建过的离屏画布尺寸（T30 断言用） */
  readonly offscreenCanvases: readonly { readonly width: number; readonly height: number }[];
  /** 软键盘 `open()` 的参数记录（T34；未开启 soft-keyboard 能力时也会记） */
  readonly keyboardOpenCalls: readonly KeyboardOptions[];
  /** 软键盘 `close()` 调用次数 */
  readonly keyboardCloseCount: number;
  /** 手动触发一次键盘输入 */
  emitKeyboardInput(value: string): void;
  /** 手动触发一次确认键 */
  emitKeyboardConfirm(value: string): void;
  /** 手动触发一次「键盘收起」 */
  emitKeyboardClose(value: string): void;
}

const DEFAULT_CAPS: readonly Capability[] = ['pointer', 'storage', 'audio', 'safe-area', 'net', 'websocket'];

/** 构造一个 mock 适配器。所有状态都在闭包里，没有模块级可变单例。 */
export const createMockAdapter = (opts?: MockOptions): MockAdapter => {
  const caps = new Set<Capability>(opts?.capabilities ?? DEFAULT_CAPS);
  // 契约的必需成员必然存在，能力表里必须为真
  caps.add('pointer');
  caps.add('storage');

  const imageBehavior = opts?.imageBehavior ?? 'ok';
  const rewardedResult = opts?.rewarded ?? { ok: true };
  const ctx = opts?.ctx ?? null;

  let screen: ScreenInfo = createMockScreen(opts?.screen, opts?.menuButton);

  const pointerListeners = new Set<(e: GamePointerEvent) => void>();
  const resizeListeners = new Set<(s: ScreenInfo) => void>();
  const keyListeners = new Set<(key: string, down: boolean) => void>();
  const showListeners = new Set<() => void>();
  const hideListeners = new Set<() => void>();

  const vibrateCalls: string[] = [];
  const shareCalls: ShareOptions[] = [];
  const adCalls: string[] = [];
  const audioCalls: string[] = [];
  const offscreenCanvases: { width: number; height: number }[] = [];

  const subscribe = <T>(set: Set<T>, cb: T): Unsubscribe => {
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  };

  const canvas = createMockCanvas(() => screen, ctx);
  const storage = createMemoryStorage();
  const loadImage = createMockImageLoader(imageBehavior);
  const createAudio = createMockAudio(audioCalls);
  const ads = createMockAds(adCalls, rewardedResult);
  const loadSubpackage = createMockSubpackage();
  const wasm = createMockWasm();
  const mockKeyboard = createMockKeyboard();
  // net 恒挂载（能力表里也恒为 true）：没有它 core/net 的单测就得自己造假平台
  const net = createMockNet(opts?.net);

  // 可选成员按能力集合挂载：can() 说有，方法就一定在。
  // 用对象展开而不是事后赋值 —— 契约里 ads / wasm 是 readonly 属性。
  return {
    name: 'mock',
    canvas,
    get screen(): ScreenInfo {
      return screen;
    },
    can: (cap: Capability): boolean => caps.has(cap),
    onResize: (cb: (s: ScreenInfo) => void) => subscribe(resizeListeners, cb),
    onPointer: (cb: (e: GamePointerEvent) => void) => subscribe(pointerListeners, cb),
    loadImage,
    storage,
    net,
    ...(caps.has('keyboard')
      ? { onKey: (cb: (key: string, down: boolean) => void) => subscribe(keyListeners, cb) }
      : {}),
    ...(caps.has('audio') ? { createAudio } : {}),
    ...(caps.has('ad-banner') || caps.has('ad-interstitial') || caps.has('ad-rewarded')
      ? { ads }
      : {}),
    ...(caps.has('share')
      ? {
          share: (o: ShareOptions): void => {
            shareCalls.push(o);
          },
        }
      : {}),
    ...(caps.has('vibrate')
      ? {
          vibrate: (kind: 'light' | 'medium' | 'heavy'): void => {
            vibrateCalls.push(kind);
          },
        }
      : {}),
    ...(caps.has('subpackage') ? { loadSubpackage } : {}),
    ...(caps.has('wasm') ? { wasm } : {}),
    // 软键盘：与其它可选成员同一条规矩 —— can() 说有，成员就一定在。
    ...(caps.has('soft-keyboard') ? { keyboard: mockKeyboard.keyboard } : {}),
    ...createMockWheel(), // T36：mock 恒有滚轮，测试可随时 emitWheel
    // T30：离屏画布。尺寸记录供测试断言，ctx 用注入的 offscreenCtx（默认 null）。
    createCanvas: (width: number, height: number): GameCanvas => {
      offscreenCanvases.push({ width, height });
      return createMockOffscreenCanvas(width, height, opts?.offscreenCtx ?? null);
    },
    get offscreenCanvases(): readonly { readonly width: number; readonly height: number }[] {
      return [...offscreenCanvases];
    },
    onShow: (cb: () => void) => subscribe(showListeners, cb),
    onHide: (cb: () => void) => subscribe(hideListeners, cb),

    emitPointer(kind, x, y, id = 1, time = 0): void {
      const e: GamePointerEvent = { kind, pointer: { id, x, y }, time };
      for (const cb of [...pointerListeners]) cb(e);
    },
    emitResize(width, height, dpr): void {
      screen = {
        ...screen,
        width,
        height,
        dpr: dpr ?? screen.dpr,
        orientation: width >= height ? 'landscape' : 'portrait',
      };
      for (const cb of [...resizeListeners]) cb(screen);
    },
    emitKey(key, down): void {
      for (const cb of [...keyListeners]) cb(key, down);
    },
    emitShow(): void {
      for (const cb of [...showListeners]) cb();
    },
    emitHide(): void {
      for (const cb of [...hideListeners]) cb();
    },
    get vibrateCount(): number {
      return vibrateCalls.length;
    },
    get shareCalls(): readonly ShareOptions[] {
      return [...shareCalls];
    },
    get adCalls(): readonly string[] {
      return [...adCalls];
    },
    get audioCalls(): readonly string[] {
      return [...audioCalls];
    },
    createPlayingAudio(audioOpts?: MockAudioOptions): MockPlayingAudio {
      return createMockPlayingAudio(audioCalls, audioOpts);
    },
    get keyboardOpenCalls(): readonly KeyboardOptions[] {
      return mockKeyboard.openCalls;
    },
    get keyboardCloseCount(): number {
      return mockKeyboard.closeCount;
    },
    emitKeyboardInput(value: string): void {
      mockKeyboard.emitInput(value);
    },
    emitKeyboardConfirm(value: string): void {
      mockKeyboard.emitConfirm(value);
    },
    emitKeyboardClose(value: string): void {
      mockKeyboard.emitClose(value);
    },
  };
};

export interface MockRegisterOptions {
  /** 是否让 probe 返回 true。默认 false：真实环境绝不误选 mock。 */
  readonly enabled?: boolean;
  /** 探测优先级，默认最低。 */
  readonly priority?: number;
}

/**
 * 注册 mock 平台。
 *
 * probe 恒 false（除非 enabled）——真实运行时 mock 必须在场但不生效，
 * 这样 names() 里能看到它、doctor 也能报告，而不会在真机上把 web 顶掉。
 */
export const register = (registry: PlatformRegistry, opts?: MockRegisterOptions): void => {
  registry.register({
    name: 'mock',
    probe: () => opts?.enabled === true,
    factory: (_opts: PlatformBootOptions) => createMockAdapter(),
    priority: opts?.priority ?? -1000,
  });
};
