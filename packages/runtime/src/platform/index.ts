/**
 * 平台注册入口。
 *
 * 为什么这样实现：
 * 1. **加一个平台 = 加一个目录 + 这里两行**（import 一行、register 一行）。
 *    契约、core、业务代码一行都不用动 —— 这是整个框架「厂商适配器可扩展」的核心，
 *    AGENTS.md §3 把这 6 步写成了标准流程，这里就是第 5 步的落点。
 * 2. **注册表是显式对象，不做模块级单例**。AGENTS 铁律 3 禁全局可变状态，
 *    所以这里提供 createPlatformRegistry() 让调用方自己拿一份；
 *    需要一份「已注册好四个平台」的实例时用 resolvePlatform() 一句话搞定。
 * 3. **mock 也在注册列表里**，但它的 probe 默认恒 false —— 真实环境里
 *    它「在册但不生效」，doctor 能看见它，又绝不会在真机上把 web 顶掉。
 */

import { createRegistry } from './registry';
import { register as registerWeb } from './web';
import { register as registerWechat } from './wechat';
import { register as registerDouyin } from './douyin';
import { register as registerMock } from './mock';
import type { PlatformAdapter, PlatformBootOptions, PlatformRegistry } from './contract';

export { createRegistry } from './registry';
export { ZERO_INSETS } from './contract';
export type { ResumableAudioHandle } from './audio';
export type {
  AdService,
  AudioHandle,
  BannerOptions,
  Capability,
  Ctx2D,
  GameCanvas,
  GameImage,
  Insets,
  KeyValueStore,
  MenuButtonRect,
  PlatformAdapter,
  PlatformBootOptions,
  PlatformFactory,
  PlatformProbe,
  PlatformRegistration,
  PlatformRegistry,
  PointerEvent,
  PointerSample,
  RewardResult,
  ScreenInfo,
  ShareOptions,
  Unsubscribe,
  WasmLoader,
  OnWheel,
  WheelEvent,
  WheelListener,
} from './contract';

/** 把四个平台实现各注册一次。新增平台就在这里加一行 import + 一行调用。 */
export const registerAll = (registry: PlatformRegistry): void => {
  registerWeb(registry);
  registerWechat(registry);
  registerDouyin(registry);
  registerMock(registry);
};

/** 造一份已经注册好四个平台的注册表。 */
export const createPlatformRegistry = (): PlatformRegistry => {
  const registry = createRegistry();
  registerAll(registry);
  return registry;
};

/** 一步到位：建注册表 → 注册四个平台 → 探测并创建适配器。 */
export const resolvePlatform = async (opts: PlatformBootOptions): Promise<PlatformAdapter> => {
  const registry = createPlatformRegistry();
  return registry.resolve(opts);
};
