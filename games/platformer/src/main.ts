/**
 * 模板入口：解析平台适配器 → 建游戏 → 启动。
 * 三端共用这一个入口，`@mg/vite` 会按 target 只保留对应平台实现（其余被 stub 掉）。
 */

import { design, fit } from 'virtual:mg-config';
import type { MenuButtonRect, PlatformBootOptions } from '../../../packages/runtime/src/platform/contract';
import { resolvePlatform } from '../../../packages/runtime/src/platform/index';
import { createGame } from './app/game';
import { installDebugHook } from './app/debug';

/** 设计分辨率：来自 game.config.json（构建期由 `@mg/vite` 注入，唯一真源）。 */
export const DESIGN = design;

/**
 * 开发期验收口子（只在 `import.meta.env.DEV` 生效）：`?menuButton=x,y,w,h` 给 web 端
 * 塞一个假的系统胶囊。
 *
 * 为什么需要它：T49 的胶囊避让只在 `platform.screen.menuButton` 存在时才生效，而 web
 * 端没有系统胶囊（T47 契约：无该 UI 的平台不给这一项）。CDP 要验证「避让后的 HUD」
 * 就得注入一个真机尺寸，例如微信 390×844 的 `?menuButton=281,26,87,32`。
 *
 * 生产构建里 `import.meta.env.DEV` 为 false → 整段被摇掉；不带参数时行为与以前完全一致。
 */
const devMenuButton = (): MenuButtonRect | undefined => {
  if (!import.meta.env.DEV) return undefined;
  const location = (globalThis as { location?: { search?: string } }).location;
  const search = location?.search ?? '';
  if (!search.includes('menuButton=')) return undefined;
  const raw = new URLSearchParams(search).get('menuButton');
  if (raw === null) return undefined;
  const parts = raw.split(',').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return undefined;
  const x = parts[0] ?? 0;
  const y = parts[1] ?? 0;
  const w = parts[2] ?? 0;
  const h = parts[3] ?? 0;
  return { x, y, w, h };
};

export const boot = async (opts: Partial<PlatformBootOptions> = {}): Promise<void> => {
  // design / fit 都取 game.config.json → virtual:mg-config，不在代码里再写一遍
  const platform = await resolvePlatform({ design, fit, ...opts });
  const game = createGame(platform, { menuButtonOverride: devMenuButton() });
  // 只读调试钩子：给自动化验证读状态和按钮位置用，不提供任何改状态的入口
  installDebugHook(game, platform);
  game.start();
};

void boot().catch((error: unknown) => {
  console.error('[mg] 启动失败：', error);
});
