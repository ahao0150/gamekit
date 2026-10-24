import { defineConfig } from 'vite';
import { optionsFromRegistry, uiPlugin } from '../../packages/ui-plugin/src/index';
import { createRegistry } from './src/app/ui-registry';

/**
 * `.ui` 编译链：**这个文件是 iaa-ui 模板与 iaa-simple 的核心区别**。
 *
 * `mg build` 只挂 `@mg/vite`（三端构建），`.ui` 由游戏自己的 Vite 配置挂 `@mg/ui-plugin`。
 * 没有它，`import homeUi from '../../ui/home.ui'` 会在构建期报
 * `[PARSE_ERROR] Invalid Character` at `ui/home.ui:1:2`（被当成 JS 解析）。
 *
 * 编译选项从**同一个组件注册表**生成：构建期校验的组件名 / style 键，与运行时
 * `bindComponents` 用的是同一份 —— 不会出现「构建说合法、运行时说未知组件」。
 */
export default defineConfig({
  plugins: [uiPlugin(optionsFromRegistry(createRegistry()))],
});
