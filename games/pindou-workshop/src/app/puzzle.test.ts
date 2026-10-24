// A 段拼豆纯逻辑：归位判定、非法落位、临时位存取、倒计时、关卡数据
import { expect, it } from 'vitest';
import { INITIAL_STATE, dealPieces, levelOf, placedCount, reduce } from './state';
import { GRID, LEVELS } from './levels';
import { initialIron } from './iron';
import { FULL_ITEMS } from './items';

it('关卡表：12 关、40–120 色块、3–6 色、图案格与色块数一致', () => {
  expect(LEVELS).toHaveLength(12);
  for (const l of LEVELS) {
    expect(l.pieceCount).toBeGreaterThanOrEqual(40);
    expect(l.pieceCount).toBeLessThanOrEqual(120);
    expect(l.colors).toBeGreaterThanOrEqual(3);
    expect(l.colors).toBeLessThanOrEqual(6);
    expect(l.grid.filter((v) => v >= 0)).toHaveLength(l.pieceCount);
    expect(l.grid.every((v) => v < l.colors)).toBe(true);
    expect(l.grid).toHaveLength(GRID * GRID);
  }
});

it('dealPieces：数量=图案格数、确定性打乱（同关同序）', () => {
  const l = levelOf(1);
  const a = dealPieces(l);
  const b = dealPieces(l);
  expect(a).toEqual(b);
  expect(a).toHaveLength(l.pieceCount);
  expect(a.every((p) => p.loc.t === 'spawn' && !p.placed)).toBe(true);
  // 每个色块的颜色都能在图案里找到（同色数守恒）
  for (const c of l.grid) {
    if (c < 0) continue;
    expect(a.filter((p) => p.color === c).length).toBe(l.grid.filter((v) => v === c).length);
  }
});

/** 解锁到第 id 关再开（startLevel 现在会被 unlocked 钳住，防止跳关） */
const startAt = (id: number) => {
  const unlocked = reduce(INITIAL_STATE, {
    kind: 'restore',
    progress: { unlocked: id, clears: 0, best: {}, sound: true, music: true, itemLeft: FULL_ITEMS },
  });
  return reduce(unlocked, { kind: 'startLevel', levelId: id });
};
it('startLevel：进 board、倒计时与临时位来自关卡', () => {
  const s = startAt(3);
  expect(s.screen).toBe('board');
  expect(s.timeLeft).toBe(levelOf(3).timeLimitSec);
  expect(s.tempSlots).toBe(levelOf(3).tempSlots);
});

it('归位：落到同色图案格 → placed；全部归位自动进 iron', () => {
  let s = reduce(INITIAL_STATE, { kind: 'startLevel', levelId: 1 });
  const firstIdx = s.grid.findIndex((v) => v >= 0);
  const piece = s.pieces.find((p) => p.color === s.grid[firstIdx])!;
  s = reduce(s, { kind: 'drop', pieceId: piece.id, target: { t: 'grid', i: firstIdx } });
  expect(s.pieces.find((p) => p.id === piece.id)!.placed).toBe(true);
  expect(placedCount(s)).toBe(1);
  // 逐个归位到 iron
  let guard = 200;
  while (s.screen === 'board' && guard-- > 0) {
    const p = s.pieces.find((q) => !q.placed)!;
    const idx = s.grid.findIndex((v, i) => v === p.color && !s.pieces.some((q) => q.loc.t === 'grid' && q.loc.i === i));
    s = reduce(s, { kind: 'drop', pieceId: p.id, target: { t: 'grid', i: idx } });
  }
  expect(s.screen).toBe('iron');
  expect(s.iron.targets.length).toBe(levelOf(1).pieceCount);
});

it('非法落位：颜色不符弹回（不锁定）+ 震屏', () => {
  let s = reduce(INITIAL_STATE, { kind: 'startLevel', levelId: 1 });
  const wrongIdx = s.grid.findIndex((v) => v >= 0 && v !== s.pieces[0]!.color);
  const p0 = s.pieces[0]!;
  s = reduce(s, { kind: 'drop', pieceId: p0.id, target: { t: 'grid', i: wrongIdx } });
  const after = s.pieces.find((p) => p.id === p0.id)!;
  expect(after.placed).toBe(false);
  expect(after.loc.t).toBe('spawn'); // 弹回
  expect(s.shake).toBe(1);
});

