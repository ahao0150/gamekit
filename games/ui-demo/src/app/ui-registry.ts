/**
 * demo 的组件注册表：内置 9 个 + 通用组件 21 个 + 自定义 2 个（`tapTarget` / `scorePanel`）。
 *
 * **构建期与运行时必须是同一个工厂**：`vite.config.ts` 用它生成 `.ui` 编译选项
 * （knownComponents / componentProps），游戏运行时用它做 `bindComponents`。
 * 两边共用一份，才不会出现「构建说合法、运行时说未知组件」。
 *
 * T13d 之前只注册了内置 9 个 + 自定义 2 个，通用组件库（`core/ui/widgets` 的 21 个）
 * 一个都没接 —— `.ui` 里写 `progress` / `button` / `list` 构建直接失败。这里补上。
 *
 * T31 加 `grid` / `scroll` 后是 21 个（清单在 `widgets/index.ts` 的 `WIDGET_COMPONENTS`），
 * 总数 9 + 21 + 2 = **32 个**。
 */

import { createBuiltinRegistry } from '../../../../packages/runtime/src/core/ui/builtin';
import type { ComponentRegistry } from '../../../../packages/runtime/src/core/ui/components';
import { WIDGET_COMPONENTS } from '../../../../packages/runtime/src/core/ui/widgets/index';
import { scorePanel, tapTarget } from './custom-components';

/**
 * demo 注册表：内置 9 个 + 通用 21 个 + 自定义 2 个 = **32 个组件**。
 *
 * 注册顺序先内置、再通用、最后自定义：同名会直接抛错（`register` 的契约），
 * 所以顺序不影响正确性，只影响「未知组件」报错里列出来的名单顺序。
 */
export const createDemoRegistry = (): ComponentRegistry => {
  const registry = createBuiltinRegistry();
  for (const comp of WIDGET_COMPONENTS) registry.register(comp);
  registry.register(tapTarget);
  registry.register(scorePanel);
  return registry;
};
