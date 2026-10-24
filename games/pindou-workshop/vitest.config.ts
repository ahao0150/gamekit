import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { optionsFromRegistry, uiPlugin } from '../../packages/ui-plugin/src/index';
import { createRegistry } from './src/app/ui-registry';

/**
 * 模板测试是「纯 Node + mock 平台」，不碰 DOM。
 *
 * **必须挂 `uiPlugin`**：`layout.ts` 会 `import homeUi from '../../ui/home.ui'`，
 * 没有插件时 Vitest（同样走 Vite）会把 `.ui` 当 JS 解析，报
 * `RolldownError: Parse failure: Parse failed with 1 error`。
 *
 * `virtual:mg-manifest` / `virtual:mg-atlas` 是 `@mg/vite` 在**构建期**注入的，
 * Node 测试里没有构建，所以 alias 到两个替身（空清单 / 无图集）——顺带就是
 * 「一张图都加载不到」的回退环境（见 assets.ts 的 ART_KEYS）。
 *
 * `allow` 放开到仓库根，是因为 runtime 还没有根 barrel，模板从源码相对路径引 core
 * （见 src/app/deps.ts）；barrel 落地后这里也可以收紧。
 */
export default defineConfig({
  resolve: {
    alias: {
      'virtual:mg-manifest': fileURLToPath(new URL('./src/app/test-manifest.ts', import.meta.url)),
      'virtual:mg-atlas': fileURLToPath(new URL('./src/app/test-atlas.ts', import.meta.url)),
    },
  },
  plugins: [uiPlugin(optionsFromRegistry(createRegistry()))],
  test: {
    environment: 'node',
    globals: false,
  },
  server: {
    fs: {
      allow: ['../..'],
    },
  },
});
