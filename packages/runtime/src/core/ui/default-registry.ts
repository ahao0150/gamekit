/**
 * 构建期 / 离线 ui.check / 模板共用的「完整」组件注册表：
 * 内置 9 个业务件 + 通用 22 个 = 31 个。
 *
 * 与游戏 `ui-registry.ts` 同口径，避免「vite 说合法、ui.check 说未知」或反过来。
 */

import { createBuiltinRegistry } from './builtin';
import type { ComponentRegistry } from './components';
import { WIDGET_COMPONENTS } from './widgets/index';

/** 新建一份装满 31 个组件的注册表（每次新实例，无全局可变单例）。 */
export const createDefaultUiRegistry = (): ComponentRegistry => {
  const registry = createBuiltinRegistry();
  for (const comp of WIDGET_COMPONENTS) registry.register(comp);
  return registry;
};
