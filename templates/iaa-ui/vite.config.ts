import { defineConfig } from 'vite';
import { createDefaultUiRegistry } from '../../packages/runtime/src/core/ui/default-registry';
import { optionsFromRegistry, uiPlugin } from '../../packages/ui-plugin/src/index';

/**
 * `.ui` 编译链：**这个文件是 iaa-ui 模板与 iaa-simple 的核心区别**。
 *
 * `mg build` 只挂 `@mg/vite`（三端构建），`.ui` 由游戏自己的 Vite 配置挂 `@mg/ui-plugin`。
 * 编译选项从**默认完整注册表**生成（与 `ui-registry.ts` / 离线 ui.check 同口径）。
 * 配置文件不经 `@mg/runtime` barrel（Node 原生 ESM 读 config 时会绊倒无扩展名导入）。
 */
export default defineConfig({
  plugins: [uiPlugin(optionsFromRegistry(createDefaultUiRegistry()))],
  resolve: {
    alias: {
      '@mg/runtime/mock': new URL('../../packages/runtime/src/platform/mock/index.ts', import.meta.url)
        .pathname,
      '@mg/runtime': new URL('../../packages/runtime/src/index.ts', import.meta.url).pathname,
    },
  },
});
