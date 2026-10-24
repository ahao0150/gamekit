/**
 * 游戏状态（纯数据 + 纯函数迁移）。物理位姿由 physics-2d 提供，这里只存「玩法层面的东西」。
 *
 * 为什么把玩家坐标也放进来：渲染与调试钩子只读这一份快照，不必再摸物理世界；
 * 而判定（掉坑、踩怪、吃金币）也全在纯函数里做，方便单测。
 */

import { FALL_LINE, SPAWN } from './level';

export type Phase = 'play' | 'dead' | 'gameover' | 'won';

export interface PlayerView {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly onGround: boolean;
  /** 1 = 朝右，-1 = 朝左 */
  readonly facing: 1 | -1;
}

export interface GameState {
  readonly phase: Phase;
  readonly lives: number;
  readonly coins: number;
  readonly player: PlayerView;
  /** 剩余无敌时间（秒）：死亡复活后短暂无敌，避免刚回来又掉 */
  readonly invulnerable: number;
}

export const INITIAL_LIVES = 3;

export const createInitialState = (): GameState => ({
  phase: 'play',
  lives: INITIAL_LIVES,
  coins: 0,
  player: { x: SPAWN.x, y: SPAWN.y, vx: 0, vy: 0, onGround: true, facing: 1 },
  invulnerable: 0,
});

/** 玩家是否已经掉出世界（掉坑判定）。 */
export const isFallen = (state: GameState): boolean => state.player.y > FALL_LINE;

/**
 * 掉坑 → 扣命并复位。
 *
 * 纯函数：输入旧状态输出新状态，不碰物理世界（复位由调用方按 SPAWN 去 setPosition）。
 */
export const onFall = (state: GameState): GameState => {
  const lives = state.lives - 1;
  const respawned = { ...state.player, x: SPAWN.x, y: SPAWN.y, vx: 0, vy: 0, onGround: true };
  if (lives <= 0) {
    return { ...state, phase: 'gameover', lives: 0, player: respawned, invulnerable: 0 };
  }
  return { ...state, phase: 'dead', lives, player: respawned, invulnerable: 0 };
};

/** 复活完成（无敌时间起算），回到 play。 */
export const onRespawned = (state: GameState, invulnerable: number): GameState => ({
  ...state,
  phase: 'play',
  invulnerable,
});

/** 碰到终点 → 通关（只在 play 里生效，已通关/已失败的不会被覆盖）。 */
export const onWin = (state: GameState): GameState =>
  state.phase === 'play' ? { ...state, phase: 'won' } : state;

/** 重开一局。 */
export const onRestart = (): GameState => createInitialState();

/** 每帧衰减无敌时间。 */
export const tickInvulnerable = (state: GameState, dt: number): GameState => {
  if (state.invulnerable <= 0) return state;
  const next = Math.max(0, state.invulnerable - dt);
  return next === state.invulnerable ? state : { ...state, invulnerable: next };
};

/** 更新玩家快照（物理位姿 → 玩法状态），只在值变化时换对象。 */
export const setPlayer = (state: GameState, player: PlayerView): GameState => {
  const prev = state.player;
  if (prev.x === player.x && prev.y === player.y && prev.vx === player.vx
    && prev.vy === player.vy && prev.onGround === player.onGround && prev.facing === player.facing) {
    return state;
  }
  return { ...state, player };
};

/** 吃金币（batch 2 用；迁移先写好）。 */
export const addCoin = (state: GameState, amount = 1): GameState => ({
  ...state,
  coins: state.coins + amount,
});
