// ads 契约测试：unsupported 降级、冷却（注入 now）、lastShownAt、异常归一。无 DOM。
import { describe, expect, it, vi } from 'vitest';
import type { AdResult, BannerOptions } from './contract';
import { createAds } from './index';

function ok(): AdResult {
  return { ok: true };
}
function fail(reason: NonNullable<AdResult['reason']>): AdResult {
  return { ok: false, reason };
}

describe('backend 缺失（unsupported 降级）', () => {
  it('can() 三种都 false', () => {
    const a = createAds({});
    expect(a.can('banner')).toBe(false);
    expect(a.can('interstitial')).toBe(false);
    expect(a.can('rewarded')).toBe(false);
  });

  it('三种调用都不抛错且返回 unsupported', async () => {
    const a = createAds({});
    expect(() => a.showBanner()).not.toThrow();
    expect(() => a.hideBanner()).not.toThrow();
    await expect(a.showInterstitial()).resolves.toEqual({ ok: false, reason: 'unsupported' });
    await expect(a.showRewarded()).resolves.toEqual({ ok: false, reason: 'unsupported' });
  });
});

describe('插屏冷却（注入 now）', () => {
  function setup(cooldownMs = 60_000) {
    let t = 1_000_000;
    const interstitial = vi.fn(() => Promise.resolve(ok()));
    const rewarded = vi.fn(() => Promise.resolve(ok()));
    const ads = createAds({
      backend: {
        showBanner: vi.fn(),
        hideBanner: vi.fn(),
        showInterstitial: interstitial,
        showRewarded: rewarded,
      },
      interstitialCooldownMs: cooldownMs,
      now: () => t,
    });
    return { ads, interstitial, rewarded, set now(v: number) { t = v; }, get now() { return t; } };
  }

  it('can() 三种都 true', () => {
    const s = setup();
    expect(s.ads.can('banner')).toBe(true);
    expect(s.ads.can('interstitial')).toBe(true);
    expect(s.ads.can('rewarded')).toBe(true);
  });

  it('首次可展示，60s 内第二次被冷却拦下，冷却结束恢复', async () => {
    const s = setup();
    await expect(s.ads.showInterstitial()).resolves.toEqual({ ok: true });
    expect(s.ads.lastShownAt('interstitial')).toBe(s.now);
    s.now += 30_000; // 冷却中
    await expect(s.ads.showInterstitial()).resolves.toEqual({ ok: false, reason: 'cooldown' });
    expect(s.interstitial).toHaveBeenCalledTimes(1); // 没有真正调 backend
    s.now += 31_000; // 过了 60s
    await expect(s.ads.showInterstitial()).resolves.toEqual({ ok: true });
    expect(s.interstitial).toHaveBeenCalledTimes(2);
  });

  it('失败不占冷却：no-fill 后立刻可重试', async () => {
    const s = setup();
    s.interstitial.mockResolvedValueOnce(fail('no-fill'));
    await expect(s.ads.showInterstitial()).resolves.toEqual({ ok: false, reason: 'no-fill' });
    expect(s.ads.lastShownAt('interstitial')).toBeNull();
    await expect(s.ads.showInterstitial()).resolves.toEqual({ ok: true }); // 不被冷却拦
  });

  it('backend 抛错归一为 error 且带 detail', async () => {
    const s = setup();
    s.interstitial.mockRejectedValueOnce(new Error('boom'));
    const r = await s.ads.showInterstitial();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('error');
    expect(r.detail).toBe('boom');
  });
});

describe('激励冷却默认 0', () => {
  it('连续两次激励都不被冷却拦', async () => {
    const rewarded = vi.fn(() => Promise.resolve(ok()));
    const ads = createAds({
      backend: {
        showBanner: vi.fn(),
        hideBanner: vi.fn(),
        showInterstitial: vi.fn(),
        showRewarded: rewarded,
      },
    });
    await expect(ads.showRewarded()).resolves.toEqual({ ok: true });
    await expect(ads.showRewarded()).resolves.toEqual({ ok: true });
    expect(rewarded).toHaveBeenCalledTimes(2);
  });

  it('配置了 rewardedCooldownMs 时同样生效', async () => {
    let t = 0;
    const rewarded = vi.fn(() => Promise.resolve(ok()));
    const ads = createAds({
      backend: {
        showBanner: vi.fn(),
        hideBanner: vi.fn(),
        showInterstitial: vi.fn(),
        showRewarded: rewarded,
      },
      rewardedCooldownMs: 5_000,
      now: () => t,
    });
    await expect(ads.showRewarded()).resolves.toEqual({ ok: true });
    t += 1_000;
    await expect(ads.showRewarded()).resolves.toEqual({ ok: false, reason: 'cooldown' });
    t += 5_000;
    await expect(ads.showRewarded()).resolves.toEqual({ ok: true });
  });
});

describe('banner 与 lastShownAt', () => {
  it('showBanner 透传参数并记录时间；hideBanner 透传', () => {
    let t = 500;
    const calls: Array<{ fn: string; opts?: BannerOptions }> = [];
    const ads = createAds({
      backend: {
        showBanner: (o) => calls.push({ fn: 'show', opts: o }),
        hideBanner: () => calls.push({ fn: 'hide' }),
        showInterstitial: vi.fn(),
        showRewarded: vi.fn(),
      },
      now: () => t,
    });
    expect(ads.lastShownAt('banner')).toBeNull();
    const opts: BannerOptions = { x: 1, y: 2, width: 300 };
    ads.showBanner(opts);
    expect(calls[0]).toEqual({ fn: 'show', opts });
    expect(ads.lastShownAt('banner')).toBe(500);
    ads.hideBanner();
    expect(calls[1]).toEqual({ fn: 'hide' });
    // 未展示过的位保持 null
    expect(ads.lastShownAt('interstitial')).toBeNull();
    expect(ads.lastShownAt('rewarded')).toBeNull();
  });
});
