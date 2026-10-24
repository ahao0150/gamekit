import { expect, it } from 'vitest';
import { ACTION_OF, INITIAL_STATE, reduce, SCORE_GOAL } from './state';

it('初始状态：主界面、0 分、带提示文案', () => {
  expect(INITIAL_STATE).toMatchObject({ screen: 'home', score: 0 });
  expect(INITIAL_STATE.hint.length).toBeGreaterThan(0);
  expect(SCORE_GOAL).toBeGreaterThan(0);
});

it('tap：分数每次 +1，提示里带上当前分数', () => {
  const once = reduce(INITIAL_STATE, { kind: 'tap' });
  expect(once.score).toBe(1);
  expect(once.hint).toContain('1');
  const twice = reduce(once, { kind: 'tap' });
  expect(twice.score).toBe(2);
  expect(twice.hint).toContain('2');
});

it('reduce 是纯函数：不修改入参', () => {
  const before = INITIAL_STATE;
  reduce(before, { kind: 'tap' });
  expect(before.score).toBe(0);
  expect(before).toEqual(INITIAL_STATE);
});

it('ACTION_OF：home 的 button 绑了 tap（其它组件不可点）', () => {
  expect(ACTION_OF.home).toEqual({ button: { kind: 'tap' } });
  expect(ACTION_OF.home['panel']).toBeUndefined();
});
