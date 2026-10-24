/**
 * 抖音软键盘契约测试（本机没有抖音运行时，用可编程假 tt 端到端验）。
 *
 * 与微信最大的差异要**单独钉死**：抖音部分版本没有 `tt.onKeyboardComplete`，
 * 这时「确认即收起」必须补发一条 onClose —— 否则游戏界面会永远停在
 * 「光标闪但键盘已经没了」的状态。两条路径都要测：
 * - 有 complete：confirm 只发 onConfirm，收起由 complete 负责；
 * - 没有 complete：confirm 发 onConfirm + onClose 各一次。
 */

import { describe, expect, it } from 'vitest';
import type { KeyboardService } from '../contract';
import { createRegistry } from '../registry';
import { register } from './index';
import { createDouyinKeyboard } from './keyboard';
import type { TtApi, TtKeyboardOptions, TtKeyboardResult } from './api';

interface FakeTt {
  readonly api: TtApi;
  readonly showCalls: TtKeyboardOptions[];
  readonly hideCount: () => number;
  fireInput(value: string): void;
  fireConfirm(value: string): void;
  fireComplete(value: string): void;
}

const makeFakeTt = (withComplete = true, withKeyboard = true): FakeTt => {
  const showCalls: TtKeyboardOptions[] = [];
  let hideCount = 0;
  const inputCbs: Array<(res: TtKeyboardResult) => void> = [];
  const confirmCbs: Array<(res: TtKeyboardResult) => void> = [];
  const completeCbs: Array<(res: TtKeyboardResult) => void> = [];

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
      src: '',
      volume: 1,
      loop: false,
      obeyMuteSwitch: true,
      play: noop,
      pause: noop,
      stop: noop,
      destroy: noop,
    }),
    createBannerAd: () => ad,
    createInterstitialAd: () => ({ ...ad, onClose: noop }),
    createRewardedVideoAd: () => ({ ...ad, onClose: noop }),
    shareAppMessage: noop,
    vibrateShort: noop,
    loadSubpackage: noop,
    onShow: noop,
    onHide: noop,
    ...(withKeyboard
      ? {
          showKeyboard: (opts: TtKeyboardOptions): void => {
            showCalls.push(opts);
          },
          hideKeyboard: (): void => {
            hideCount += 1;
          },
          onKeyboardInput: (cb: (res: TtKeyboardResult) => void): void => {
            inputCbs.push(cb);
          },
          onKeyboardConfirm: (cb: (res: TtKeyboardResult) => void): void => {
            confirmCbs.push(cb);
          },
          ...(withComplete
            ? {
                onKeyboardComplete: (cb: (res: TtKeyboardResult) => void): void => {
                  completeCbs.push(cb);
                },
              }
            : {}),
        }
      : {}),
  };
  const fire = (cbs: Array<(res: TtKeyboardResult) => void>, value: string): void => {
    for (const cb of [...cbs]) cb({ value });
  };
  return {
    api: base as unknown as TtApi,
    showCalls,
    hideCount: () => hideCount,
    fireInput: (v) => fire(inputCbs, v),
    fireConfirm: (v) => fire(confirmCbs, v),
    fireComplete: (v) => fire(completeCbs, v),
  };
};

/** 造一个一定非 null 的键盘服务（假 tt 有完整 API）。 */
const makeKb = (fake: FakeTt): KeyboardService => {
  const kb = createDouyinKeyboard(fake.api);
  if (kb === null) throw new Error('假 tt 有完整键盘 API，不该造出 null');
  return kb;
};

const globalScope = globalThis as unknown as { tt?: unknown };

