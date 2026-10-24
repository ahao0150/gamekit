/**
 * ui-demo 的 Vite 配置：把 `.ui` 编译链接进 `mg build` / `mg dev`。
 *
 * `mg` 自己只注册 `@mg/vite`（三端构建）；`.ui` 是独立编译链（`@mg/ui-plugin`），
 * 由游戏自己的 Vite 配置挂上。编译选项从**同一个组件注册表**生成：
 * 构建期校验的组件名 / style 键，与运行时 `bindComponents` 用的是同一份定义。
 */
import { defineConfig } from 'vite';
import { optionsFromRegistry, uiPlugin } from '../../packages/ui-plugin/src/index';
import { createDemoRegistry } from './src/app/ui-registry';

export default defineConfig({
  plugins: [
    uiPlugin({
      ...optionsFromRegistry(createDemoRegistry()),
      // 91e2d57 一次加入的组件演示稿：只用于离线 ui.check / preview，尚未接入游戏主循环。
      // 接入前先在这里登记，避免 mg build 的孤儿检查一直红着（新增的意外孤儿仍然会报）。
      orphanExclude: [
        'ui/carousel.ui',
        'ui/controls.ui',
        'ui/drag.ui',
        'ui/grid.ui',
        'ui/list.ui',
        'ui/nav.ui',
        'ui/scroll.ui',
        'ui/scrollbar.ui',
        'ui/toast.ui',
        'ui/widgets.ui',
      ],
    }),
  ],
  server: {
    // 完全关掉 dev 的文件监听：这个 demo 用于端到端运行时验收，验收要连续操作
    // 十几秒。期间任何文件变化（别的 Bot 改 runtime / .ui、Vite 自身的依赖优化）
    // 都会整页 reload —— 页面重建后游戏状态清空、调试 bridge 重连，验收会间歇性
    // 失败（实测 popup 三条点击时好时坏）。需要热更新调 UI 时删掉这一行恢复默认。
    watch: null,
    // HMR 热替换会重新执行 main.ts 里的 boot()，而旧的调试 bridge 不会销毁 ——
    // 多出来的 bridge 与仅支持一个「当前客户端」的调试服务端抢连接（实测两个
    // bridge 交替连上，验收状态被清）。需要热更新时一起把 hmr 改回 true。
    hmr: false,
  },
});
