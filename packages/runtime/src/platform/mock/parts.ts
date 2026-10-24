/**
 * mock 平台的各个「零件」：假 storage / 假画布 / 假图片 / 假音频 / 假广告。
 *
 * 为什么单独一个文件：
 * mock 适配器本身只是「把这些零件装配起来 + 提供 emit* 的手动触发口子」。
 * 零件各自独立成函数后，适配器主体就只剩装配逻辑，读起来就是契约本身，
 * 单文件也能压在 300 行以内（AGENTS 铁律 2）。
 *
 * 所有零件都不碰真实环境：没有 window、没有 document、没有文件系统。
 * 内存 storage 用 Map 存 JSON 字符串，和真实平台的「存的是字符串」保持一致，
 * 这样「存进去是对象、读出来还是对象」这条行为在两端是对齐的。
 */

import type {
  AdService,
  Ctx2D,
  GameCanvas,
  GameImage,
  Insets,
  KeyValueStore,
  RewardResult,
  ScreenInfo,
  WasmLoader,
} from '../contract';
import { ZERO_INSETS } from '../contract';
import type { ResumableAudioHandle } from '../audio';

/** loadImage 的行为：成功 / 失败 / 按 src 判定（返回 true 表示成功）。 */
export type MockImageBehavior = 'ok' | 'fail' | ((src: string) => boolean);

