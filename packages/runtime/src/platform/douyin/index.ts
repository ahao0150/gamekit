// @long-file 平台适配器：与微信同构但刻意不共享实现，差异（分享 channel / WASM / 静音键 / onClose 无 res）都要留在本文件里
/**
 * 抖音小游戏平台适配器。
 *
 * 为什么这样实现：抖音的 API 与微信**同名同形**（tt.* 对应 wx.*），
 * 所以这里刻意**不做任何抽象复用**——各写各的，差异写在注释里。
 * 把两者揉成一个基类，差异就会被藏进 if 里，而适配层最该留下来的恰恰是差异。
 *
 * 与微信的差异清单（这就是本文件存在的理由）：
 * 1. 全局对象：`tt` 而非 `wx`。
 * 2. WASM：全局是 `TTWebAssembly`（微信是 `WXWebAssembly`），同样不能走 fetch。
 * 3. 分享：`tt.shareAppMessage` 需要 channel（'video'/'article'/'aweme'…），
 *    不带 channel 常常拉不起分享面板；微信的 shareAppMessage 直接就能拉起。
 *    这里把 channel 放进 boot.extra.shareChannel，默认给 'video'。
 * 4. 音频：`tt.createInnerAudioContext` 多一个 `obeyMuteSwitch`（是否跟随手机静音键），
 *    微信没有这个开关。这里默认设为 false —— 抖音小游戏里静音键常常是关的，
 *    跟随静音键会让玩家听不到音效。
 * 5. 激励视频 onClose：抖音部分版本 close 时**不带 res**，微信一定带。
 *    所以判定完播要写成 `res?.isEnded === true`。
 * 6. 屏幕倍率：抖音只有 pixelRatio，没有微信那个 screenDPI 字段。
 * 7. safeArea：抖音部分机型不返回，缺失就退化成零安全区。
 * 其余（画布、触摸、存储、图片、广告、分包、震动）与微信同形。
 */

import { insetsFromSafeArea } from '../safe-area';
import { miniOffscreenFactory } from '../canvas-utils';
import { readMiniMenuButton } from '../screen-contract';
import type {
  AdService,
  Capability,
  GameCanvas,
  GameImage,
  Insets,
  KeyValueStore,
  PlatformAdapter,
  PlatformBootOptions,
  PlatformRegistry,
  PointerEvent as GamePointerEvent,
  RewardResult,
  ScreenInfo,
  Unsubscribe,
  WasmLoader,
} from '../contract';
import type { ResumableAudioHandle } from '../audio';
import type { TtApi, TtCanvas, TtSystemInfo, TtTouch, TtTouchEvent, TtWebAssemblyApi, TtWheelEvent } from './api';
import { createAdService, readAdUnitIds } from './ads';
import { createDouyinKeyboard } from './keyboard';
import { createDouyinServices } from './services';
import { createDouyinNet } from './net';
import { createMiniWheel } from '../wheel-minigame';

/** 抖音小游戏的全局对象。运行时不存在时为 undefined。 */
declare const tt: TtApi | undefined;
/** 抖音小游戏的 WASM 加载器（全局，不在 tt 下面）。 */
declare const TTWebAssembly: TtWebAssemblyApi | undefined;

/** 平台探测：**平台探测代码只准出现在这里**。 */
export const probe = (): boolean =>
  typeof tt !== 'undefined' && typeof tt.createCanvas === 'function';

/** 判断宿主传进来的 canvas 是不是真的画布。 */
const isTtCanvas = (v: unknown): v is TtCanvas =>
  typeof v === 'object' && v !== null && typeof (v as TtCanvas).getContext === 'function';

export interface DouyinRegisterOptions {
  readonly priority?: number;
}

/**
 * 从 `getSystemInfoSync()` 的结果算安全区四边（导出给契约测试直接用）。
 *
 * 方向规则与兜底见 `../safe-area.ts`：与微信共用同一份实现，
 * 两个平台只有 API 名字不同，换算不许各写一套。
 */
export const readSafeAreaInsets = (info: TtSystemInfo): Insets =>
  insetsFromSafeArea({ width: info.screenWidth, height: info.screenHeight }, info.safeArea);

