/**
 * platformer 的 Vite 配置：把 `.ui` 编译链接进 `mg build` / `mg dev`。
 *
 * `mg` 自己只注册 `@mg/vite`（三端构建）；`.ui` 是独立编译链（`@mg/ui-plugin`），
 * 由游戏自己的 Vite 配置挂上。编译选项从**同一个组件注册表**生成：
 * 构建期校验的组件名 / style 键，与运行时 `bindComponents` 用的是同一份定义。
 */
import { defineConfig } from 'vite';
import { optionsFromRegistry, uiPlugin } from '../../packages/ui-plugin/src/index';
import { createPlatformerRegistry } from './src/app/ui-registry';

export default defineConfig({
  plugins: [uiPlugin(optionsFromRegistry(createPlatformerRegistry()))],
  server: {
    // 验收期间不监听文件：别的 Bot 改 runtime / Vite 依赖优化都会整页 reload，
    // 页面重建后游戏状态清空（CDP 验收会间歇性失败）。需要调 UI 时删掉这一行。
    watch: null,
    hmr: false,
  },
});
