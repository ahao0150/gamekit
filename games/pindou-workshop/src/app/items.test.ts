// IAA 广告道具的纯逻辑：次数上限、首关无入口、不可用时禁用、提示选格、插屏频次
import { expect, it } from 'vitest';
import { AD_LIMITS, adEntriesOf, FULL_ITEMS, hintCellOf, shouldInterstitial } from './items';

it('每关上限：提示 ≤3、续时 1、扩位 1（防刷）', () => {
  expect(AD_LIMITS).toEqual({ hint: 3, time: 1, slot: 1 });
  expect(FULL_ITEMS).toEqual({ hint: 3, time: 1, slot: 1 });
});

it('第 1 关不放任何广告入口（三个都 disabled，reason=first-level）', () => {
  const entries = adEntriesOf({ levelId: 1, left: FULL_ITEMS, canRewarded: true });
  expect(entries).toHaveLength(3);
  for (const e of entries) {
    expect(e.enabled).toBe(false);
    expect(e.reason).toBe('first-level');
  }
});

it('第 2 关起可用；次数用完 → used-up；平台不支持 → unsupported', () => {
  const ok = adEntriesOf({ levelId: 2, left: FULL_ITEMS, canRewarded: true });
  expect(ok.map((e) => e.item)).toEqual(['hint', 'time', 'slot']);
  expect(ok.every((e) => e.enabled)).toBe(true);
  expect(ok[0]!.label).toContain('3'); // 文案带剩余次数

  const usedUp = adEntriesOf({ levelId: 2, left: { hint: 0, time: 1, slot: 1 }, canRewarded: true });
  expect(usedUp[0]!.enabled).toBe(false);
  expect(usedUp[0]!.reason).toBe('used-up');
  expect(usedUp[1]!.enabled).toBe(true);

  const unsupported = adEntriesOf({ levelId: 5, left: FULL_ITEMS, canRewarded: false });
  for (const e of unsupported) {
    expect(e.enabled).toBe(false);
    expect(e.reason).toBe('unsupported');
    expect(e.hint).toContain('广告');
  }
});

it('提示选格：只在「未被占 + 局内还有同色待放」的格里随机', () => {
  // 3x1 图案：[0, 1, 0]，格 0 已被占
  const grid = [0, 1, 0];
  const filled = [0];
  const pending = [0, 1]; // 局内还有 0 和 1 的块没放
  const first = hintCellOf(grid, filled, pending, () => 0);
  const last = hintCellOf(grid, filled, pending, () => 0.999);
  expect([first, last].sort()).toEqual([1, 2]);
  // 同色块用完了 → 那个格不能被提示
  const onlyZero = hintCellOf(grid, [0], [1], () => 0.5);
  expect(onlyZero).toBe(1);
  // 没有可提示的格
  expect(hintCellOf(grid, [0, 1, 2], pending, () => 0.5)).toBe(-1);
  expect(hintCellOf([-1, -1], [], [], () => 0.5)).toBe(-1);
});

it('插屏频次：每通关 3 关一次，0/负/非数字都不弹', () => {
  expect(shouldInterstitial(0)).toBe(false);
  expect(shouldInterstitial(1)).toBe(false);
  expect(shouldInterstitial(2)).toBe(false);
  expect(shouldInterstitial(3)).toBe(true);
  expect(shouldInterstitial(4)).toBe(false);
  expect(shouldInterstitial(6)).toBe(true);
  expect(shouldInterstitial(-3)).toBe(false);
  expect(shouldInterstitial(Number.NaN)).toBe(false);
});
