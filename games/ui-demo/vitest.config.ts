import { defineConfig } from 'vitest/config';
import { optionsFromRegistry, uiPlugin } from '../../packages/ui-plugin/src/index';
import { createDemoRegistry } from './src/app/ui-registry';

/**
 * 测试也要能 `import menuUi from '../../ui/menu.ui'`：挂上构建期同一个 uiPlugin
 * （dev / build / test 三处走同一份编译函数）。编译选项同样来自组件注册表。
 *
 * allow 放开到仓库根，是因为 runtime 还没有根 barrel，从源码相对路径取 core
 * （见 src/app/deps.ts）；barrel 落地后这里也可以收紧。
 */
export default defineConfig({
  plugins: [uiPlugin(optionsFromRegistry(createDemoRegistry()))],
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
