import { describe, expect, it } from 'vitest';
import { createEntities, interact, patrol } from './entities';
import { ENEMIES, FALL_LINE, GOAL, PLAYER, SPAWN } from './level';
import { createInitialState, setPlayer } from './state';

/** 把玩家放到指定位置与速度（y 是中心）。 */
const withPlayer = (
  x: number,
  y: number,
  vy = 0,
): ReturnType<typeof createInitialState> => {
  const state = createInitialState();
  return setPlayer(state, { ...state.player, x, y, vy });
};

describe('巡逻（逻辑全量更新，不因离屏冻结）', () => {
  it('走到上界掉头、走到下界再掉头（区间闭合）', () => {
    let entities = createEntities();
    const def = ENEMIES[0]!;
    let minX = Infinity;
    let maxX = -Infinity;
    let dirChanges = 0;
    let lastDir = entities.enemies[0]!.dir;
    // 跑 20 秒（0.05 步长）：足够它来回好几趟
    for (let i = 0; i < 400; i += 1) {
      entities = patrol(entities, 0.05);
      const enemy = entities.enemies[0]!;
      minX = Math.min(minX, enemy.x);
      maxX = Math.max(maxX, enemy.x);
      if (enemy.dir !== lastDir) {
        dirChanges += 1;
        lastDir = enemy.dir;
      }
    }
    expect(dirChanges).toBeGreaterThan(2); // 来回至少两趟
    expect(minX).toBeGreaterThanOrEqual(def.fromX - 0.001);
    expect(maxX).toBeLessThanOrEqual(def.toX + 0.001);
  });

  it('被踩死的敌人不再移动（alive=false 后巡逻跳过它）', () => {
    let entities = createEntities();
    const dead = entities.enemies.map((enemy) => (enemy.id === 1 ? { ...enemy, alive: false } : enemy));
    entities = { ...entities, enemies: dead };
    const snapshot = entities.enemies[0]!;
    for (let i = 0; i < 60; i += 1) entities = patrol(entities, 0.05);
    expect(entities.enemies[0]!).toEqual(snapshot);
  });

  it('三个敌人各自在自己的区间内（不跨坑）', () => {
    let entities = createEntities();
    for (let i = 0; i < 200; i += 1) entities = patrol(entities, 0.05);
    for (const [index, enemy] of entities.enemies.entries()) {
      const def = ENEMIES[index]!;
      expect(enemy.x).toBeGreaterThanOrEqual(def.fromX - 0.001);
      expect(enemy.x).toBeLessThanOrEqual(def.toX + 0.001);
    }
  });
});

describe('金币', () => {
  it('碰到金币 → 金币数 +1、该枚标记已吃', () => {
    const entities = createEntities();
    const coin = entities.coins[0]!;
    const state = withPlayer(coin.x, coin.y);
    const result = interact(entities, state);
    expect(result.state.coins).toBe(1);
    expect(result.entities.coins.find((item) => item.id === coin.id)!.taken).toBe(true);
  });

  it('同一枚金币不会重复计数（taken 后不再匹配）', () => {
    const entities = createEntities();
    const coin = entities.coins[0]!;
    const first = interact(entities, withPlayer(coin.x, coin.y));
    expect(first.state.coins).toBe(1);
    // 玩家原地不动再来一帧（interact 不改玩家位置，直接沿用 first.state）
    const second = interact(first.entities, first.state);
    expect(second.state.coins).toBe(1);
    expect(second.entities.coins).toBe(first.entities.coins); // 没改动就不换对象
  });

  it('离金币很远 → 不加分', () => {
    const entities = createEntities();
    const result = interact(entities, withPlayer(SPAWN.x, SPAWN.y));
    expect(result.state.coins).toBe(0);
  });
});

describe('敌人：踩头顶 vs 侧撞', () => {
  const enemy = ENEMIES[0]!;
  const enemyTop = enemy.y - enemy.h / 2;

  it('下落中踩到敌人头顶 → 敌人消失、标记 stomped、不扣命', () => {
    const entities = createEntities();
    // 玩家中心略高于敌人顶部（脚在敌人上半部），且正在下落
    const state = withPlayer(enemy.x, enemyTop - PLAYER.h / 2 + 6, 300);
    const result = interact(entities, state);
    expect(result.stomped).toBe(true);
    expect(result.hurt).toBe(false);
    expect(result.entities.enemies.find((item) => item.id === enemy.id)!.alive).toBe(false);
    expect(result.state.lives).toBe(3);
  });

  it('站着/上跳时侧面碰到敌人 → 挨打（hurt），敌人不死', () => {
    const entities = createEntities();
    const state = withPlayer(enemy.x, enemy.y, -100);
    const result = interact(entities, state);
    expect(result.stomped).toBe(false);
    expect(result.hurt).toBe(true);
    expect(result.entities.enemies.find((item) => item.id === enemy.id)!.alive).toBe(true);
  });

  it('被踩死的敌人再碰到不会重复触发', () => {
    const entities = createEntities();
    const dead = { ...entities, enemies: entities.enemies.map((e) => (e.id === enemy.id ? { ...e, alive: false } : e)) };
    const result = interact(dead, withPlayer(enemy.x, enemyTop - PLAYER.h / 2 + 6, 300));
    expect(result.stomped).toBe(false);
    expect(result.hurt).toBe(false);
  });
});

describe('终点与非 play 阶段', () => {
  it('碰到终点 → phase = won', () => {
    const entities = createEntities();
    const state = withPlayer(GOAL.x + GOAL.w / 2, GOAL.y + GOAL.h / 2);
    expect(interact(entities, state).state.phase).toBe('won');
  });

  it('已经 gameover / won 时不再交互（金币不加、不重复通关）', () => {
    const entities = createEntities();
    const coin = entities.coins[0]!;
    for (const phase of ['won', 'gameover'] as const) {
      const base = withPlayer(coin.x, coin.y);
      const state = { ...base, phase };
      const result = interact(entities, state);
      expect(result.state.coins).toBe(state.coins);
      expect(result.state.phase).toBe(phase);
    }
  });

  it('掉落判定线之下的玩家不会误触发金币/终点（相位是 dead 时会先复位）', () => {
    const entities = createEntities();
    const state = withPlayer(0, FALL_LINE + 100);
    const result = interact(entities, state);
    expect(result.state.phase).toBe('play'); // interact 不管掉坑，交给 game.ts
  });
});
