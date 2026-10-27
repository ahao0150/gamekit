import { existsSync } from 'node:fs';
import { configDefaults, defineConfig } from 'vitest/config';
import { uiPlugin } from './packages/ui-plugin/src/index';

/**
 * 《快递装车员》只在完整版仓库里；开源版（GitHub）不带这个游戏。
 *
 * 但有两个测试文件在**模块顶层**就静态引用了它的 `ui/home.ui` 与 `src/app/layout`，
 * 目录不存在时整个文件加载即崩（`ENOENT` / `Cannot find module`），`pnpm -w test` 直接红，
 * 而断言本身一条都没失败 —— 这种红会被误读成「代码坏了」。
 *
 * 按目录存在性决定是否排除：完整版照跑这两个测试，开源版自动跳过。
 */
const HAS_KUAIDI_LOAD = existsSync(new URL('./games/kuaidi-load', import.meta.url));

/** 依赖 `games/kuaidi-load` 的测试文件（完整版才跑）。 */
const KUAIDI_ONLY_TESTS = [
  '**/packages/runtime/src/core/ui/layout.kuaidi.test.ts',
  '**/packages/debug-mcp/src/ui-tools.test.ts',
];

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
    // 保留 vitest 的默认排除（node_modules / dist 等），只在缺 kuaidi-load 时追加两个文件。
    exclude: [...configDefaults.exclude, ...(HAS_KUAIDI_LOAD ? [] : KUAIDI_ONLY_TESTS)],
    environment: 'node',
    globals: false,
  },
});
