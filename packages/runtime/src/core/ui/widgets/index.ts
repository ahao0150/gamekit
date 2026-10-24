/**
 * 通用 UI 组件库（T15 起逐步补齐，T34 共 22 个）。
 *
 * 与 `builtin.ts`（kuaidi 业务件）并列的**通用层**：进度条 / 三态按钮 / 九宫格面板 /
 * 文本 / 图标 / 角标 / 分割线 / 头像 / 列表 / **输入框** / 轻提示 / 滑杆 / 开关 / 复选框 / 单选 /
 * 标签栏 / 分段控件 / 数字键盘 / 滚动条 / 轮播 / **网格** / **滑动容器**。
 * 全部走现有 `defineComponent` 契约，颜色从 `DrawDeps.theme` 取，素材缺失回落纯色，
 * 不新增任何抽象。
 *
 * 用法：
 * ```ts
 * const registry = createWidgetRegistry();
 * const bound = bindComponents(parsed.spec, { registry, env });
 * ```
 */

import { createComponentRegistry } from '../components';
import type { ComponentRegistry } from '../components';
import { avatar } from './avatar';
import { badge } from './badge';
import { button } from './button';
import { carousel } from './carousel';
import { checkbox } from './checkbox';
import { divider } from './divider';
import { grid } from './grid';
import { icon } from './icon';
import { input } from './input';
import { keypad } from './keypad';
import { label } from './label';
import { list } from './list';
import { panel } from './panel';
import { progress } from './progress';
import { radio } from './radio';
import { scroll } from './scroll';
import { scrollbar } from './scrollbar';
import { segmented } from './segmented';
import { slider } from './slider';
import { switchToggle } from './switch';
import { tabs } from './tabs';
import { toast } from './toast';

export {
  avatar,
  badge,
  button,
  carousel,
  checkbox,
  divider,
  grid,
  icon,
  input,
  keypad,
  label,
  list,
  panel,
  progress,
  radio,
  scroll,
  scrollbar,
  segmented,
  slider,
  switchToggle,
  tabs,
  toast,
};
export { fitText, cursorVisibleAt } from './input';
export type { ListRenderItem } from './list';
export type { ScrollRenderContent } from './scroll';
export { keypadHit } from './keypad-hit';
export type { KeypadOptions } from './keypad-hit';

/** 通用组件清单（注册顺序 = 这里的顺序）。 */
export const WIDGET_COMPONENTS = [
  progress,
  button,
  panel,
  label,
  icon,
  badge,
  divider,
  avatar,
  list,
  input,
  toast,
  slider,
  switchToggle,
  checkbox,
  radio,
  tabs,
  segmented,
  keypad,
  scrollbar,
  carousel,
  grid,
  scroll,
] as const;

/** 新建一个装好通用组件的注册表（每次一份，无全局可变状态）。 */
export const createWidgetRegistry = (): ComponentRegistry => {
  const registry = createComponentRegistry();
  for (const comp of WIDGET_COMPONENTS) registry.register(comp);
  return registry;
};
