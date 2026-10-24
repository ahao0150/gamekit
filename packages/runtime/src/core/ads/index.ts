/**
 * 广告实现。
 *
 * 要点：
 * 1. backend 缺失 → 服务不抛错：三种展示调用统一返回 `{ok:false, reason:'unsupported'}`
 *    （banner 的 show/hide 是 void，静默 no-op）。业务代码因此不用先 can()。
 * 2. 插屏冷却是合规硬需求（连弹判违规），用注入的 now 造时间，测试完全确定。
 * 3. 只有成功展示才记 lastShownAt；失败（no-fill 等）不占冷却。
 */

import type { AdKind, AdResult, AdsService, BannerOptions, CreateAds } from './contract';

/** 默认插屏冷却 60s */
export const DEFAULT_INTERSTITIAL_COOLDOWN_MS = 60_000;
/** 默认激励冷却 0（激励由平台自身限频） */
export const DEFAULT_REWARDED_COOLDOWN_MS = 0;

export const createAds: CreateAds = (opts): AdsService => {
  const backend = opts.backend;
  const now = opts.now ?? ((): number => Date.now());
  const interstitialCooldown =
    opts.interstitialCooldownMs ?? DEFAULT_INTERSTITIAL_COOLDOWN_MS;
  const rewardedCooldown = opts.rewardedCooldownMs ?? DEFAULT_REWARDED_COOLDOWN_MS;

  // 各广告位最近一次成功展示的时间戳
  const lastShown: Record<AdKind, number | null> = {
    banner: null,
    interstitial: null,
    rewarded: null,
  };

  function cooldownLeft(kind: AdKind, cooldownMs: number): number {
    const at = lastShown[kind];
    if (at === null) return 0;
    return Math.max(0, at + cooldownMs - now());
  }

  /** 跑一次带冷却的展示；backend 调用抛错归一为 error */
  async function runWithCooldown(
    kind: 'interstitial' | 'rewarded',
    cooldownMs: number,
    call: () => Promise<AdResult>,
  ): Promise<AdResult> {
    if (!backend) return { ok: false, reason: 'unsupported' };
    if (cooldownLeft(kind, cooldownMs) > 0) {
      return { ok: false, reason: 'cooldown' };
    }
    let result: AdResult;
    try {
      result = await call();
    } catch (err) {
      return {
        ok: false,
        reason: 'error',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
    if (result.ok) lastShown[kind] = now(); // 成功才占冷却
    return result;
  }

  return {
    can(kind: AdKind): boolean {
      return !!backend;
    },

    showBanner(bannerOpts?: BannerOptions): void {
      if (!backend) return;
      try {
        backend.showBanner(bannerOpts);
        lastShown.banner = now();
      } catch {
        // banner 失败不值得打扰业务，静默
      }
    },

    hideBanner(): void {
      if (!backend) return;
      try {
        backend.hideBanner();
      } catch {
        // 同上
      }
    },

    showInterstitial(): Promise<AdResult> {
      return runWithCooldown('interstitial', interstitialCooldown, () =>
        backend ? backend.showInterstitial() : Promise.resolve<AdResult>({ ok: false, reason: 'unsupported' }),
      );
    },

    showRewarded(): Promise<AdResult> {
      return runWithCooldown('rewarded', rewardedCooldown, () =>
        backend ? backend.showRewarded() : Promise.resolve<AdResult>({ ok: false, reason: 'unsupported' }),
      );
    },

    lastShownAt(kind: AdKind): number | null {
      return lastShown[kind];
    },
  };
};
