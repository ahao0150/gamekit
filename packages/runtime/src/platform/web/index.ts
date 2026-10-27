/**
 * web 平台适配器（浏览器 / 桌面壳 / 调试预览）。
 *
 * 为什么这样实现：
 * 1. **画布自己造，也要能用外部给的**。业务可能已经有 <canvas>（模板注入的），
 *    所以 boot options.canvas 优先；没有才建一个铺满视口的，并设
 *    `touch-action:none` —— 否则移动端浏览器的手势会吃掉点击。
 * 2. **指针事件统一成一套**。现代浏览器有 PointerEvent，但它不覆盖老浏览器；
 *    touch 事件又是另一套字段名。这里统一成契约的 PointerEvent：
 *    优先 PointerEvent，退化到 touch + mouse，三条路产出同一种结构，
 *    业务与 core 只见一种事件。
 * 3. **坐标一律用 clientX/clientY（视口逻辑像素）**，与 screen.width/height
 *    同一坐标系。设计坐标换算交给 core/input 的 createDesignMapping，
 *    平台层不重复实现一遍适配规则（两处规则打架比多写几十行更贵）。
 * 4. **安全区用 env(safe-area-inset-*) 读**：用一个隐藏探针元素把四个值写进
 *    padding，再用 getComputedStyle 读回。浏览器不支持 env() 时整条声明失效，
 *    读回来是 0 —— 安全退化成无安全区，不会算错。
 * 5. **can() 如实**：web 有原生激励广告吗？没有。所以 ad-* 全 false，
 *    业务按能力分支就不会在 web 上调出广告。share / vibrate 同理不实现
 *    （桌面浏览器不可靠），wasm 则真的能做，所以给 true。
 */

import { ZERO_INSETS } from '../contract';
import type {
  Capability,
  GameCanvas,
  GameImage,
  KeyValueStore,
  PlatformAdapter,
  PlatformBootOptions,
  PlatformRegistry,
  PointerEvent as GamePointerEvent,
  ScreenInfo,
  Unsubscribe,
  WasmLoader,
  WheelEvent as GameWheelEvent,
  WheelListener,
} from '../contract';
import { createDetachedCanvas, placeCanvas, resolveCanvas, wrapCanvas } from './env';
import { attachPointerEvents, attachWheelEvents } from './events';
import type { PointerKind } from './events';
import { createWebAudio } from './audio';
import { createWebKeyboard } from './keyboard';
import { createWebNet } from './net';

/** 平台探测：**平台探测代码只准出现在这里**。 */
export const probe = (): boolean =>
  typeof document !== 'undefined' &&
  typeof window !== 'undefined' &&
  typeof document.createElement === 'function';

export interface WebRegisterOptions {
  readonly priority?: number;
}

/** 注册 web 平台。priority 默认 -1，作为浏览器里的兜底。 */
export const register = (registry: PlatformRegistry, opts?: WebRegisterOptions): void => {
  registry.register({
    name: 'web',
    probe,
    factory: (boot: PlatformBootOptions): PlatformAdapter => createWebAdapter(boot),
    priority: opts?.priority ?? -1,
  });
};

