/**
 * 微信端胶囊采集的契约测试（T47）。
 *
 * 走真路径：假 `wx` 挂 globalThis → register → resolve → 读 `adapter.screen.menuButton`。
 * 钉两条：
 * 1. 有 `getMenuButtonBoundingClientRect` → 转成画布逻辑坐标（真机样例值）；
 * 2. 没有（老基础库）→ `undefined`，**构造期不抛错**。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createRegistry } from '../registry';
import type { RawMenuButtonRect } from '../screen-contract';
import type { WxApi } from './api';
import { register } from './index';

/** iPhone 13 上常见的一手实测值（屏幕 390×844、dpr 3）。 */
const REAL_SAMPLE: RawMenuButtonRect = {
  width: 87,
  height: 32,
  top: 26,
  right: 368,
  bottom: 58,
  left: 281,
};

const makeFakeWx = (withMenuButton: boolean): WxApi => {
  const noop = (): void => undefined;
  const canvas = { width: 0, height: 0, getContext: (): null => null };
  const ad = { show: async (): Promise<void> => undefined, hide: noop, destroy: noop };
  return {
    createCanvas: () => canvas,
    getSystemInfoSync: () => ({ screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
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
    ...(withMenuButton ? { getMenuButtonBoundingClientRect: () => REAL_SAMPLE } : {}),
  } as unknown as WxApi;
};

const globalScope = globalThis as unknown as { wx?: unknown };

const resolveWith = async (api: WxApi) => {
  globalScope.wx = api;
  const registry = createRegistry();
  register(registry);
  return registry.resolve({ design: { width: 390, height: 844 } });
};

afterEach(() => {
  delete globalScope.wx;
});

describe('微信适配器采集胶囊', () => {
  it('有 getMenuButtonBoundingClientRect → screen.menuButton 是画布逻辑坐标', async () => {
    const adapter = await resolveWith(makeFakeWx(true));
    expect(adapter.screen.menuButton).toEqual({ x: 281, y: 26, w: 87, h: 32 });
    // 胶囊在右上角：右边缘贴着屏幕右边留一点、顶边在状态栏下方
    const button = adapter.screen.menuButton!;
    expect(button.x + button.w).toBeLessThanOrEqual(adapter.screen.width);
    expect(button.y).toBeGreaterThan(0);
  });

  it('老基础库没有该 API → menuButton 为 undefined，适配器照常造出来', async () => {
    const adapter = await resolveWith(makeFakeWx(false));
    expect(adapter.screen.menuButton).toBeUndefined();
    // 其余能力不受影响（构造期没崩）
    expect(adapter.can('touch-multi')).toBe(true);
    expect(adapter.screen.width).toBe(390);
  });
});
