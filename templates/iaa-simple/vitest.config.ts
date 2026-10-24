import { defineConfig } from 'vitest/config';

/**
 * 模板测试是「纯 Node + mock 平台」，不碰 DOM。
 * `@mg/runtime` 别名让包名导入在 Vitest 里能解析到源码。
 */
export default defineConfig({
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
