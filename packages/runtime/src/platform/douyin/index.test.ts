/**
 * 抖音端安全区契约测试。
 *
 * 与微信端同一套断言（方向、缺失兜底、超屏钳制、脏数据不产 NaN），
 * 只是 API 名字换成 `tt` / `TtSystemInfo` —— 两个平台的 safeArea 同形，
 * 换算逻辑共用 `../safe-area.ts`，这里钉的是「抖音适配器真的用了它」。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createRegistry } from '../registry';
import { readSafeAreaInsets, register } from './index';
import type { TtApi, TtSafeArea, TtSystemInfo } from './api';

/** 完整 safeArea：right / bottom 是派生值，补全只为满足平台类型（生产代码只读四项）。 */
const area = (top: number, left: number, width: number, height: number): TtSafeArea => ({
  top,
  left,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

const info = (over: Partial<TtSystemInfo> = {}): TtSystemInfo => ({
  screenWidth: 390,
  screenHeight: 844,
  pixelRatio: 2,
  ...over,
});

/** 刘海机：安全区比屏幕小一圈（上 47、下 34）。 */
const IPHONE_SAFE = area(47, 0, 390, 763);

describe('readSafeAreaInsets（纯函数）', () => {
  it('竖屏刘海机：top / bottom 方向正确，左右为 0', () => {
    expect(readSafeAreaInsets(info({ safeArea: IPHONE_SAFE }))).toEqual({
      top: 47,
      right: 0,
      bottom: 34,
      left: 0,
    });
  });

  it('横屏挖孔屏：左右缺口都算对', () => {
    const insets = readSafeAreaInsets(
      info({ screenWidth: 844, screenHeight: 390, safeArea: area(0, 44, 756, 390) }),
    );
    expect(insets).toEqual({ top: 0, right: 44, bottom: 0, left: 44 });
  });

  it('safeArea 缺失（部分机型不返回）→ 四边全 0', () => {
    expect(readSafeAreaInsets(info())).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('safeArea 比屏幕大 → right / bottom 钳成 0，不出现负数', () => {
    const insets = readSafeAreaInsets(info({ safeArea: area(10, 10, 1000, 1000) }));
    expect(insets.right).toBe(0);
    expect(insets.bottom).toBe(0);
    for (const value of Object.values(insets)) expect(value).toBeGreaterThanOrEqual(0);
  });

  it('字段是 NaN → 整体退化成全 0', () => {
    expect(
      readSafeAreaInsets(info({ safeArea: area(Number.NaN, 0, 390, 800) })),
    ).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('负的 top / left 不产出负数', () => {
    const negative = readSafeAreaInsets(info({ safeArea: area(-1, -1, 390, 844) }));
    expect(negative.top).toBe(0);
    expect(negative.left).toBe(0);
    for (const value of Object.values(negative)) expect(value).toBeGreaterThanOrEqual(0);
  });
});

/** 最小假 tt：只实现适配器构造时会碰到的成员。 */
const fakeTt = (systemInfo: TtSystemInfo): TtApi => {
  const noop = (): void => undefined;
  const canvas = { width: 0, height: 0, getContext: (): null => null };
  const ad = { show: async (): Promise<void> => undefined, hide: noop, destroy: noop };
  return {
    createCanvas: () => canvas,
    getSystemInfoSync: () => systemInfo,
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
  } as unknown as TtApi;
};

const globalScope = globalThis as unknown as { tt?: unknown };

afterEach(() => {
  delete globalScope.tt;
});

describe('抖音适配器端到端', () => {
  it('screen.insets 来自 getSystemInfoSync().safeArea（不是零值占位）', async () => {
    globalScope.tt = fakeTt(info({ safeArea: IPHONE_SAFE }));
    const registry = createRegistry();
    register(registry);
    const adapter = await registry.resolve({ design: { width: 390, height: 844 } });
    expect(adapter.name).toBe('douyin');
    expect(adapter.screen.insets).toEqual({ top: 47, right: 0, bottom: 34, left: 0 });
  });

  it('safeArea 缺失时适配器的 insets 也是全 0（不是 NaN）', async () => {
    globalScope.tt = fakeTt(info());
    const registry = createRegistry();
    register(registry);
    const adapter = await registry.resolve({ design: { width: 390, height: 844 } });
    expect(adapter.screen.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    for (const value of Object.values(adapter.screen.insets)) expect(Number.isFinite(value)).toBe(true);
  });
});

// T30：离屏画布（createCanvas 是契约新增的可选成员，可选所以先判存在）。
describe('抖音离屏画布（createCanvas）', () => {
  it('存在且返回尺寸正确的契约画布，native 是平台 canvas', async () => {
    globalScope.tt = fakeTt(info());
    const registry = createRegistry();
    register(registry);
    const adapter = await registry.resolve({ design: { width: 390, height: 844 } });
    const create = adapter.createCanvas;
    expect(create).toBeDefined();
    if (create === undefined) return;
    const offscreen = create(780, 1688);
    expect(offscreen.width).toBe(780);
    expect(offscreen.height).toBe(1688);
    expect(typeof offscreen.getContext).toBe('function');
    expect(offscreen.native).toMatchObject({ width: 780, height: 1688 });
  });

  it('非法尺寸钳到 1（不产出 0 尺寸画布）', async () => {
    globalScope.tt = fakeTt(info());
    const registry = createRegistry();
    register(registry);
    const adapter = await registry.resolve({ design: { width: 390, height: 844 } });
    const create = adapter.createCanvas;
    if (create === undefined) return;
    const offscreen = create(0, Number.NaN);
    expect(offscreen.width).toBe(1);
    expect(offscreen.height).toBe(1);
  });
});