describe('抖音适配器挂载软键盘', () => {
  it('resolve 后 keyboard 存在，能力位是 soft-keyboard 而不是 keyboard', async () => {
    globalScope.tt = makeFakeTt().api;
    const registry = createRegistry();
    register(registry);
    const adapter = await registry.resolve({ design: { width: 390, height: 844 } });
    expect(adapter.keyboard).toBeDefined();
    expect(adapter.can('soft-keyboard')).toBe(true);
    expect(adapter.can('keyboard')).toBe(false);
    delete globalScope.tt;
  });

  it('宿主缺键盘 API → 不挂 keyboard、能力位如实为 false', async () => {
    expect(createDouyinKeyboard({} as unknown as TtApi)).toBeNull();
    globalScope.tt = makeFakeTt(true, false).api;
    const registry = createRegistry();
    register(registry);
    const adapter = await registry.resolve({ design: { width: 390, height: 844 } });
    expect(adapter.keyboard).toBeUndefined();
    expect(adapter.can('soft-keyboard')).toBe(false);
    expect(adapter.can('pointer')).toBe(true);
    delete globalScope.tt;
  });
});

describe('createDouyinKeyboard（有 onKeyboardComplete）', () => {
  it('open：参数透传，maxLength 为 -1 时不传', () => {
    const fake = makeFakeTt();
    const kb = makeKb(fake);
    kb.open({ defaultValue: 'x', maxLength: -1, confirmType: 'send' });
    expect(fake.showCalls[0]).toEqual({
      defaultValue: 'x',
      confirmType: 'send',
      multiple: false,
      confirmHold: false,
    });
    expect(fake.showCalls[0]).not.toHaveProperty('maxLength');
  });

  it('confirm 只发 onConfirm，收起交给 complete（不许重复发 onClose）', () => {
    const fake = makeFakeTt();
    const kb = makeKb(fake);
    const confirms: string[] = [];
    const closes: string[] = [];
    kb.onConfirm((v) => confirms.push(v));
    kb.onClose((v) => closes.push(v));
    kb.open();
    fake.fireInput('ab');
    fake.fireConfirm('ab');
    expect(confirms).toEqual(['ab']);
    expect(closes).toEqual([]);
    fake.fireComplete('ab');
    expect(closes).toEqual(['ab']);
  });

  it('close()：调 hideKeyboard 并自己发一次 onClose', () => {
    const fake = makeFakeTt();
    const kb = makeKb(fake);
    const closes: string[] = [];
    kb.onClose((v) => closes.push(v));
    kb.open({ defaultValue: 'z' });
    fake.fireInput('zz');
    kb.close();
    expect(fake.hideCount()).toBe(1);
    expect(closes).toEqual(['zz']);
    kb.close();
    expect(closes).toEqual(['zz']);
  });
});

describe('createDouyinKeyboard（没有 onKeyboardComplete 的版本）', () => {
  it('confirm 后补发 onClose（确认键会让系统收键盘，不收就会卡在聚焦态）', () => {
    const fake = makeFakeTt(false);
    const kb = makeKb(fake);
    const confirms: string[] = [];
    const closes: string[] = [];
    kb.onConfirm((v) => confirms.push(v));
    kb.onClose((v) => closes.push(v));
    kb.open();
    fake.fireInput('ab');
    fake.fireConfirm('ab');
    expect(confirms).toEqual(['ab']);
    expect(closes).toEqual(['ab']);
  });

  it('补发 close 之后不再转发 input（键盘已经收起）', () => {
    const fake = makeFakeTt(false);
    const kb = makeKb(fake);
    const inputs: string[] = [];
    kb.onInput((v) => inputs.push(v));
    kb.open();
    fake.fireInput('a');
    fake.fireConfirm('a');
    fake.fireInput('b');
    expect(inputs).toEqual(['a']);
  });

  it('没有 complete 也能正常 close()（兜底路径不受影响）', () => {
    const fake = makeFakeTt(false);
    const kb = makeKb(fake);
    const closes: string[] = [];
    kb.onClose((v) => closes.push(v));
    kb.open({ defaultValue: 'q' });
    kb.close();
    expect(closes).toEqual(['q']);
    expect(fake.hideCount()).toBe(1);
  });
});
