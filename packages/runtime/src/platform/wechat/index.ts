// @long-file 平台适配器：能力挂载（画布/触摸/键盘/滚轮/广告/分包/WASM/网络）+ 事件转发集中在一处，拆开会让「can 说有、方法却缺」的风险变高
/**
 * 微信小游戏平台适配器。
 *
 * 为什么这样实现（以及和小游戏环境的哪些坑有关）：
 * 1. **画布只能由 wx.createCanvas() 给**。第一次调用返回的是**上屏 canvas**，
 *    之后再调用拿到的是离屏 canvas —— 所以必须「第一次就创建、并且只创建一次」，
 *    之后所有绘制都往这个实例上画。业务自己传 canvas 时要接受它就是上屏那个。
 * 2. **屏幕信息一次性取**。wx.getSystemInfoSync() 是同步的，返回 screenWidth/
 *    screenHeight（物理屏幕逻辑像素）、pixelRatio 与 safeArea。
 *    主流机型有 pixelRatio；screenDPI 只有 Android 给，单位是物理 dpi，
 *    要 ÷96 才是倍率；safeArea 在 iOS 一定有，部分 Android 机型没有，
 *    缺了就退化成零安全区。
 * 3. **触摸事件要自己拆成单点**。微信一次 touch 回调里 touches 数组带全部手指，
 *    契约的 PointerEvent 是单点的，所以每个手指各发一条事件 ——
 *    多点触控（touch-multi）这才不是嘴上说说。
 * 4. **激励视频看完没看完看 onClose 的 res.isEnded**，不是看有没有 close 回调。
 *    中途划走也会触发 onClose，这时 isEnded 为 false，奖励不能发。
 * 5. **WASM 不走 fetch**。小游戏没有 fetch，WASM 只能用全局 WXWebAssembly.instantiate。
 * 6. **物理键盘能力没有**：小游戏没有物理键盘，can('keyboard') 如实为 false；
 *    但**软键盘**有（wx.showKeyboard 弹系统输入法），can('soft-keyboard') 为 true。
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
import type { WxApi, WxCanvas, WxSystemInfo, WxTouch, WxTouchEvent, WxWebAssemblyApi, WxWheelEvent } from './api';
import { createAdService, readAdUnitIds } from './ads';
import { createWechatKeyboard } from './keyboard';
import { createWechatServices } from './services';
import { createWechatNet } from './net';
import { createMiniWheel } from '../wheel-minigame';

/** 微信小游戏的全局对象。运行时不存在时为 undefined。 */
declare const wx: WxApi | undefined;
/** 微信小游戏的 WASM 加载器（全局，不在 wx 下面）。 */
declare const WXWebAssembly: WxWebAssemblyApi | undefined;

/** 平台探测：**平台探测代码只准出现在这里**。 */
export const probe = (): boolean =>
  typeof wx !== 'undefined' && typeof wx.createCanvas === 'function';

/** 判断宿主传进来的 canvas 是不是真的画布（小游戏里 createCanvas 才是标准来源）。 */
const isWxCanvas = (v: unknown): v is WxCanvas =>
  typeof v === 'object' && v !== null && typeof (v as WxCanvas).getContext === 'function';

export interface WechatRegisterOptions {
  readonly priority?: number;
}

/**
 * 从 `getSystemInfoSync()` 的结果算安全区四边（导出给契约测试直接用）。
 *
 * 方向规则与兜底见 `../safe-area.ts`：wx / tt 共用同一份实现 ——
 * 「right = 屏宽 - (left + width)」这类公式只写一遍才不会两边漂。
 */
export const readSafeAreaInsets = (info: WxSystemInfo): Insets =>
  insetsFromSafeArea({ width: info.screenWidth, height: info.screenHeight }, info.safeArea);

/** 注册微信平台。默认优先级 0（比 web 的 -1 高）。 */
export const register = (registry: PlatformRegistry, opts?: WechatRegisterOptions): void => {
  registry.register({
    name: 'wechat',
    probe,
    factory: (boot: PlatformBootOptions): PlatformAdapter => createWechatAdapter(boot),
    priority: opts?.priority ?? 0,
  });
};

