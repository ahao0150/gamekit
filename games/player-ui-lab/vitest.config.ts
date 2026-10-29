import { defineConfig } from 'vitest/config';
import { optionsFromRegistry, uiPlugin } from '../../packages/ui-plugin/src/index';
import { createPlayerRegistry } from './src/app/ui-registry';

/**
 * 测试是「纯 Node」：布局与几何都是纯函数，不碰 DOM、不起浏览器。
 *
 * 必须挂 `uiPlugin`：`layout.test.ts` 直接 `import player.ui`，
 * 靠它把 `.ui` 编成数据模块（与 `mg build` 同一条编译链、同一份注册表）。
 * `@mg/runtime` 别名让包名导入在 Vitest 里解析到源码（与模板同款）。
 */
export default defineConfig({
  plugins: [uiPlugin({ ...optionsFromRegistry(createPlayerRegistry()) })],
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
    alias: {
      '@mg/runtime/mock': new URL('../../packages/runtime/src/platform/mock/index.ts', import.meta.url)
        .pathname,
      '@mg/runtime': new URL('../../packages/runtime/src/index.ts', import.meta.url).pathname,
    },
  },
});