it('重复落位：已占格拒绝并震屏', () => {
  let s = reduce(INITIAL_STATE, { kind: 'startLevel', levelId: 1 });
  const idx = s.grid.findIndex((v) => v >= 0);
  const c = s.grid[idx]!;
  const pair = s.pieces.filter((p) => p.color === c);
  s = reduce(s, { kind: 'drop', pieceId: pair[0]!.id, target: { t: 'grid', i: idx } });
  const other = pair[1] ?? s.pieces.find((p) => p.color === c && p.id !== pair[0]!.id);
  if (other !== undefined) {
    s = reduce(s, { kind: 'drop', pieceId: other.id, target: { t: 'grid', i: idx } });
    expect(s.shake).toBe(1);
  }
});

it('临时位：空位可存取、越界/占位拒绝', () => {
  let s = reduce(INITIAL_STATE, { kind: 'startLevel', levelId: 1 });
  const p = s.pieces[0]!;
  s = reduce(s, { kind: 'drop', pieceId: p.id, target: { t: 'temp', k: 0 } });
  expect(s.pieces.find((q) => q.id === p.id)!.loc).toEqual({ t: 'temp', k: 0 });
  // 占位拒绝
  const q = s.pieces[1]!;
  const before = reduce(s, { kind: 'drop', pieceId: q.id, target: { t: 'temp', k: 0 } });
  expect(before.pieces.find((x) => x.id === q.id)!.loc.t).toBe('spawn');
  // 越界拒绝（tempSlots 之外）
  const over = reduce(s, { kind: 'drop', pieceId: q.id, target: { t: 'temp', k: 9 } });
  expect(over.pieces.find((x) => x.id === q.id)!.loc.t).toBe('spawn');
});

it('倒计时：tick 递减；归 0 → result/fail', () => {
  let s = reduce(INITIAL_STATE, { kind: 'startLevel', levelId: 1 });
  s = reduce(s, { kind: 'tick', dt: 5 });
  expect(s.timeLeft).toBe(levelOf(1).timeLimitSec - 5);
  s = reduce(s, { kind: 'tick', dt: 999 });
  expect(s.screen).toBe('result');
  expect(s.outcome).toBe('fail');
  expect(reduce(s, { kind: 'tick', dt: 1 }).screen).toBe('result'); // 终局后不再走
});

it('广告道具：续时 +30 秒、临时位 +1（上限 4），并扣本关次数', () => {
  let s = startAt(2);
  const t0 = s.timeLeft;
  s = reduce(s, { kind: 'adTime' });
  expect(s.timeLeft).toBe(t0 + 30);
  expect(s.itemLeft.time).toBe(0);
  const slots0 = s.tempSlots;
  s = reduce(s, { kind: 'adSlot' });
  expect(s.tempSlots).toBe(Math.min(4, slots0 + 1));
  expect(s.itemLeft.slot).toBe(0);
  // 次数用完后再发同一条 action 不生效（防刷）
  const after = reduce(s, { kind: 'adTime' });
  expect(after.timeLeft).toBe(s.timeLeft);
});

it('retry/next：fail 后重来同关；win 后 next 进下一关', () => {
  let s = startAt(2);
  s = reduce(s, { kind: 'tick', dt: 999 });
  s = reduce(s, { kind: 'retry' });
  expect(s.screen).toBe('board');
  expect(s.levelId).toBe(2);
  // 走**真实**的通关迁移（settle 会解锁下一关）：把熨烫格全部置为已定型再 tick 一次
  const targets = s.grid.map((v, i) => (v >= 0 ? i : -1)).filter((i) => i >= 0);
  const iron = { ...initialIron(targets), cells: targets.map(() => 1 as const) };
  let won = reduce(s, { kind: 'drop', pieceId: -1, target: { t: 'grid', i: -1 } }); // 无副作用，保持同关
  won = { ...won, screen: 'iron', iron };
  const done = reduce(won, { kind: 'ironTick', dt: 0.01 });
  expect(done.outcome).toBe('win');
  expect(done.unlocked).toBe(3); // 通关解锁下一关
  const nx = reduce(done, { kind: 'next' });
  expect(nx.levelId).toBe(3);
  expect(nx.screen).toBe('board');
});
