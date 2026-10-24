/**
 * 广告契约（IAA 三件套）。
 *
 * 为什么失败要返回原因而不是抛错：广告失败是正常业务路径（无库存、用户没看完、
 * 平台没这个能力）。业务代码要据此决定「继续给不给奖励」，抛错只会逼出 try/catch
 * 包装，反而藏掉分支。
 *
 * 为什么内置冷却：插屏连弹会被平台判违规，历史上踩过。冷却放在 core 里，
 * 各游戏不用各写一遍。
 *
 * 为什么无能力也要有服务实例：业务只写 `ads.showRewarded()`，返回值里说
 * `reason:'unsupported'`。禁止业务写 `if (platform.can('ad-rewarded'))` 再调。
 */

export type AdKind = 'banner' | 'interstitial' | 'rewarded';

/** 广告结果。`ok:false` 时 `reason` 必有值。 */
export interface AdResult {
  readonly ok: boolean;
  readonly reason?: 'unsupported' | 'incomplete' | 'no-fill' | 'cooldown' | 'error';
  /** 平台原始错误信息（诊断用，不进玩家界面） */
  readonly detail?: string;
}

export interface BannerOptions {
  /** 逻辑像素，相对屏幕左上角；省略则由平台贴底部 */
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface AdsService {
  /** 平台是否支持这个广告位。 */
  can(kind: AdKind): boolean;

  showBanner(opts?: BannerOptions): void;
  hideBanner(): void;

  /** 插屏。受冷却限制；冷却中返回 `{ok:false, reason:'cooldown'}`。 */
  showInterstitial(): Promise<AdResult>;

  /** 激励视频。只有 `ok:true` 才可以发奖励。受冷却限制。 */
  showRewarded(): Promise<AdResult>;

  /** 距离上次展示过去多久（ms）；测试与调试用。 */
  lastShownAt(kind: AdKind): number | null;
}

export interface AdsOptions {
  /** 由 platform 提供；没有广告能力时整个服务降级为 unsupported */
  readonly backend?: {
    showBanner(opts?: BannerOptions): void;
    hideBanner(): void;
    showInterstitial(): Promise<AdResult>;
    showRewarded(): Promise<AdResult>;
  };
  /** 插屏冷却（ms），默认 60000 */
  readonly interstitialCooldownMs?: number;
  /** 激励冷却（ms），默认 0（激励视频由平台自身限频，不做本地冷却） */
  readonly rewardedCooldownMs?: number;
  /** 时间源，默认 Date.now */
  readonly now?: () => number;
}

export type CreateAds = (opts: AdsOptions) => AdsService;
