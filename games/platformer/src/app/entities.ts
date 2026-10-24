/**
 * 关卡实体（敌人 / 金币 / 终点）与它们的纯逻辑迁移。
 *
 * **剔除的正确用法**（2026-10-20 修订）：逻辑全量更新、剔除只管渲染。
 * 早年想「离屏就冻结」是错的 —— 怪物走出视口被冻住就永远停在边界外，
 * 玩家回来看到「卡住的怪」，而且它本该回头/该掉坑都不会发生。
 * 所以这里的 `patrol` / `pickup` 对**所有**实体跑，与是否可见无关。
 */

import { COINS, ENEMIES, GOAL, GROUND, PLAYER } from './level';
import { onWin } from './state';
import type { GameState } from './state';

export interface EnemyView {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** 1 = 向右巡逻，-1 = 向左 */
  readonly dir: 1 | -1;
  readonly alive: boolean;
}

export interface CoinView {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly taken: boolean;
}

export interface Entities {
  readonly enemies: readonly EnemyView[];
  readonly coins: readonly CoinView[];
  /** 终点旗子的矩形 */
  readonly goal: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export const createEntities = (): Entities => ({
  enemies: ENEMIES.map((def) => ({ id: def.id, x: def.x, y: def.y, dir: 1, alive: true })),
  coins: COINS.map((def) => ({ id: def.id, x: def.x, y: def.y, taken: false })),
  goal: GOAL,
});

/** 敌人来回巡逻：走到边界就掉头（纯函数，与是否可见无关）。 */
export const patrol = (entities: Entities, dt: number): Entities => {
  let changed = false;
  const enemies = entities.enemies.map((enemy) => {
    if (!enemy.alive) return enemy;
    const def = ENEMIES.find((item) => item.id === enemy.id);
    if (def === undefined) return enemy;
    let dir = enemy.dir;
    let x = enemy.x + dir * def.speed * dt;
    if (x > def.toX) {
      x = def.toX;
      dir = -1;
    } else if (x < def.fromX) {
      x = def.fromX;
      dir = 1;
    }
    if (x === enemy.x && dir === enemy.dir) return enemy;
    changed = true;
    return { ...enemy, x, dir };
  });
  return changed ? { ...entities, enemies } : entities;
};

/** 玩家矩形（以中心 + 尺寸表示）。 */
const playerRect = (state: GameState): { x: number; y: number; w: number; h: number } => ({
  x: state.player.x - PLAYER.w / 2,
  y: state.player.y - PLAYER.h / 2,
  w: PLAYER.w,
  h: PLAYER.h,
});

const overlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export interface StepResult {
  readonly entities: Entities;
  readonly state: GameState;
  /** 这一帧是否踩死了敌人（调用方给玩家一个回弹） */
  readonly stomped: boolean;
  /** 这一帧被敌人侧撞（调用方扣命复位） */
  readonly hurt: boolean;
}

/**
 * 实体与玩家的交互，一帧一次：
 * 1. 金币：矩形相近即吃掉（放 center 距 < 半径 + 半玩家宽）；
 * 2. 敌人：**踩头顶**（玩家下落中且脚在敌人上半部）→ 消灭 + 回弹；否则侧撞 → 挨打；
 * 3. 终点：碰到就通关。
 */
export const interact = (
  entities: Entities,
  state: GameState,
): StepResult => {
  if (state.phase !== 'play') return { entities, state, stomped: false, hurt: false };
  const player = playerRect(state);
  let stomped = false;
  let hurt = false;
  let coins = entities.coins;
  let nextState = state;

  // 金币
  const picked = coins.filter((coin) => !coin.taken
    && Math.abs(coin.x - state.player.x) < 20 + PLAYER.w / 2
    && Math.abs(coin.y - state.player.y) < 20 + PLAYER.h / 2);
  if (picked.length > 0) {
    const ids = new Set(picked.map((coin) => coin.id));
    coins = coins.map((coin) => (ids.has(coin.id) ? { ...coin, taken: true } : coin));
    nextState = { ...nextState, coins: nextState.coins + picked.length };
  }

  // 敌人
  const enemies = entities.enemies.map((enemy) => {
    if (!enemy.alive) return enemy;
    const def = ENEMIES.find((item) => item.id === enemy.id);
    const w = def?.w ?? 30;
    const h = def?.h ?? 26;
    const rect = { x: enemy.x - w / 2, y: enemy.y - h / 2, w, h };
    if (!overlap(player, rect)) return enemy;
    const feet = state.player.y + PLAYER.h / 2;
    const falling = state.player.vy > 0;
    // 踩头顶：下落中 + 脚在敌人上半部（用位置+速度判，不完全靠碰撞回调）
    if (falling && feet <= rect.y + h * 0.6) {
      stomped = true;
      return { ...enemy, alive: false };
    }
    hurt = true;
    return enemy;
  });

  // 终点
  const goalHit = overlap(player, entities.goal);
  if (goalHit) nextState = onWin(nextState);

  return { entities: { ...entities, enemies, coins }, state: nextState, stomped, hurt };
};
