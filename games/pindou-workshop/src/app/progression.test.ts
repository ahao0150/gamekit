// 进度与道具：解锁钳制、提示锁格、广告次数、最好成绩、设置开关
import { expect, it } from 'vitest';
import { FULL_ITEMS } from './items';
import { initialIron } from './iron';
import { INITIAL_STATE, reduce } from './state';
import type { GameState } from './state';

const unlockedTo = (id: number): GameState =>
  reduce(INITIAL_STATE, {
    kind: 'restore',
    progress: { unlocked: id, clears: 0, best: {}, sound: true, music: true, itemLeft: FULL_ITEMS },
  });

const startAt = (id: number): GameState => reduce(unlockedTo(id), { kind: 'startLevel', levelId: id });

/** 把该关推入 iron 屏并把所有格置为已定型，然后 tick 一次完成结算 */
const winLevel = (s: GameState): GameState => {
  const targets = s.grid.map((v, i) => (v >= 0 ? i : -1)).filter((i) => i >= 0);
  const iron = { ...initialIron(targets), cells: targets.map(() => 1 as const) };
  return reduce({ ...s, screen: 'iron', iron }, { kind: 'ironTick', dt: 0.01 });
};

it('解锁钳制：没解锁的关卡开不了（防跳关），已解锁的能开', () => {
  const fresh = reduce(INITIAL_STATE, { kind: 'startLevel', levelId: 9 });
  expect(fresh.levelId).toBe(1); // 新档只有第 1 关
  const unlocked = startAt(5);
  expect(unlocked.levelId).toBe(5);
});

it('广告提示：锁一格正确位置、扣次数、记入 hinted；共用完就不再生效', () => {
  let s = startAt(2);
  const cell = s.grid.findIndex((v) => v >= 0);
  const color = s.grid[cell]!;
  for (let i = 0; i < 3; i += 1) {
    const free = s.pieces.find((p) => !p.placed && p.color === color);
    const at = s.grid.findIndex((v, idx) => v === free!.color && !s.pieces.some((p) => p.placed && p.loc.t === 'grid' && p.loc.i === idx));
    s = reduce(s, { kind: 'adHint', cell: at });
    expect(s.hinted).toHaveLength(i + 1);
    expect(s.itemLeft.hint).toBe(2 - i);
  }
  expect(s.itemLeft.hint).toBe(0);
  // 第 4 次：次数为 0 → 状态不再变
  const before = s.hinted.length;
  const after = reduce(s, { kind: 'adHint', cell: s.grid.findIndex((v) => v >= 0) });
  expect(after.hinted).toHaveLength(before);
});

it('广告提示：空格 / 越界下标不生效（不许凭空造豆子）', () => {
  const s = startAt(2);
  const empty = s.grid.findIndex((v) => v < 0);
  const a = reduce(s, { kind: 'adHint', cell: empty });
  expect(a.pieces.filter((p) => p.placed).length).toBe(0);
  const b = reduce(s, { kind: 'adHint', cell: 9999 });
  expect(b.pieces.filter((p) => p.placed).length).toBe(0);
});

it('通关结算：解锁下一关、累计通关数 +1、记录最好成绩（剩余时间/烫糊率）', () => {
  const s = startAt(2);
  const won = winLevel(s);
  expect(won.outcome).toBe('win');
  expect(won.unlocked).toBe(3);
  expect(won.clears).toBe(1);
  const best = won.best['2']!;
  expect(best.burnt).toBe(0);
  expect(best.timeLeft).toBeGreaterThan(0);
});

it('最好成绩只在更好时覆盖（时间更长 / 烫糊更低）', () => {
  const won = winLevel(startAt(2));
  const withBest = { ...won, unlocked: 3, best: { '2': { timeLeft: 999, burnt: 0 } } };
  const better = reduce({ ...withBest, screen: 'iron', iron: { ...withBest.iron, cells: withBest.iron.cells.map(() => 1 as const) } }, { kind: 'ironTick', dt: 0.01 });
  expect(better.best['2']!.timeLeft).toBe(999); // 更差的不覆盖
});

it('失败不涨进度：不清关、不解锁、不记成绩', () => {
  const s = startAt(2);
  const fail = reduce(s, { kind: 'tick', dt: 999 });
  expect(fail.outcome).toBe('fail');
  expect(fail.clears).toBe(0);
  expect(fail.unlocked).toBe(2);
  expect(Object.keys(fail.best)).toHaveLength(0);
});

it('设置开关：声音开关同时翻 sfx 与 bgm（T73 合并后两个 bus 同值）', () => {
  let s = startAt(2);
  s = reduce(s, { kind: 'toggleSound' });
  expect(s.sound).toBe(false);
  expect(s.music).toBe(false);
  s = reduce(s, { kind: 'toggleSound' });
  expect(s.sound).toBe(true);
  expect(s.music).toBe(true);
  // toggleMusic 仍保留（旧档兼容 / 将来拆开还能用），只翻 music
  s = reduce(s, { kind: 'toggleMusic' });
  expect(s.music).toBe(false);
  // 回首页/重开一关都不会把开关重置（此时 sound 是 true，music 被 toggleMusic 单独翻成 false）
  const home = reduce(s, { kind: 'home' });
  expect(home.sound).toBe(true);
  expect(home.music).toBe(false);
  const again = reduce(home, { kind: 'startLevel', levelId: 1 });
  expect(again.sound).toBe(true);
});

it('临时位扩位受上限 4 约束（广告也不能突破）', () => {
  let s = startAt(3); // 第 3 关 tempSlots=2
  s = reduce(s, { kind: 'adSlot' });
  expect(s.tempSlots).toBe(3);
  const again = reduce({ ...s, itemLeft: { ...s.itemLeft, slot: 5 } }, { kind: 'adSlot' });
  expect(again.tempSlots).toBe(4);
  const capped = reduce({ ...again, itemLeft: { ...again.itemLeft, slot: 5 } }, { kind: 'adSlot' });
  expect(capped.tempSlots).toBe(4);
});
