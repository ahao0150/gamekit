/**
 * 模板入口：解析平台适配器 → 建游戏 → 启动。
 * 三端共用这一个入口，`@mg/vite` 会按 target 只保留对应平台实现（其余被 stub 掉）。
 */

import { design, fit } from 'virtual:mg-config';
import type { AdService, PlatformAdapter, PlatformBootOptions, RewardResult } from '../../../packages/runtime/src/platform/contract';
import { resolvePlatform } from '../../../packages/runtime/src/platform/index';
import { createGame } from './app/game';
import { installDebugHook } from './app/debug';

/** 设计分辨率：来自 game.config.json（构建期由 `@mg/vite` 注入，唯一真源）。 */
export const DESIGN = design;

/**
 * 验收用测试缝：真浏览器里 web 平台「如实」没有激励视频能力，所以「广告成功 → 发奖励」
 * 这条路径在浏览器里走不到。零依赖 CDP 脚本在页面加载前设 `globalThis.__mgForceAds = true`
 * 后再导航，这里就给平台**补一个一定会成功的激励视频**（只补广告能力，其余仍是真 web 平台，
 * 画布 / 指针 / 存档全是真的）。
 *
 * 只在 `mg dev`（DEV）下生效：生产构建里这段会被 tree-shake 掉，包里没有这个开关。
 */
type TestGlobals = { __mgForceAds?: boolean };

const mockAdsEnabled = (): boolean =>
  import.meta.env.DEV === true && (globalThis as TestGlobals).__mgForceAds === true;

/** 只给 web 平台补激励视频/插屏能力（横幅照旧不支持，本游戏不用横幅） */
export const withMockAds = (platform: PlatformAdapter): PlatformAdapter => {
  const ads: AdService = {
    showBanner: () => undefined,
    hideBanner: () => undefined,
    showInterstitial: () => Promise.resolve(),
    showRewarded: (): Promise<RewardResult> => Promise.resolve({ ok: true }),
  };
  return {
    ...platform,
    ads,
    can: (cap) => (cap === 'ad-rewarded' || cap === 'ad-interstitial' ? true : platform.can(cap)),
  };
};

export const boot = async (opts: Partial<PlatformBootOptions> = {}): Promise<void> => {
  // design / fit 都取 game.config.json → virtual:mg-config，不在代码里再写一遍
  const resolved = await resolvePlatform({ design, fit, ...opts });
  const platform = mockAdsEnabled() ? withMockAds(resolved) : resolved;
  const game = createGame(platform);
  // 只读调试钩子：给自动化验证读状态和组件矩形用，不提供任何改状态的入口
  installDebugHook(game, platform);
  game.start();
};

void boot().catch((error: unknown) => {
  console.error('[mg] 启动失败：', error);
});
