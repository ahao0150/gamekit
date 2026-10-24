/**
 * 微信软键盘契约测试（本机没有微信运行时，用可编程假 wx 端到端验）。
 *
 * 走真路径：挂假 `wx` 到 globalThis → `register → resolve` 真造出适配器 →
 * 从 `adapter.keyboard` 拿服务。这样测的是「适配器装配后到底有没有这个能力」，
 * 而不是「工厂函数单独能跑」。
 *
 * 钉死的三条：
 * 1. `showKeyboard` 的**参数形状**（maxLength 为 -1 时不许传负数进去）；
 * 2. `onKeyboardComplete` 是收起信号 → 转发成 onClose；
 * 3. `hideKeyboard()` 不保证回 complete，所以显式 `close()` 自己发一次、且不重复。
 */

import { describe, expect, it } from 'vitest';
import type { KeyboardOptions } from '../contract';
import { createRegistry } from '../registry';
import { register } from './index';
import { createWechatKeyboard } from './keyboard';
import type { WxApi, WxKeyboardOptions, WxKeyboardResult } from './api';

interface FakeWx {
  readonly api: WxApi;
  readonly showCalls: WxKeyboardOptions[];
  readonly hideCount: () => number;
  fireInput(value: string): void;
  fireConfirm(value: string): void;
  fireComplete(value: string): void;
}

const makeFakeWx = (withComplete = true, withKeyboard = true): FakeWx => {
  const showCalls: WxKeyboardOptions[] = [];
  let hideCount = 0;
  const inputCbs: Array<(res: WxKeyboardResult) => void> = [];
  const confirmCbs: Array<(res: WxKeyboardResult) => void> = [];
  const completeCbs: Array<(res: WxKeyboardResult) => void> = [];

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
    ...(withKeyboard
      ? {
          showKeyboard: (opts: WxKeyboardOptions): void => {
            showCalls.push(opts);
          },
          hideKeyboard: (): void => {
            hideCount += 1;
          },
          onKeyboardInput: (cb: (res: WxKeyboardResult) => void): void => {
            inputCbs.push(cb);
          },
          onKeyboardConfirm: (cb: (res: WxKeyboardResult) => void): void => {
            confirmCbs.push(cb);
          },
          ...(withComplete
            ? {
                onKeyboardComplete: (cb: (res: WxKeyboardResult) => void): void => {
                  completeCbs.push(cb);
                },
              }
            : {}),
        }
      : {}),
  };
  const fire = (cbs: Array<(res: WxKeyboardResult) => void>, value: string): void => {
    for (const cb of [...cbs]) cb({ value });
  };
  return {
    api: base as unknown as WxApi,
    showCalls,
    hideCount: () => hideCount,
    fireInput: (v) => fire(inputCbs, v),
    fireConfirm: (v) => fire(confirmCbs, v),
    fireComplete: (v) => fire(completeCbs, v),
  };
};

const globalScope = globalThis as unknown as { wx?: unknown };

const makeAdapter = async () => {
  const fake = makeFakeWx();
  globalScope.wx = fake.api;
  const registry = createRegistry();
  register(registry);
  const adapter = await registry.resolve({ design: { width: 390, height: 844 } });
  return { fake, adapter };
};

describe('微信适配器挂载软键盘', () => {
  it('resolve 后 keyboard 存在，能力位是 soft-keyboard 而不是 keyboard', async () => {
    const { adapter } = await makeAdapter();
    expect(adapter.keyboard).toBeDefined();
    expect(adapter.can('soft-keyboard')).toBe(true);
    // 小游戏没有物理键盘：这条不能被软键盘「顺带」变成 true
    expect(adapter.can('keyboard')).toBe(false);
    delete globalScope.wx;
  });
});

describe('宿主缺少键盘 API（老基础库）', () => {
  it('工厂返回 null：缺可选能力不许在半路抛错', () => {
    expect(createWechatKeyboard({} as unknown as WxApi)).toBeNull();
  });

  it('适配器不挂 keyboard、can(soft-keyboard) 如实为 false，其余能力不受影响', async () => {
    globalScope.wx = makeFakeWx(true, false).api;
    const registry = createRegistry();
    register(registry);
    const adapter = await registry.resolve({ design: { width: 390, height: 844 } });
    expect(adapter.keyboard).toBeUndefined();
    expect(adapter.can('soft-keyboard')).toBe(false);
    // 键盘缺失不能把别的能力带下水
    expect(adapter.can('pointer')).toBe(true);
    expect(adapter.can('storage')).toBe(true);
    expect(adapter.can('audio')).toBe(true);
    delete globalScope.wx;
  });
});

