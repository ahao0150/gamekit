import { defineConfig } from 'vitest/config';
import { optionsFromRegistry, uiPlugin } from '../../packages/ui-plugin/src/index';
import { createPlatformerRegistry } from './src/app/ui-registry';

/**
 * `.ui` 测试也要能 `import hudUi from '../../ui/hud.ui'`：挂上构建期同一个 uiPlugin。
 *
 * 测试是「纯 Node + mock 平台」，不碰 DOM；allow 放开到仓库根，是因为 runtime
 * 还没有根 barrel，游戏从源码相对路径取 core（见 src/app/deps.ts）。
 */
export default defineConfig({
  plugins: [uiPlugin(optionsFromRegistry(createPlatformerRegistry()))],
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