/** 注册抖音平台。默认优先级 0（比 web 的 -1 高）。 */
export const register = (registry: PlatformRegistry, opts?: DouyinRegisterOptions): void => {
  registry.register({
    name: 'douyin',
    probe,
    factory: (boot: PlatformBootOptions): PlatformAdapter => createDouyinAdapter(boot),
    priority: opts?.priority ?? 0,
  });
};

const createDouyinAdapter = (boot: PlatformBootOptions): PlatformAdapter => {
  // probe 已经确认过 tt 存在；工厂只负责造对象。
  const api = tt!;

  // 第一次 createCanvas 返回上屏 canvas，只在这里创建一次。
  const canvasObj: TtCanvas = isTtCanvas(boot.canvas) ? boot.canvas : api.createCanvas();

  const info = api.getSystemInfoSync();
  // 四边换算统一走 safe-area.ts：缺失兜全 0、不出 NaN/负数
  const insets: Insets = readSafeAreaInsets(info);

  // 系统胶囊（T47）：safeArea 不含它；抖音两个 API 名都试，可能给物理像素（helper 兜底）。
  const menuButton = readMiniMenuButton(api, canvasObj, { width: info.screenWidth, height: info.screenHeight, dpr: info.pixelRatio ?? 1 });

  const screen: ScreenInfo = {
    width: info.screenWidth,
    height: info.screenHeight,
    dpr: info.pixelRatio ?? 1,
    insets,
    orientation: info.screenWidth >= info.screenHeight ? 'landscape' : 'portrait',
    ...(menuButton === undefined ? {} : { menuButton }),
  };

  const pointerListeners = new Set<(e: GamePointerEvent) => void>();
  const showListeners = new Set<() => void>();
  const hideListeners = new Set<() => void>();

  const emit = (
    kind: 'down' | 'move' | 'up' | 'cancel',
    id: number,
    x: number,
    y: number,
    time: number,
  ): void => {
    const e: GamePointerEvent = { kind, pointer: { id, x, y }, time };
    for (const cb of [...pointerListeners]) cb(e);
  };

  /** 一次 touch 回调带全部手指，逐个发事件（多点触控）。 */
  const emitEach = (
    kind: 'down' | 'move' | 'up' | 'cancel',
    list: readonly TtTouch[],
    time: number,
  ): void => {
    for (const t of list) emit(kind, t.identifier, t.clientX, t.clientY, time);
  };

  api.onTouchStart((e: TtTouchEvent) => emitEach('down', e.touches, e.timeStamp));
  api.onTouchMove((e: TtTouchEvent) => emitEach('move', e.touches, e.timeStamp));
  api.onTouchEnd((e: TtTouchEvent) => emitEach('up', e.changedTouches, e.timeStamp));
  api.onTouchCancel((e: TtTouchEvent) => emitEach('cancel', e.changedTouches, e.timeStamp));

  api.onShow(() => {
    for (const cb of [...showListeners]) cb();
  });
  api.onHide(() => {
    for (const cb of [...hideListeners]) cb();
  });

  // --- 存储（与微信同形：不存在的 key 返回空字符串 → 映射成 null）--------
  const storage: KeyValueStore = {
    get<T>(key: string): T | null {
      try {
        const raw = api.getStorageSync(key);
        if (raw === '' || raw === undefined || raw === null) return null;
        return raw as T;
      } catch {
        return null;
      }
    },
    set<T>(key: string, value: T): boolean {
      try {
        api.setStorageSync(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key: string): void {
      try {
        api.removeStorageSync(key);
      } catch {
        // 删不掉就当没删
      }
    },
  };

  // --- 图片 ---------------------------------------------------------------
  const loadImage = (src: string): Promise<GameImage | null> =>
    new Promise((resolve) => {
      const img = api.createImage();
      img.onload = () => resolve({ width: img.width, height: img.height, native: img });
      img.onerror = () => resolve(null);
      img.src = src;
    });

  // --- 音频（差异：抖音多了 obeyMuteSwitch）------------------------------
  // InnerAudioContext.pause() 之后 play() 从原位继续（与微信同形）。
  const createAudio = (src: string): ResumableAudioHandle => {
    const ctx = api.createInnerAudioContext();
    ctx.src = src;
    ctx.loop = false;
    // 抖音独有：默认不跟随手机静音键，否则玩家静音键一按就没声音
    ctx.obeyMuteSwitch = false;
    return {
      play: () => ctx.play(),
      pause: () => ctx.pause(),
      resume: () => ctx.play(),
      stop: () => ctx.stop(),
      setVolume: (v: number) => {
        ctx.volume = Math.max(0, Math.min(1, v));
      },
      setLoop: (loop: boolean) => {
        ctx.loop = loop;
      },
      destroy: () => ctx.destroy(),
    };
  };

  // --- 广告 ---------------------------------------------------------------
  // 广告的创建/生命周期/错误分支都在 ads.ts 里，这里只把它接上。
  const ads: AdService = createAdService(api, readAdUnitIds(boot.extra), screen.width);

  // --- 分包 / 分享 / 震动 --------------------------------------------------
  // 三个小服务的构造与差异（分享必带 channel）都在 services.ts 里，这里只解构。
  const { loadSubpackage, share, vibrate } = createDouyinServices(api, boot.extra);

  // --- wasm（差异：全局是 TTWebAssembly）---------------------------------
  const wasm: WasmLoader = {
    instantiate: (path: string, imports?: Record<string, unknown>) =>
      TTWebAssembly!.instantiate(path, imports),
  };

  const canvas: GameCanvas = {
    get width(): number {
      return screen.width;
    },
    get height(): number {
      return screen.height;
    },
    getContext: (type: '2d') => canvasObj.getContext(type),
    native: canvasObj,
  };

  // 离屏画布（T30）：上屏已由第一次 createCanvas() 建好，之后每次调用都得到离屏画布。
  const createCanvas = miniOffscreenFactory(() => api.createCanvas());

  // 软键盘（差异：部分版本没有 onKeyboardComplete，见 keyboard.ts）。
  // 缺键盘 API 的宿主返回 null —— 能力位也不许报 true。
  const keyboard = createDouyinKeyboard(api);

  // 滚轮（T36）：PC 抖音才有 tt.onWheel；手机端没有 → 不暴露这个成员。
  // 字段名按微信同一套语义（抖音文档页抓不到正文，见 api.ts 的「未确认」说明），
  // 缺字段一律填 0：最坏是「滚轮没反应」，不会把滚动位污染成 NaN。
  const onWheel = createMiniWheel<TtWheelEvent>(api, (res) => ({
    x: Number.isFinite(res.x) ? res.x : 0,
    y: Number.isFinite(res.y) ? res.y : 0,
    deltaX: Number.isFinite(res.deltaX) ? res.deltaX : 0,
    deltaY: Number.isFinite(res.deltaY) ? res.deltaY : 0,
    time: Number.isFinite(res.timeStamp) ? res.timeStamp : 0,
  }));

  const subscribe = <T>(set: Set<T>, cb: T): Unsubscribe => {
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  };

  // 与微信同形：没有物理键盘，其余能力平台都支持。
  const caps = new Set<Capability>([
    'pointer',
    'touch-multi',
    'safe-area',
    'audio',
    'storage',
    'ad-banner',
    'ad-interstitial',
    'ad-rewarded',
    'share',
    'vibrate',
    'subpackage',
    'wasm',
    'net',
    'websocket',
  ]);

  // 键盘能力位跟着「真的拿到键盘服务」走（缺 API 的宿主如实为 false）。
  if (keyboard !== null) caps.add('soft-keyboard');

  return {
    name: 'douyin',
    canvas,
    screen,
    can: (cap: Capability): boolean => caps.has(cap),
    onResize: (_cb: (s: ScreenInfo) => void): Unsubscribe => {
      // 小游戏屏幕尺寸固定，不存在 resize 事件；空操作的退订函数。
      return () => {
        // noop
      };
    },
    onPointer: (cb: (e: GamePointerEvent) => void) => subscribe(pointerListeners, cb),
    onShow: (cb: () => void) => subscribe(showListeners, cb),
    onHide: (cb: () => void) => subscribe(hideListeners, cb),
    loadImage,
    storage,
    net: createDouyinNet(api),
    createCanvas,
    createAudio,
    ads,
    loadSubpackage,
    vibrate,
    share,
    wasm,
    ...(keyboard !== null ? { keyboard } : {}),
    ...(onWheel !== null ? { onWheel } : {}),
  };
};