describe('createWechatKeyboard', () => {
  const make = (withComplete = true) => {
    const fake = makeFakeWx(withComplete);
    const kb = createWechatKeyboard(fake.api);
    if (kb === null) throw new Error('假 wx 有完整键盘 API，不该造出 null');
    return { fake, kb };
  };

  it('open：参数透传（defaultValue / maxLength / confirmType / multiple / confirmHold）', () => {
    const { fake, kb } = make();
    kb.open({ defaultValue: '你好', maxLength: 8, confirmType: 'search' });
    expect(fake.showCalls).toEqual([
      { defaultValue: '你好', maxLength: 8, confirmType: 'search', multiple: false, confirmHold: false },
    ]);
  });

  it('open：maxLength 归一后 -1 不传（微信不收负数），0 照传', () => {
    const { fake, kb } = make();
    kb.open({ maxLength: -1 });
    expect(fake.showCalls[0]).not.toHaveProperty('maxLength');
    kb.open({ maxLength: 0 });
    expect(fake.showCalls[1]?.maxLength).toBe(0);
  });

  it('open：confirmType 非法值 → done（不许把脏值透传给系统）', () => {
    const { fake, kb } = make();
    kb.open({ confirmType: '瞎写' as unknown as KeyboardOptions['confirmType'] });
    expect(fake.showCalls[0]?.confirmType).toBe('done');
  });

  it('onKeyboardInput → onInput 收到值；onKeyboardConfirm → onConfirm', () => {
    const { fake, kb } = make();
    const inputs: string[] = [];
    const confirms: string[] = [];
    kb.onInput((v) => inputs.push(v));
    kb.onConfirm((v) => confirms.push(v));
    kb.open();
    fake.fireInput('a');
    fake.fireInput('ab');
    fake.fireConfirm('ab');
    expect(inputs).toEqual(['a', 'ab']);
    expect(confirms).toEqual(['ab']);
  });

  it('onKeyboardComplete → onClose 带最后的值', () => {
    const { fake, kb } = make();
    const closes: string[] = [];
    kb.onClose((v) => closes.push(v));
    kb.open();
    fake.fireInput('abc');
    fake.fireComplete('abc');
    expect(closes).toEqual(['abc']);
  });

  it('close()：调 hideKeyboard 且自己发一次 onClose（hide 不一定回 complete）', () => {
    const { fake, kb } = make();
    const closes: string[] = [];
    kb.onClose((v) => closes.push(v));
    kb.open({ defaultValue: 'z' });
    fake.fireInput('zz');
    kb.close();
    expect(fake.hideCount()).toBe(1);
    expect(closes).toEqual(['zz']);
    // 重复 close 不重复回调
    kb.close();
    expect(fake.hideCount()).toBe(1);
    expect(closes).toEqual(['zz']);
  });

  it('complete 之后再来 input / confirm 不再转发（键盘已经收起）', () => {
    const { fake, kb } = make();
    const inputs: string[] = [];
    kb.onInput((v) => inputs.push(v));
    kb.open();
    fake.fireComplete('x');
    fake.fireInput('y');
    expect(inputs).toEqual([]);
  });

  it('重复 open：先 hideKeyboard 再 showKeyboard（不许两个输入框抢焦点）', () => {
    const { fake, kb } = make();
    kb.open();
    kb.open();
    expect(fake.hideCount()).toBe(1);
    expect(fake.showCalls).toHaveLength(2);
  });

  it('退订之后不再收到 onInput', () => {
    const { fake, kb } = make();
    const inputs: string[] = [];
    const off = kb.onInput((v) => inputs.push(v));
    kb.open();
    fake.fireInput('a');
    off();
    fake.fireInput('b');
    expect(inputs).toEqual(['a']);
  });
});
