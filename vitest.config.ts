import { defineConfig } from 'vitest/config';
import { uiPlugin } from './packages/ui-plugin/src/index';

export default defineConfig({
  // `.ui` 模板（templates/iaa-ui）的测试会 import 界面模块，根测试必须也能编译 `.ui`；
  // 这里挂**不传选项**的 uiPlugin（只编译、不校验组件名）—— 组件名校验由各游戏自己的
  // `vite.config.ts` / `vitest.config.ts` 用各自的注册表做（不同游戏注册表不同）。
  plugins: [uiPlugin()],
  resolve: {
    alias: {
      '@mg/runtime/mock': new URL('./packages/runtime/src/platform/mock/index.ts', import.meta.url)
        .pathname,
      '@mg/runtime': new URL('./packages/runtime/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    // 模板的测试也要进根 `pnpm -w test`：模板是所有新游戏的起点，
    // 它坏了必须在 CI 的门槛上暴露，而不是等某个人想起来单独跑 --root。
    include: [
      'packages/**/src/**/*.test.ts',
      'templates/**/src/**/*.test.ts',
      'tools/**/*.test.mjs',
    ],
    environment: 'node',
    globals: false,
  },
});
