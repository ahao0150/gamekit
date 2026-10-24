/**
 * 抖音适配器挂载滚轮的契约测试（T36）。
 *
 * 结构与微信那份对称：假 `tt` → register → resolve → 看 `adapter.onWheel`。
 * 额外钉一条**抖音特有**的容错：字段未在官方文档确认（见 api.ts 的说明），
 * 所以回调里缺 deltaX / deltaY 时不许把滚动位污染成 NaN —— 一律当 0。
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { WheelEvent } from '../contract';
import { createRegistry } from '../registry';
import { register } from './index';
import type { TtApi, TtWheelEvent } from './api';

interface FakeTt {
  readonly api: TtApi;
  readonly wheelHandlers: Array<(res: TtWheelEvent) => void>;
  readonly offCalls: Array<((res: TtWheelEvent) => void) | undefined>;
  fireWheel(res: TtWheelEvent): void;
}

const makeFakeTt = (withWheel: boolean): FakeTt => {
  const wheelHandlers: Array<(res: TtWheelEvent) => void> = [];
  const offCalls: Array<((res: TtWheelEvent) => void) | undefined> = [];
  const noop = (): void => undefined;
  const canvas = { width: 0, height: 0, getContext: (): null => null };
  const ad = { show: async (): Promise<void> => undefined, hide: noop, destroy: noop };
  const base = {
    createCanvas: () => canvas,
    getSystemInfoSync: () => ({ screenWidth: 390, screenHeight: 844, pixelRatio: 2 }),
    onTouchStart: noop,
    onTouchMove: noop,
    onTouchEnd: noop,
    onTouchCancel: noop,
    getStorageSync: () => '',
    setStorageSync: noop,
    removeStorageSync: noop,
    createImage: () => ({ width: 0, height: 0, src: '', onload: null, onerror: null }),
    createInnerAudioContext: () => ({
      src: '', volume: 1, loop: false, obeyMuteSwitch: true,
      play: noop, pause: noop, stop: noop, destroy: noop,
    }),
    createBannerAd: () => ad,
    createInterstitialAd: () => ({ ...ad, onClose: noop }),
    createRewardedVideoAd: () => ({ ...ad, onClose: noop }),
    shareAppMessage: noop,
    vibrateShort: noop,
    loadSubpackage: noop,
    onShow: noop,
    onHide: noop,
    ...(withWheel
      ? {
          onWheel: (cb: (res: TtWheelEvent) => void): void => {
            wheelHandlers.push(cb);
          },
          offWheel: (cb?: (res: TtWheelEvent) => void): void => {
            offCalls.push(cb);
          },
        }
      : {}),
  };
  return {
    api: base as unknown as TtApi,
    wheelHandlers,
    offCalls,
    fireWheel: (res) => {
      for (const cb of [...wheelHandlers]) cb(res);
    },
  };
};

const globalScope = globalThis as unknown as { tt?: unknown };

const resolveWith = async (fake: FakeTt): Promise<Awaited<ReturnType<ReturnType<typeof createRegistry>['resolve']>>> => {
  globalScope.tt = fake.api;
  const registry = createRegistry();
  register(registry);
  return registry.resolve({ design: { width: 390, height: 844 } });
};

afterEach(() => {
  delete globalScope.tt;
});

describe('抖音适配器挂载滚轮', () => {
  it('PC 抖音（有 tt.onWheel）→ 适配器暴露 onWheel，事件映射正确', async () => {
    const fake = makeFakeTt(true);
    const adapter = await resolveWith(fake);
    expect(adapter.onWheel).toBeDefined();
    if (adapter.onWheel === undefined) return;

    const got: WheelEvent[] = [];
    adapter.onWheel((e) => got.push(e));
    expect(fake.wheelHandlers).toHaveLength(1);
    fake.fireWheel({ x: 8, y: 9, deltaX: -1, deltaY: 16, timeStamp: 42 });
    expect(got[0]).toEqual({ x: 8, y: 9, deltaX: -1, deltaY: 16, time: 42 });
  });

  it('手机端（没有 tt.onWheel）→ 适配器根本没有这个成员', async () => {
    const adapter = await resolveWith(makeFakeTt(false));
    expect(adapter.onWheel).toBeUndefined();
  });

  it('字段缺失 / NaN → 一律填 0，不产 NaN（抖音字段未在文档确认的兜底）', async () => {
    const fake = makeFakeTt(true);
    const adapter = await resolveWith(fake);
    if (adapter.onWheel === undefined) throw new Error('PC 抖音该有 onWheel');
    const got: WheelEvent[] = [];
    adapter.onWheel((e) => got.push(e));
    fake.fireWheel({ x: Number.NaN, y: 0, deltaX: Number.NaN, deltaY: Number.NaN, timeStamp: Number.NaN });
    expect(got[0]).toEqual({ x: 0, y: 0, deltaX: 0, deltaY: 0, time: 0 });
    for (const value of Object.values(got[0]!)) expect(Number.isFinite(value)).toBe(true);
  });

  it('退订会调 tt.offWheel', async () => {
    const fake = makeFakeTt(true);
    const adapter = await resolveWith(fake);
    if (adapter.onWheel === undefined) throw new Error('PC 抖音该有 onWheel');
    adapter.onWheel(() => undefined)();
    expect(fake.offCalls).toHaveLength(1);
  });
});
