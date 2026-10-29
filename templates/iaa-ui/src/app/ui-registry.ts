/** 默认模板只注册通用组件；旧业务件仍可显式使用 createDefaultUiRegistry。 */
import { createWidgetRegistry } from './deps';
import type { ComponentRegistry } from './deps';
/** 构建期与运行时均来自 WIDGET_COMPONENTS，新增组件不再维护数字副本。 */
export const createRegistry = (): ComponentRegistry => createWidgetRegistry();
