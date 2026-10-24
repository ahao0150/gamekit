/**
 * platformer 的 `.ui` 组件注册表（T45）。
 *
 * 为什么单独一个文件：**构建期与运行时必须是同一个工厂**。
 * - 构建期：`vite.config.ts` 用它生成 `.ui` 编译选项（knownComponents / componentProps），
 *   写错组件名在 `mg build` 阶段直接报错；
 * - 运行时：`ui.ts` 用同一份注册表做 `bindComponents`，量尺寸 / 拿定义。
 *
 * 只注册真正用到的组件（不是整包 widgets）：包体按引用计入，HUD 只用到
 * panel / label / progress 三个通用件，加内置的 coinBadge / statusText / card0 /
 * primaryButton —— 没用的组件不进包。
 */

import { createBuiltinRegistry } from '../../../../packages/runtime/src/core/ui/builtin';
import type { ComponentRegistry } from '../../../../packages/runtime/src/core/ui/components';
import { label } from '../../../../packages/runtime/src/core/ui/widgets/label';
import { panel } from '../../../../packages/runtime/src/core/ui/widgets/panel';
import { progress } from '../../../../packages/runtime/src/core/ui/widgets/progress';

/** 新建注册表：内置 9 个 + HUD / 浮层用到的 3 个通用件。 */
export const createPlatformerRegistry = (): ComponentRegistry => {
  const registry = createBuiltinRegistry();
  registry.register(label);
  registry.register(panel);
  registry.register(progress);
  return registry;
};
