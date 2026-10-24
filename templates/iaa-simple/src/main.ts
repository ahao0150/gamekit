/**
 * 模板入口：解析平台适配器 → 建游戏 → 启动。
 * 三端共用这一个入口，`@mg/vite` 会按 target 只保留对应平台实现（其余被 stub 掉）。
 */

import { design, fit } from 'virtual:mg-config';
import type { PlatformBootOptions } from '@mg/runtime';
import { resolvePlatform } from '@mg/runtime';
import { createGame } from './app/game';
import { installDebugHook } from './app/debug';

/** 设计分辨率：来自 game.config.json（构建期由 `@mg/vite` 注入，唯一真源）。 */
export const DESIGN = design;

export const boot = async (opts: Partial<PlatformBootOptions> = {}): Promise<void> => {
  // design / fit 都取 game.config.json → virtual:mg-config，不在代码里再写一遍
  const platform = await resolvePlatform({ design, fit, ...opts });
  const game = createGame(platform);
  // 只读调试钩子：给自动化验证读状态和按钮位置用，不提供任何改状态的入口
  installDebugHook(game, platform);
  game.start();
};

void boot().catch((error: unknown) => {
  console.error('[mg] 启动失败：', error);
});
