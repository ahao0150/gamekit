/**
 * 组件注册表：内置 9 个 + 本工程 9 个（put 名与设计稿 `data-name` 一一对应）。
 *
 * **构建期与运行时必须是同一个工厂**：`vite.config.ts` 用它生成 `.ui` 编译选项，
 * 运行时用它 `bindComponents` / 取组件 draw。两边共用一份，才不会「构建说合法、运行时说未知组件」。
 */

import { createBuiltinRegistry } from './deps';
import type { ComponentRegistry } from './deps';
import { PLAYER_COMPONENTS } from './custom-components';

export const createPlayerRegistry = (): ComponentRegistry => {
  const registry = createBuiltinRegistry();
  for (const comp of PLAYER_COMPONENTS) registry.register(comp);
  return registry;
};
