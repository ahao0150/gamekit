// 广告网关：无后端 → unsupported；有后端 → 按平台结果映射（未完成绝不发奖励）
import { expect, it } from 'vitest';
import { createAdGateway } from './ads-flow';
import type { PlatformAdapter } from './deps';

type Rewarded = 'ok' | 'incomplete' | 'none';

const fakePlatform = (rewarded: Rewarded): PlatformAdapter => {
  const capable = rewarded !== 'none';
  const api = {
    showBanner: () => undefined,
    hideBanner: () => undefined,
    showInterstitial: () => Promise.resolve(),
    showRewarded: () =>
      Promise.resolve(rewarded === 'ok' ? { ok: true } : { ok: false, reason: 'incomplete' as const }),
  };
  return {
    can: (kind: string) => capable && kind.startsWith('ad-'),
    ads: capable ? api : undefined,
  } as unknown as PlatformAdapter;
};

it('平台没有广告能力 → canRewarded=false，调用返回 unsupported', async () => {
  const gw = createAdGateway(fakePlatform('none'));
  expect(gw.canRewarded).toBe(false);
  const r = await gw.showRewarded();
  expect(r.ok).toBe(false);
  expect(r.reason).toBe('unsupported');
});

it('激励视频看完 → ok:true（这时才允许发奖励）', async () => {
  const gw = createAdGateway(fakePlatform('ok'));
  expect(gw.canRewarded).toBe(true);
  const r = await gw.showRewarded();
  expect(r).toEqual({ ok: true });
});

it('激励视频没看完 → ok:false + reason=incomplete（不能映射成成功）', async () => {
  const gw = createAdGateway(fakePlatform('incomplete'));
  const r = await gw.showRewarded();
  expect(r.ok).toBe(false);
  expect(r.reason).toBe('incomplete');
});

it('插屏：有能力和没能力都走同一个入口，后者 unsupported', async () => {
  const capable = createAdGateway(fakePlatform('ok'));
  expect((await capable.showInterstitial()).ok).toBe(true);
  const blind = createAdGateway(fakePlatform('none'));
  expect((await blind.showInterstitial()).reason).toBe('unsupported');
});
