/**
 * 内置组件清单与现成注册表。
 *
 * 为什么是工厂不是模块级单例：AGENTS 铁律 3「无全局可变状态」——注册表是
 * 可变的（`register`），做成单例就等于给全局塞了一个可写对象，测试之间会串。
 * 每次 `createBuiltinRegistry()` 新建一份，谁也污染不到谁。
 */

import type { ComponentRegistry } from './components';
import { createComponentRegistry } from './components';
import { coinBadge, pause, primaryButton, secondaryButton, statusText } from './builtin-parts';
import { card0, card1, infoPanel, parcelGrid } from './builtin-panel';

/**
 * 内置组件（9 个）。
 *
 * 6 个是 T7 指定的通用件（按钮 / 徽章 / 状态文字 / 暂停 / 网格），另外 3 个
 * （`infoPanel` / `card0` / `card1`）是 `home.ui` 里已有的布局槽位——不注册它们，
 * `knownComponents` 校验一接就红，所以必须有定义（面板 / 卡片）。
 */
export const BUILTIN_COMPONENTS = [
  primaryButton,
  secondaryButton,
  coinBadge,
  statusText,
  pause,
  parcelGrid,
  infoPanel,
  card0,
  card1,
] as const;

/** 新建一个装好内置组件的注册表。 */
export const createBuiltinRegistry = (): ComponentRegistry => {
  const registry = createComponentRegistry();
  for (const comp of BUILTIN_COMPONENTS) registry.register(comp);
  return registry;
};
