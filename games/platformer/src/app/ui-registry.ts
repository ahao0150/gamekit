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
 *
 * T80：新增三个触屏按键组件（touchLeft / touchRight / touchJump）。它们共用同一个
 * 定义、只是名字不同（一个 `.ui` 界面里组件名必须唯一），位置由 `ui/controls.ui`
 * 的约束算出 —— 取代原先写死 390×844 绝对坐标的 `TOUCH` 常量。
 */

import { createBuiltinRegistry } from '../../../../packages/runtime/src/core/ui/builtin';
import { drawCenteredText } from '../../../../packages/runtime/src/core/ui/builtin-draw';
import { boolProp, defineComponent, stringProp } from '../../../../packages/runtime/src/core/ui/components';
import type { ComponentDef, ComponentRegistry } from '../../../../packages/runtime/src/core/ui/components';
import { label } from '../../../../packages/runtime/src/core/ui/widgets/label';
import { panel } from '../../../../packages/runtime/src/core/ui/widgets/panel';
import { progress } from '../../../../packages/runtime/src/core/ui/widgets/progress';

/** 触屏按键边长（逻辑像素）。`contain` 下 320 屏的画布只有 ~262 宽，76 是三个一排放得下的上限附近。 */
export const TOUCH_BUTTON = 76;

/** `.ui` 里的按键节点名 → 动作键（命中与绘制走同一份矩形）。 */
export const TOUCH_NODES = [
  ['left', 'touchLeft'],
  ['right', 'touchRight'],
  ['jump', 'touchJump'],
] as const;

/**
 * 触屏按键：半透明圆 + 字形，按下时变亮。
 *
 * 边界与其它组件一致：只读 props / deps，不读游戏状态。按下态由 `ui.ts` 每帧注入，
 * 位置由 `.ui` 求解后传进来的 `box` 决定 —— 组件自己不算坐标。
 */
const touchButtonDef: ComponentDef = {
  props: { glyph: 'string', pressed: 'boolean' },
  defaultSize: { w: TOUCH_BUTTON, h: TOUCH_BUTTON },
  measure: () => ({ w: TOUCH_BUTTON, h: TOUCH_BUTTON }),
  draw: (ctx, box, props, deps) => {
    const radius = Math.min(box.w, box.h) / 2;
    ctx.save();
    ctx.fillStyle = boolProp(props, 'pressed') ? 'rgba(237,244,238,0.42)' : 'rgba(237,244,238,0.18)';
    ctx.beginPath();
    ctx.arc(box.x + box.w / 2, box.y + box.h / 2, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawCenteredText(ctx, box, stringProp(props, 'glyph'), deps.theme.light, deps.theme.fontFamily);
  },
};

/** 新建注册表：内置 9 个 + HUD / 浮层用到的 3 个通用件 + 3 个触屏按键。 */
export const createPlatformerRegistry = (): ComponentRegistry => {
  const registry = createBuiltinRegistry();
  registry.register(label);
  registry.register(panel);
  registry.register(progress);
  for (const [, node] of TOUCH_NODES) registry.register(defineComponent(node, touchButtonDef));
  return registry;
};