const createWechatAdapter = (boot: PlatformBootOptions): PlatformAdapter => {
  // probe 已经确认过 wx 存在；工厂只负责造对象。
  const api = wx!;

  // 第一次 createCanvas 拿到的就是上屏 canvas，必须在这里一次性创建。
  const canvasObj: WxCanvas = isWxCanvas(boot.canvas) ? boot.canvas : api.createCanvas();

  const info = api.getSystemInfoSync();
  const dpr = info.pixelRatio ?? (info.screenDPI ? info.screenDPI / 96 : 1);
  // 四边换算统一走 safe-area.ts：缺失兜全 0、不出 NaN/负数
  const insets: Insets = readSafeAreaInsets(info);

  // 系统胶囊（T47）：safeArea 不含它，必须单独读；画布铺满屏幕 → 屏幕坐标即画布坐标。
  const menuButton = readMiniMenuButton(api, canvasObj, { width: info.screenWidth, height: info.screenHeight, dpr });

  const screen: ScreenInfo = {
    width: info.screenWidth,
    height: info.screenHeight,
    dpr,
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

  /** 一条 touch 回调里有多个手指，逐个发事件（多点触控）。 */
  const emitEach = (
    kind: 'down' | 'move' | 'up' | 'cancel',
    list: readonly WxTouch[],
    time: number,
  ): void => {
    for (const t of list) emit(kind, t.identifier, t.clientX, t.clientY, time);
  };

  api.onTouchStart((e: WxTouchEvent) => emitEach('down', e.touches, e.timeStamp));
  api.onTouchMove((e: WxTouchEvent) => emitEach('move', e.touches, e.timeStamp));
  api.onTouchEnd((e: WxTouchEvent) => emitEach('up', e.changedTouches, e.timeStamp));
  api.onTouchCancel((e: WxTouchEvent) => emitEach('cancel', e.changedTouches, e.timeStamp));

  api.onShow(() => {
    for (const cb of [...showListeners]) cb();
  });
  api.onHide(() => {
    for (const cb of [...hideListeners]) cb();
  });

  // --- 存储 ---------------------------------------------------------------
  // 微信的 getStorageSync 对不存在的 key 返回空字符串，这里统一映射成 null。
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

  // --- 音频 ---------------------------------------------------------------
  // InnerAudioContext.pause() 之后 play() 会从原位继续，不是从头重播 ——
  // 这正是 core 的 BGM 暂停/恢复需要的语义。
  const createAudio = (src: string): ResumableAudioHandle => {
    const ctx = api.createInnerAudioContext();
    ctx.src = src;
    ctx.loop = false;
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
  // 三个小服务的构造在 services.ts 里（微信分享不需要 channel，抖音必须要 —— 分开写）。
  const { loadSubpackage, share, vibrate } = createWechatServices(api);

  // --- wasm ---------------------------------------------------------------
  // 小游戏没有 fetch，只能走 WXWebAssembly；importObject 必须是可序列化的。
  const wasm: WasmLoader = {
    instantiate: (path: string, imports?: Record<string, unknown>) =>
      WXWebAssembly!.instantiate(path, imports),
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

  // 软键盘：老基础库可能没有这套 API，那时 keyboard 为 null —— 能力位也不许报 true。
  const keyboard = createWechatKeyboard(api);

  // 滚轮（T36）：PC 微信才有 wx.onWheel，手机端 / 老基础库没有 → 不暴露这个成员。
  // 字段映射与「懒注册 + 引用计数退订」都在 wheel-minigame.ts（wx / tt 共用一份）。
  const onWheel = createMiniWheel<WxWheelEvent>(api, (res) => ({
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

  // 微信没有物理键盘，其余能力平台都支持。
  const caps = new Set<Capability>([
    'pointer',
    'touch-multi',
    'safe-area',
    'audio',
    'storage',
    'net',
    'websocket',
    'ad-banner',
    'ad-interstitial',
    'ad-rewarded',
    'share',
    'vibrate',
    'subpackage',
    'wasm',
  ]);

  // 键盘能力位跟着「真的拿到键盘服务」走：老基础库拿不到就如实为 false。
  if (keyboard !== null) caps.add('soft-keyboard');

  return {
    name: 'wechat',
    canvas,
    screen,
    can: (cap: Capability): boolean => caps.has(cap),
    onResize: (_cb: (s: ScreenInfo) => void): Unsubscribe => {
      // 小游戏屏幕尺寸固定，不存在 resize 事件；给一个空操作的退订函数，
      // 业务可以照常订阅，不会崩，也不会被回调。
      return () => {
        // noop
      };
    },
    onPointer: (cb: (e: GamePointerEvent) => void) => subscribe(pointerListeners, cb),
    onShow: (cb: () => void) => subscribe(showListeners, cb),
    onHide: (cb: () => void) => subscribe(hideListeners, cb),
    loadImage,
    storage,
    net: createWechatNet(api),
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
