/**
 * 组件注册表：内置 9 个业务件 + 通用组件库 22 个 = **31 个组件**。
 *
 * 22 个通用件里有三个是后来补的：`grid` / `scroll`（T31）、`input`（T34）——
 * 早先文档写「19 个 / 28 个」就是漏了它们。唯一真源是 `WIDGET_COMPONENTS` 的长度
 * （`packages/runtime/src/core/ui/widgets/index.ts`），别照文档数字抄。
 *
 * **构建期与运行时必须是同一个工厂**：`vite.config.ts` 用它生成 `.ui` 编译选项
 * （knownComponents / componentProps），游戏运行时用它做 `bindComponents`。
 * 两边共用一份，才不会出现「构建说合法、运行时说未知组件」。
 *
 * 想加自己的组件：`registry.register(defineComponent('myCard', { ... }))`（见 deps.ts），
 * 改完 `mg build` 会在构建期校验 `.ui` 里的组件名，拼错直接报「未知组件」。
 */

import { createBuiltinRegistry } from './deps';
import { WIDGET_COMPONENTS } from './deps';
import type { ComponentRegistry } from './deps';

export const createRegistry = (): ComponentRegistry => {
  const registry = createBuiltinRegistry();
  // 通用组件（progress / panel / label / button / input / list / grid / scroll / slider / tabs / … 共 22 个）：
  // 不注册它们，`.ui` 里写 `progress` 会构建失败（报「未知组件」）。
  for (const comp of WIDGET_COMPONENTS) registry.register(comp);
  return registry;
};