/** 内存版存储：和真实平台一样存 JSON 字符串，get 未命中返回 null。 */
export const createMemoryStorage = (): KeyValueStore => {
  const store = new Map<string, string>();
  return {
    get<T>(key: string): T | null {
      const raw = store.get(key);
      if (raw === undefined) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    set<T>(key: string, value: T): boolean {
      try {
        store.set(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key: string): void {
      store.delete(key);
    },
  };
};

/**
 * 假画布。getContext 返回注入的 ctx（默认 null —— 契约允许 null）。
 * 尺寸跟着屏幕走，所以用 getter 而不是快照。
 */
export const createMockCanvas = (
  getScreen: () => ScreenInfo,
  ctx: Ctx2D | null,
): GameCanvas => ({
  get width(): number {
    return getScreen().width;
  },
  get height(): number {
    return getScreen().height;
  },
  getContext: (): Ctx2D | null => ctx,
  native: { kind: 'mock-canvas' },
});

/** 假图片加载：按行为决定成功还是失败。 */
export const createMockImageLoader = (
  behavior: MockImageBehavior,
): ((src: string) => Promise<GameImage | null>) => {
  return (src: string): Promise<GameImage | null> => {
    const ok = typeof behavior === 'function' ? behavior(src) : behavior === 'ok';
    if (!ok) return Promise.resolve(null);
    return Promise.resolve({ width: 0, height: 0, native: { kind: 'mock-image', src } });
  };
};

/** 假音频：只记录调用，不发声。形态与三端一致（带 pause + resume）。 */
export const createMockAudio = (calls: string[]): ((src: string) => ResumableAudioHandle) => {
  return (src: string): ResumableAudioHandle => {
    void src;
    const push = (name: string): void => {
      calls.push(name);
    };
    return {
      play: () => push('play'),
      pause: () => push('pause'),
      resume: () => push('resume'),
      stop: () => push('stop'),
      setVolume: () => push('setVolume'),
      setLoop: () => push('setLoop'),
      destroy: () => push('destroy'),
    };
  };
};

/**
 * core 形态的假音频。
 *
 * 为什么在这里再写一份「core 形态」：
 * core 的 PlayingAudio 与平台的 AudioHandle 是两套契约 —— 前者有只读的
 * `finished` 和**可选**的 pause/resume，后者 pause 是必需的、没有 finished。
 * 本文件不 import core（平台层不依赖 core），靠 TypeScript 的结构化类型
 * 让这个对象直接能被 core 当作 PlayingAudio 用。
 *
 * 两种形态都要能造出来：
 * - supportsPauseResume = true：带 pause/resume，core 走「暂停后从原处继续」；
 * - supportsPauseResume = false：**对象上不出现**这两个方法，core 走降级分支
 *   （stop + 重播）。注意不能用空函数糊过去 —— 空函数会让 core 以为暂停成功了。
 */
export interface MockPlayingAudio {
  stop(): void;
  pause?(): void;
  resume?(): void;
  /** 只读：播完就是 true。 */
  readonly finished: boolean;
}

export interface MockAudioOptions {
  /** 是否支持 pause/resume，默认 true */
  readonly supportsPauseResume?: boolean;
}

export const createMockPlayingAudio = (
  calls: string[],
  opts?: MockAudioOptions,
): MockPlayingAudio => {
  const supports = opts?.supportsPauseResume ?? true;
  let finished = false;
  const push = (name: string): void => {
    calls.push(name);
  };
  return {
    stop: () => {
      push('stop');
      finished = true;
    },
    ...(supports
      ? {
          pause: () => push('pause'),
          resume: () => push('resume'),
        }
      : {}),
    get finished(): boolean {
      return finished;
    },
  };
};

/** 假广告：记录调用，激励视频返回固定结果。 */
export const createMockAds = (calls: string[], rewarded: RewardResult): AdService => ({
  showBanner: () => {
    calls.push('showBanner');
  },
  hideBanner: () => {
    calls.push('hideBanner');
  },
  showInterstitial: () => {
    calls.push('showInterstitial');
    return Promise.resolve();
  },
  showRewarded: () => {
    calls.push('showRewarded');
    return Promise.resolve(rewarded);
  },
});

/** 假分包：立即成功。 */
export const createMockSubpackage = (): ((name: string) => Promise<void>) => {
  return (name: string): Promise<void> => {
    void name;
    return Promise.resolve();
  };
};

/** 假 wasm：实例化一个空模块，拿到合法实例但没有任何导出。 */
export const createMockWasm = (): WasmLoader => ({
  instantiate: () => {
    const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    return Promise.resolve(new WebAssembly.Instance(new WebAssembly.Module(bytes)));
  },
});

/**
 * 假离屏画布（T30）：尺寸固定（不跟屏幕走），ctx 可注入。
 *
 * 尺寸进 `native`，测试可以据此断言「离屏层建成了多大」；
 * 尺寸归一化与 wx/tt 的 `safeCanvasDimension` 同口径（非法值/0 → 1），
 * 否则 mock 会放过「离屏尺寸 0」这种真实端会静默失效的错。
 */
export const createMockOffscreenCanvas = (
  width: number,
  height: number,
  ctx: Ctx2D | null,
): GameCanvas => {
  const w = Number.isFinite(width) && width > 0 ? Math.round(width) : 1;
  const h = Number.isFinite(height) && height > 0 ? Math.round(height) : 1;
  return {
    width: w,
    height: h,
    getContext: (): Ctx2D | null => ctx,
    native: { kind: 'mock-offscreen-canvas', width: w, height: h },
  };
};

/**
 * 造一个 mock 的 ScreenInfo（T47 从 index.ts 搬出来，那边挤到 300 行上限了）：
 * 尺寸 / dpr / 安全区 / 胶囊全部由构造参数决定；胶囊不传就等于「这台设备没有系统按钮」。
 */
export const createMockScreen = (
  size: { readonly width: number; readonly height: number; readonly dpr?: number; readonly insets?: Insets } | undefined,
  menuButton: ScreenInfo['menuButton'] | undefined,
): ScreenInfo => {
  const width = size?.width ?? 375;
  const height = size?.height ?? 667;
  return {
    width,
    height,
    dpr: size?.dpr ?? 2,
    insets: size?.insets ?? ZERO_INSETS,
    orientation: width >= height ? 'landscape' : 'portrait',
    ...(menuButton === undefined ? {} : { menuButton }),
  };
};
