/**
 * demo 入口：解析平台适配器 → 建游戏 → 启动。
 * 三端共用这一个入口，`@mg/vite` 会按 target 只保留对应平台实现（其余被 stub 掉）。
 */

import { design, fit } from 'virtual:mg-config';
import type { PlatformBootOptions } from '../../../packages/runtime/src/platform/contract';
import { resolvePlatform } from '../../../packages/runtime/src/platform/index';
import { installRuntimeDebug } from '../../../packages/runtime/src/debug/index';
import { createGame } from './app/game';
import { installDebugHook } from './app/debug';

/** 设计分辨率：来自 game.config.json（构建期由 `@mg/vite` 注入，唯一真源）。 */
export const DESIGN = design;

export const boot = async (opts: Partial<PlatformBootOptions> = {}): Promise<void> => {
  // design / fit 都取 game.config.json → virtual:mg-config，不在代码里再写一遍。
  // 之前手写 `fit: 'contain'` 的后果：config 改成 fill 也不生效，画布照样留边。
  const platform = await resolvePlatform({ design, fit, ...opts });
  // 运行时调试（dev 专用）：包一层 ctx 记录绘制，并通过 WebSocket 接调试 MCP。
  // 生产构建里 `installRuntimeDebug` 只剩 `return null`，整个 debug 目录被剔除。
  const debug = installRuntimeDebug(platform);
  const game = createGame(debug?.platform ?? platform);
  // 只读调试钩子：给自动化验证读状态和组件矩形用，不提供改状态的入口
  installDebugHook(game, platform);
  debug?.attach({ state: () => game.state, layout: () => game.layout.rects });
  game.start();
};

void boot().catch((error: unknown) => {
  console.error('[mg] 启动失败：', error);
});
