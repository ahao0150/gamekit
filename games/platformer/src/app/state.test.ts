import { describe, expect, it } from 'vitest';
import { FALL_LINE, SPAWN } from './level';
import {
  INITIAL_LIVES, createInitialState, isFallen, onFall, onRespawned, onRestart,
  setPlayer, tickInvulnerable,
} from './state';

const fallen = (): ReturnType<typeof createInitialState> => setPlayer(createInitialState(), {
  ...createInitialState().player, x: 300, y: FALL_LINE + 10, vy: 400,
});

describe('初始状态', () => {
  it('3 条命、0 金币、出生点在起点、phase=play', () => {
    const state = createInitialState();
    expect(state.lives).toBe(INITIAL_LIVES);
    expect(state.coins).toBe(0);
    expect(state.phase).toBe('play');
    expect(state.player.x).toBe(SPAWN.x);
    expect(state.player.y).toBe(SPAWN.y);
  });
});

describe('掉坑', () => {
  it('isFallen：低于判定线才算掉，刚跳起不算', () => {
    expect(isFallen(createInitialState())).toBe(false);
    expect(isFallen(fallen())).toBe(true);
  });

  it('掉坑 → 扣 1 命、回起点、phase=dead', () => {
    const next = onFall(fallen());
    expect(next.lives).toBe(INITIAL_LIVES - 1);
    expect(next.phase).toBe('dead');
    expect(next.player.x).toBe(SPAWN.x);
    expect(next.player.y).toBe(SPAWN.y);
    expect(next.player.vx).toBe(0);
  });

  it('最后一条命掉坑 → phase=gameover，生命不为负', () => {
    let state = createInitialState();
    for (let i = 0; i < INITIAL_LIVES - 1; i += 1) state = onFall({ ...state, player: { ...state.player, y: FALL_LINE + 10 } });
    expect(state.lives).toBe(1);
    const last = onFall({ ...state, player: { ...state.player, y: FALL_LINE + 10 } });
    expect(last.lives).toBe(0);
    expect(last.phase).toBe('gameover');
  });

  it('复活：回到 play 并给无敌时间', () => {
    const next = onRespawned(onFall(fallen()), 0.8);
    expect(next.phase).toBe('play');
    expect(next.invulnerable).toBeCloseTo(0.8, 6);
  });

  it('重开回到初始状态（金币与生命都重置）', () => {
    const state = onRestart();
    expect(state).toEqual(createInitialState());
  });
});

describe('无敌时间与快照', () => {
  it('tickInvulnerable 按 dt 衰减到 0 后不再变', () => {
    const state = onRespawned(createInitialState(), 0.5);
    const a = tickInvulnerable(state, 0.2);
    expect(a.invulnerable).toBeCloseTo(0.3, 6);
    const b = tickInvulnerable(a, 1);
    expect(b.invulnerable).toBe(0);
    expect(tickInvulnerable(b, 1)).toBe(b); // 已为 0 时返回同一对象
  });

  it('setPlayer 值没变时返回同一对象（避免每帧都造新状态）', () => {
    const state = createInitialState();
    expect(setPlayer(state, state.player)).toBe(state);
    const moved = setPlayer(state, { ...state.player, x: state.player.x + 1 });
    expect(moved).not.toBe(state);
    expect(moved.player.x).toBe(state.player.x + 1);
  });
});
