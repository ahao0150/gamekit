/**
 * 微信适配器挂载滚轮的契约测试（T36）。
 *
 * 走真路径：假 `wx` 挂到 globalThis → `register → resolve` 真造出适配器 →
 * 从 `adapter.onWheel` 拿服务。钉的是**能力信号**：
 * - PC 微信（有 `wx.onWheel`）→ 适配器有 onWheel，事件字段映射正确；
 * - 手机端 / 老基础库（没有 onWheel）→ 成员**不存在**（不是「存在但永远不回调」）；
 * - 退订会调 `wx.offWheel`。
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { WheelEvent } from '../contract';
import { createRegistry } from '../registry';
import { register } from './index';
import type { WxApi, WxWheelEvent } from './api';

interface FakeWx {
  readonly api: WxApi;
  readonly wheelHandlers: Array<(res: WxWheelEvent) => void>;
  readonly offCalls: Array<((res: WxWheelEvent) => void) | undefined>;
  fireWheel(res: WxWheelEvent): void;
}

const makeFakeWx = (withWheel: boolean, withOff = true): FakeWx => {
  const wheelHandlers: Array<(res: WxWheelEvent) => void> = [];
  const offCalls: Array<((res: WxWheelEvent) => void) | undefined> = [];
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
      src: '', volume: 1, loop: false, play: noop, pause: noop, stop: noop, destroy: noop,
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
          onWheel: (cb: (res: WxWheelEvent) => void): void => {
            wheelHandlers.push(cb);
          },
          ...(withOff
            ? {
                offWheel: (cb?: (res: WxWheelEvent) => void): void => {
                  offCalls.push(cb);
                },
              }
            : {}),
        }
      : {}),
  };
  return {
    api: base as unknown as WxApi,
    wheelHandlers,
    offCalls,
    fireWheel: (res) => {
      for (const cb of [...wheelHandlers]) cb(res);
    },
  };
};

const globalScope = globalThis as unknown as { wx?: unknown };

const resolveWith = async (fake: FakeWx): Promise<Awaited<ReturnType<ReturnType<typeof createRegistry>['resolve']>>> => {
  globalScope.wx = fake.api;
  const registry = createRegistry();
  register(registry);
  return registry.resolve({ design: { width: 390, height: 844 } });
};

afterEach(() => {
  delete globalScope.wx;
});

describe('微信适配器挂载滚轮', () => {
  it('PC 微信（有 wx.onWheel）→ 适配器暴露 onWheel，事件映射正确', async () => {
    const fake = makeFakeWx(true);
    const adapter = await resolveWith(fake);
    expect(adapter.onWheel).toBeDefined();
    if (adapter.onWheel === undefined) return;

    const got: WheelEvent[] = [];
    adapter.onWheel((e) => got.push(e));
    expect(fake.wheelHandlers).toHaveLength(1); // 懒注册：订阅时才绑
    fake.fireWheel({ x: 40, y: 300, deltaX: 0, deltaY: 53, deltaZ: 0, timeStamp: 777 });

    expect(got).toHaveLength(1);
    expect(got[0]).toEqual({ x: 40, y: 300, deltaX: 0, deltaY: 53, time: 777 });
  });

  it('手机端 / 老基础库（没有 wx.onWheel）→ 适配器根本没有这个成员', async () => {
    const fake = makeFakeWx(false);
    const adapter = await resolveWith(fake);
    expect(adapter.onWheel).toBeUndefined();
  });

  it('退订会调 wx.offWheel（并带上注册时那个回调）', async () => {
    const fake = makeFakeWx(true);
    const adapter = await resolveWith(fake);
    if (adapter.onWheel === undefined) throw new Error('PC 微信该有 onWheel');
    const off = adapter.onWheel(() => undefined);
    off();
    expect(fake.offCalls).toHaveLength(1);
    expect(fake.offCalls[0]).toBe(fake.wheelHandlers[0]);
  });
});
