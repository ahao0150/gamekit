/**
 * 抖音端胶囊采集的契约测试（T47）。
 *
 * 抖音的两个 API 名都测：`getMenuButtonBoundingClientRect`（微信同形）
 * 与 `getMenuButtonLayout`（真机采样值看起来是**物理像素**，要按 dpr 折回）。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createRegistry } from '../registry';
import type { RawMenuButtonRect } from '../screen-contract';
import type { TtApi } from './api';
import { register } from './index';

const LOGICAL: RawMenuButtonRect = { width: 87, height: 32, top: 26, right: 368, bottom: 58, left: 281 };
/** 抖音真机采样（物理像素）：{"width":85,"height":32,"top":6,"right":2192,"bottom":38,"left":2107} */
const PHYSICAL: RawMenuButtonRect = { width: 85, height: 32, top: 6, right: 2192, bottom: 38, left: 2107 };

const makeFakeTt = (kind: 'rect' | 'layout' | 'none'): TtApi => {
  const noop = (): void => undefined;
  const canvas = { width: 0, height: 0, getContext: (): null => null };
  const ad = { show: async (): Promise<void> => undefined, hide: noop, destroy: noop };
  const base = {
    createCanvas: () => canvas,
    getSystemInfoSync: () => ({ screenWidth: 1096, screenHeight: 928, pixelRatio: 2 }),
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
    ...(kind === 'rect' ? { getMenuButtonBoundingClientRect: () => LOGICAL } : {}),
    ...(kind === 'layout' ? { getMenuButtonLayout: () => PHYSICAL } : {}),
  };
  return base as unknown as TtApi;
};

const globalScope = globalThis as unknown as { tt?: unknown };

const resolveWith = async (api: TtApi) => {
  globalScope.tt = api;
  const registry = createRegistry();
  register(registry);
  return registry.resolve({ design: { width: 1096, height: 928 } });
};

afterEach(() => {
  delete globalScope.tt;
});

describe('抖音适配器采集胶囊', () => {
  it('有 getMenuButtonBoundingClientRect（微信同形）→ 逻辑坐标直接可用', async () => {
    const adapter = await resolveWith(makeFakeTt('rect'));
    expect(adapter.screen.menuButton).toEqual({ x: 281, y: 26, w: 87, h: 32 });
  });

  it('只有 getMenuButtonLayout 且给物理像素 → 按 dpr 折回逻辑像素', async () => {
    const adapter = await resolveWith(makeFakeTt('layout'));
    const button = adapter.screen.menuButton;
    expect(button).toBeDefined();
    if (button === undefined) return;
    // 2107/2 = 1053.5，85/2 = 42.5，32/2 = 16
    expect(button.x).toBeCloseTo(1053.5, 1);
    expect(button.w).toBeCloseTo(42.5, 1);
    expect(button.h).toBeCloseTo(16, 1);
    expect(button.x + button.w).toBeLessThanOrEqual(1096);
  });

  it('两个 API 都没有 → undefined，适配器照常造出来', async () => {
    const adapter = await resolveWith(makeFakeTt('none'));
    expect(adapter.screen.menuButton).toBeUndefined();
    expect(adapter.screen.width).toBe(1096);
  });
});
