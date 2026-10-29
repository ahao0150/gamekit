/**
 * 广告网关：把平台的 `platform.ads` 接到 runtime 的 `core/ads`（沿用同一套接法）。
 *
 * 业务只认识 `canRewarded` / `showRewarded()` / `showInterstitial()`；
 * 「能不能用」由 `platform.can('ad-*')` 回答一次（按钮禁用态），
 * 真正调用时仍以 `AdResult` 为准（未完成视频绝不映射成成功）。
 *
 * 为什么未完成要映射成 `incomplete`：平台在用户中途关掉视频时返回 `ok:false`，
 * 如果业务把它当成功，就会白送奖励 —— IAA 最常见的违规点。
 */

import { createAds } from './deps';
import type { AdResult, AdsOptions, PlatformAdapter } from './deps';

export const adsBackend = (platform: PlatformAdapter): AdsOptions['backend'] => {
  const api = platform.ads;
  if (!api) return undefined;
  return {
    showBanner: (opts) => {
      if (platform.can('ad-banner')) api.showBanner(opts);
    },
    hideBanner: () => api.hideBanner(),
    showInterstitial: async (): Promise<AdResult> => {
      if (!platform.can('ad-interstitial')) return { ok: false, reason: 'unsupported' };
      try {
        await api.showInterstitial();
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: 'error', detail: error instanceof Error ? error.message : String(error) };
      }
    },
    showRewarded: async (): Promise<AdResult> => {
      if (!platform.can('ad-rewarded')) return { ok: false, reason: 'unsupported' };
      try {
        const r = await api.showRewarded();
        return r.ok ? { ok: true } : { ok: false, reason: r.reason ?? 'incomplete' };
      } catch (error) {
        return { ok: false, reason: 'error', detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
};

export interface AdGateway {
  /** 平台是否真能放激励视频（按钮禁用态用它，别在业务里重复写 platform.can） */
  readonly canRewarded: boolean;
  showRewarded(): Promise<AdResult>;
  showInterstitial(): Promise<AdResult>;
}

export const createAdGateway = (platform: PlatformAdapter): AdGateway => {
  const ads = createAds({ backend: adsBackend(platform) });
  return {
    canRewarded: platform.can('ad-rewarded'),
    showRewarded: () => ads.showRewarded(),
    showInterstitial: () => ads.showInterstitial(),
  };
};