const createWebAdapter = (boot: PlatformBootOptions): PlatformAdapter => {
  const canvasEl = resolveCanvas(boot.canvas);
  const design = boot.design;
  const fit = boot.fit;

  // 初值只是占位：placeCanvas() 会立刻按 design + fit 算出真正的画布尺寸
  let screen: ScreenInfo = {
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    insets: ZERO_INSETS,
    orientation: 'portrait',
  };

  /**
   * 把画布摆进视口：按 design + fit 算显示尺寸 → 设 CSS 尺寸 → 设 backing。
   * contain 下画布**完整可见**（窄视口自动缩小，不再被裁）。
   */
  const applyBox = (): void => {
    screen = placeCanvas(canvasEl, design, fit);
  };
  applyBox();

  const pointerListeners = new Set<(e: GamePointerEvent) => void>();
  const resizeListeners = new Set<(s: ScreenInfo) => void>();
  const keyListeners = new Set<(key: string, down: boolean) => void>();
  const wheelListeners = new Set<WheelListener>();
  const showListeners = new Set<() => void>();
  const hideListeners = new Set<() => void>();

  const emitPointer = (
    kind: PointerKind,
    id: number,
    x: number,
    y: number,
    time: number,
  ): void => {
    const e: GamePointerEvent = { kind, pointer: { id, x, y }, time };
    for (const cb of [...pointerListeners]) cb(e);
  };

  // --- 指针事件接线 -------------------------------------------------------
  // 归一化（PointerEvent / touch / mouse 三条路 → 一种事件）都在 events.ts 里，
  // 这里只负责把自己的 emitPointer 接过去。
  const cleanups: Array<() => void> = [];
  cleanups.push(attachPointerEvents(canvasEl, emitPointer));

  // --- 滚轮（T36）---------------------------------------------------------
  // 归一（deltaMode → 像素、视口坐标 → 画布坐标）都在 events.ts，
  // 这里只把自己的 emitWheel 接过去。桌面浏览器全都有滚轮，所以 web 恒暴露 onWheel。
  const emitWheel = (x: number, y: number, deltaX: number, deltaY: number, time: number): void => {
    const e: GameWheelEvent = { x, y, deltaX, deltaY, time };
    for (const cb of [...wheelListeners]) cb(e);
  };
  cleanups.push(attachWheelEvents(canvasEl, emitWheel));

  // target 允许是 window / document，所以按 EventTarget 收；
  // 事件类型由调用处显式给泛型参数，回调里拿到的就是具体事件。
  const listen = <E extends Event>(
    target: EventTarget,
    type: string,
    fn: (ev: E) => void,
    options?: AddEventListenerOptions,
  ): void => {
    const handler = fn as EventListener;
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  // --- resize --------------------------------------------------------------
  // 视口变了（转屏、窗口缩放、地址栏收起、**软键盘弹起**）就重算画布尺寸并通知订阅者。
  // 软键盘也是从这条路进来的：keyboard 的 open/close 会调 emitResize，
  // 否则键盘顶起视口后画布不重排、输入框会被键盘挡住。
  const emitResize = (): void => {
    applyBox();
    for (const cb of [...resizeListeners]) cb(screen);
  };
  listen<UIEvent>(window, 'resize', emitResize);

  // --- 键盘 ---------------------------------------------------------------
  listen<KeyboardEvent>(window, 'keydown', (e) => {
    for (const cb of [...keyListeners]) cb(e.key, true);
  });
  listen<KeyboardEvent>(window, 'keyup', (e) => {
    for (const cb of [...keyListeners]) cb(e.key, false);
  });

  // --- 前后台 -------------------------------------------------------------
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      for (const cb of [...showListeners]) cb();
    } else {
      for (const cb of [...hideListeners]) cb();
    }
  };
  listen<Event>(document, 'visibilitychange', onVisibility);

  // --- 存储 ---------------------------------------------------------------
  const storage: KeyValueStore = {
    get<T>(key: string): T | null {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return null;
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    set<T>(key: string, value: T): boolean {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        // 隐私模式 / 配额满：静默失败，调用方从 false 得知没存上
        return false;
      }
    },
    remove(key: string): void {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // 同上，删不掉就当没删
      }
    },
  };

  // --- 图片 ---------------------------------------------------------------
  const loadImage = (src: string): Promise<GameImage | null> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () =>
        resolve({
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          native: img,
        });
      img.onerror = () => resolve(null);
      img.src = src;
    });

  // --- 音频 ---------------------------------------------------------------
  // 具体实现（含 HTMLAudioElement 的 pause/resume 语义）在 audio.ts 里。
  const createAudio = createWebAudio;

  // --- wasm ---------------------------------------------------------------
  // web 有 fetch，WASM 直接走标准 WebAssembly；小游戏端才需要平台自己的加载器。
  const wasm: WasmLoader = {
    instantiate: async (path: string, imports?: Record<string, unknown>) => {
      const res = await fetch(path);
      const bytes = await res.arrayBuffer();
      // 契约里的 imports 是宽松的 Record<string, unknown>，
      // 而 WebAssembly.instantiate 要求 Imports（值必须是可实例化的）。
      const { instance } = await WebAssembly.instantiate(
        bytes,
        imports as WebAssembly.Imports | undefined,
      );
      return instance;
    },
  };

  const canvas: GameCanvas = {
    get width(): number {
      return screen.width;
    },
    get height(): number {
      return screen.height;
    },
    getContext: (type: '2d') => canvasEl.getContext(type),
    native: canvasEl,
  };

  // --- 软键盘 --------------------------------------------------------------
  // 真 <input> 盖在画布上；open/close 会回调 emitResize（软键盘改视口高度）。
  const keyboard = createWebKeyboard(canvasEl, emitResize);

  // --- 离屏画布（T30）------------------------------------------------------
  // 与上屏画布共用同一份「元素 → 契约」包装；尺寸由调用方按物理像素给。
  const createCanvas = (width: number, height: number): GameCanvas =>
    wrapCanvas(createDetachedCanvas(width, height));

  const subscribe = <T>(set: Set<T>, cb: T): Unsubscribe => {
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  };

  // web 的能力表：原生广告/分享/震动都没有，不给就不实现，避免「can 说有、方法却缺」。
  // soft-keyboard 是真的有（造个 <input> 就行），keyboard 指的是物理键盘。
  const caps = new Set<Capability>([
    'pointer',
    'touch-multi',
    'keyboard',
    'soft-keyboard',
    'safe-area',
    'audio',
    'storage',
    'wasm',
    'net',
    'websocket',
  ]);

  return {
    name: 'web',
    canvas,
    get screen(): ScreenInfo {
      return screen;
    },
    can: (cap: Capability): boolean => caps.has(cap),
    onResize: (cb: (s: ScreenInfo) => void) => subscribe(resizeListeners, cb),
    onPointer: (cb: (e: GamePointerEvent) => void) => subscribe(pointerListeners, cb),
    onKey: (cb: (key: string, down: boolean) => void) => subscribe(keyListeners, cb),
    // 桌面浏览器全都有滚轮事件，web 恒暴露 onWheel（手机浏览器也可能有触控板/外接鼠标）
    onWheel: (cb: WheelListener) => subscribe(wheelListeners, cb),
    onShow: (cb: () => void) => subscribe(showListeners, cb),
    onHide: (cb: () => void) => subscribe(hideListeners, cb),
    loadImage,
    storage,
    net: createWebNet(),
    createCanvas,
    createAudio,
    keyboard,
    wasm,
  };
};
