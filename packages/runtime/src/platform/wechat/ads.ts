/**
 * 微信小游戏广告实现。
 *
 * 为什么单独一个文件：
 * 广告是三个能力（banner / 插屏 / 激励）里最啰嗦的一块 —— 每个都有各自的
 * 创建方式、生命周期和错误分支。拆出来，适配器主体就只剩「把能力接上」，
 * 单文件也压得住 300 行。
 *
 * 三条关键规则（写错就是线上事故）：
 * 1. **广告位 id 来自 boot.extra.adUnitIds**，由宿主注入。缺配置是配置错误，
 *    直接抛中文错误，别等广告位无效了才在真机上白屏。
 * 2. **激励视频看 onClose 的 res.isEnded** 才知道有没有看完。中途划走也会
 *    触发 onClose，这时不能发奖励。
 * 3. **每次 show 前换掉旧的 onClose 回调**。微信的 onClose 可以注册多次，
 *    不换掉就会重复触发 close，导致一次观看 resolve 多次、奖励结算错乱。
 */

import type { AdService, BannerOptions, RewardResult } from '../contract';
import type { WxAdCloseResult, WxApi } from './api';

/** 广告位 id。放在 boot.extra.adUnitIds 里，由宿主（game.js / 模板）注入。 */
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
  api: WxApi,
  adUnitIds: AdUnitIds,
  screenWidth: number,
): AdService => {
  let bannerAd: ReturnType<WxApi['createBannerAd']> | null = null;
  let interstitialAd: ReturnType<WxApi['createInterstitialAd']> | null = null;
  let rewardedAd: ReturnType<WxApi['createRewardedVideoAd']> | null = null;
  let onRewardedClose: ((res: WxAdCloseResult) => void) | null = null;

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
        // 每次 show 前换掉旧的 close 回调，避免重复触发导致多次 resolve
        if (onRewardedClose && rewardedAd?.offClose) {
          rewardedAd.offClose(onRewardedClose);
        }
        onRewardedClose = (res: WxAdCloseResult): void => {
          resolve(res.isEnded ? { ok: true } : { ok: false, reason: 'incomplete' });
        };
        rewardedAd?.onClose(onRewardedClose);
        rewardedAd?.show().catch(() => {
          resolve({ ok: false, reason: 'no-fill' });
        });
      });
    },
  };
};
