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

import { createBuiltinRegistry, defineComponent, primaryButton } from './deps';
import { WIDGET_COMPONENTS } from './deps';
import type { ComponentRegistry } from './deps';

/// 自绘容器占位：不画任何东西，只让 `.ui` 的 region 在 rects 里产出矩形。
/// T63：盘面 / 临时位 / 色块池 / 道具条 / 温度条各自一个 region，不重叠由布局求解保证；
/// 几何换算只在 board-geom.ts 里做（别在绘制或输入里按 viewport 算）。
const areaPlaceholder = (name: string): ReturnType<typeof defineComponent> =>
  defineComponent(name, {
    props: {},
    defaultSize: { w: 320, h: 240 },
    measure: (_env, box) => ({ w: box.w, h: box.h }),
    draw: () => {},
  });

export const AREA_COMPONENTS = ['boardArea', 'playArea', 'slotArea', 'poolArea', 'toolBar', 'tempBar', 'hudSlot', 'dialogPanel', 'backdropMask'] as const;

/**
 * 首页的声音开关（T73 合并音效/音乐）。
 *
 * 为什么需要它：`.ui` 里**同一界面的组件名必须唯一**（rects 以组件名为键），而胶囊类
 * 组件只有 `primaryButton` / `secondaryButton` 三个名字 —— 首页已经有继续拼豆 / 关卡选择，
 * 还要一个声音开关。
 *
 * 做法是把 `primaryButton` 的 def 换一个名字再注册一份：它走 `drawCapsule`，
 * **自动吃 `ui/btn-primary_normal` 胶囊素材**（之前复用 `button` 的 def 是错的 ——
 * 那个组件找 `ui/button_normal`，key 对不上，只能回退直角色块）。
 */
const soundToggle = defineComponent('soundToggle', primaryButton.def);

export const createRegistry = (): ComponentRegistry => {
  const registry = createBuiltinRegistry();
  // 通用组件（progress / panel / label / button / input / list / grid / scroll / slider / tabs / … 共 22 个）：
  // 不注册它们，`.ui` 里写 `progress` 会构建失败（报「未知组件」）。
  for (const comp of WIDGET_COMPONENTS) registry.register(comp);
  for (const name of AREA_COMPONENTS) registry.register(areaPlaceholder(name));
  registry.register(soundToggle);
  return registry;
};
