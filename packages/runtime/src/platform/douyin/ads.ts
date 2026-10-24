/**
 * 抖音小游戏广告实现。
 *
 * 与微信版（platform/wechat/ads.ts）**平行但独立**，不共用一套代码 ——
 * 因为两边真有差异，揉在一起差异就会被 if 吃掉。
 *
 * 与微信的差异：
 * - 激励视频的 onClose 回调**可能不带 res**（部分抖音版本直接 close 不给参数），
 *   所以完播判定必须写成 `res?.isEnded === true`；微信那边 res 一定带。
 * - 其余（banner 的 style 结构、插屏 show、错误原因枚举）与微信同形。
 *
 * 另两条通用规则：
 * 1. 广告位 id 来自 boot.extra.adUnitIds，缺配置是配置错误，直接抛中文错误。
 * 2. 每次 show 前换掉旧的 onClose 回调，否则会重复触发、重复 resolve。
 */

import type { AdService, BannerOptions, RewardResult } from '../contract';
import type { TtAdCloseResult, TtApi } from './api';

/** 广告位 id。放在 boot.extra.adUnitIds 里，由宿主注入。 */
export interface AdUnitIds {
  readonly banner?: string;
  readonly interstitial?: string;
  readonly rewarded?: string;
}

export const readAdUnitIds = (extra: Record<string, unknown> | undefined): AdUnitIds => {
  const raw = extra?.adUnitIds;
  if (typeof raw !== 'object' || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  const pick = (key: string): string | undefined => {
    const v = obj[key];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  return { banner: pick('banner'), interstitial: pick('interstitial'), rewarded: pick('rewarded') };
};

/** 造一套广告服务。screenWidth 用来给 banner 一个默认宽度。 */
export const createAdService = (
  api: TtApi,
  adUnitIds: AdUnitIds,
  screenWidth: number,
): AdService => {
  let bannerAd: ReturnType<TtApi['createBannerAd']> | null = null;
  let interstitialAd: ReturnType<TtApi['createInterstitialAd']> | null = null;
  let rewardedAd: ReturnType<TtApi['createRewardedVideoAd']> | null = null;
  let onRewardedClose: ((res?: TtAdCloseResult) => void) | null = null;

  return {
    showBanner(opts?: BannerOptions): void {
      if (!adUnitIds.banner) {
        throw new Error('缺少 banner 广告位 id：请在 boot.extra.adUnitIds.banner 配置');
      }
      if (!bannerAd) {
        bannerAd = api.createBannerAd({
          adUnitId: adUnitIds.banner,
          style: {
            left: opts?.x ?? 0,
            top: opts?.y ?? 0,
            width: opts?.width ?? screenWidth,
            height: opts?.height ?? 80,
          },
        });
      }
      void bannerAd.show();
    },

    hideBanner(): void {
      bannerAd?.hide();
    },

    showInterstitial(): Promise<void> {
      if (!adUnitIds.interstitial) {
        return Promise.reject(
          new Error('缺少插屏广告位 id：请在 boot.extra.adUnitIds.interstitial 配置'),
        );
      }
      if (!interstitialAd) {
        interstitialAd = api.createInterstitialAd({ adUnitId: adUnitIds.interstitial });
      }
      return interstitialAd.show().then(() => undefined);
    },

    showRewarded(): Promise<RewardResult> {
      if (!adUnitIds.rewarded) {
        return Promise.resolve({ ok: false, reason: 'error' });
      }
      if (!rewardedAd) {
        rewardedAd = api.createRewardedVideoAd({ adUnitId: adUnitIds.rewarded });
      }
      return new Promise<RewardResult>((resolve) => {
        if (onRewardedClose && rewardedAd?.offClose) {
          rewardedAd.offClose(onRewardedClose);
        }
        onRewardedClose = (res?: TtAdCloseResult): void => {
          // 差异：抖音的 close 回调可能不带 res，必须用可选链判定完播
          resolve(res?.isEnded === true ? { ok: true } : { ok: false, reason: 'incomplete' });
        };
        rewardedAd?.onClose(onRewardedClose);
        rewardedAd?.show().catch(() => {
          resolve({ ok: false, reason: 'no-fill' });
        });
      });
    },
  };
};
