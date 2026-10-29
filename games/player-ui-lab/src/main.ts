/**
 * 入口：解析平台适配器 → 建游戏 → 启动。三端共用（`@mg/vite` 按 target 只保留对应平台实现）。
 */

import { design, fit } from 'virtual:mg-config';
// 引擎入口用相对路径：本工程还没跑过 pnpm install（node_modules 里没有 @mg/runtime 链接），
// 与大仓里其它游戏的 deps.ts 做法一致；安装依赖后可换成包名，业务代码不用动。
import { resolvePlatform } from '../../../packages/runtime/src/index';
import type { PlatformBootOptions } from '../../../packages/runtime/src/index';
import { createGame } from './app/game';

/** 设计分辨率：来自 game.config.json（构建期注入，唯一真源）。 */
export const DESIGN = design;

export const boot = async (opts: Partial<PlatformBootOptions> = {}): Promise<void> => {
  const platform = await resolvePlatform({ design, fit, ...opts });
  const game = createGame(platform);
  // 只读调试出口：截图/对拍脚本读组件矩形与布局错误，不提供任何改状态的入口。
  // 用 getter 而不是快照：窗口 resize 后脚本读到的仍是当前布局。
  (globalThis as { __player?: unknown }).__player = {
    get viewport() {
      return game.viewport;
    },
    get rects() {
      return game.rects;
    },
    get paintOrder() {
      return game.paintOrder;
    },
    get errors() {
      return game.layoutErrors;
    },
  };
  game.start();
};

void boot().catch((error: unknown) => {
  console.error('[mg] 启动失败：', error);
});
