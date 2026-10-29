/**
 * `.ui` 编译链：把 `ui/player.ui` 编译成数据模块，构建期用**运行时同一份注册表**校验组件名与 style 键。
 */
import { defineConfig } from 'vite';
import { optionsFromRegistry, uiPlugin } from '../../packages/ui-plugin/src/index';
import { createPlayerRegistry } from './src/app/ui-registry';

export default defineConfig({
  plugins: [uiPlugin({ ...optionsFromRegistry(createPlayerRegistry()) })],
  server: {
    // 验收要连续读状态，期间其它 Bot 改文件会整页 reload → 状态清空。需要热更新时再打开。
    watch: null,
    hmr: false,
  },
});
