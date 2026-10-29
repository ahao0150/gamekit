import { defineConfig } from 'vitest/config';
import { createWidgetRegistry } from '../../packages/runtime/src/core/ui/widgets/index';
import { optionsFromRegistry, uiPlugin } from '../../packages/ui-plugin/src/index';

/**
 * 模板测试是「纯 Node + mock 平台」，不碰 DOM。
 *
 * **必须挂 `uiPlugin`**：`layout.ts` 会 `import homeUi from '../../ui/home.ui'`。
 * 注册表用 `createWidgetRegistry()`（与运行时 ui-registry / 离线 ui.check 同口径）。
 * 这里不经 `@mg/runtime` barrel：Vite 读 config 时走 Node 原生 ESM，barrel 里的
 * 无扩展名相对导入会解析失败。
 */
export default defineConfig({
  plugins: [uiPlugin(optionsFromRegistry(createWidgetRegistry()))],
  test: {
    environment: 'node',
    globals: false,
  },
  server: {
    fs: {
      allow: ['../..'],
    },
  },
  resolve: {
    // 测试源码里的 `@mg/runtime` 走 Vite 解析（能处理 TS / 无扩展名）
    alias: {
      '@mg/runtime/mock': new URL('../../packages/runtime/src/platform/mock/index.ts', import.meta.url)
        .pathname,
      '@mg/runtime': new URL('../../packages/runtime/src/index.ts', import.meta.url).pathname,
    },
  },
});
