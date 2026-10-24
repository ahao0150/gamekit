import { describe, expect, it } from 'vitest';
import {
  CAMERA, FALL_LINE, GROUND, MOVE, PLATFORMS, PLAYER, SPAWN, SOLIDS, WALLS, WORLD, feetOn,
} from './level';

/** 起跳高度：v² / (2g) */
const jumpHeight = (MOVE.jumpSpeed * MOVE.jumpSpeed) / (2 * MOVE.gravity);

describe('地形设计', () => {
  it('地面分三段，中间留两个坑（坑宽 100–120，跳得过去）', () => {
    expect(GROUND.length).toBe(3);
    const gaps: number[] = [];
    for (let i = 0; i < GROUND.length - 1; i += 1) {
      gaps.push(GROUND[i + 1]!.x - (GROUND[i]!.x + GROUND[i]!.w));
    }
    expect(gaps).toEqual([120, 100]);
    // 滞空时间 × 横向速度 = 一跳能过的距离
    const airtime = (2 * MOVE.jumpSpeed) / MOVE.gravity;
    for (const gap of gaps) expect(MOVE.speed * airtime).toBeGreaterThan(gap + 20);
  });

  it('每块浮空平台都从地面跳得上去（高度差 < 起跳高度 - 10）', () => {
    const groundTop = GROUND[0]!.y;
    expect(jumpHeight).toBeCloseTo(106.8, 1);
    for (const platform of PLATFORMS) {
      expect(groundTop - platform.y).toBeLessThan(jumpHeight - 10);
    }
  });

  it('出生点脚底正好贴地面顶面', () => {
    expect(SPAWN.y + PLAYER.h / 2).toBeCloseTo(GROUND[0]!.y, 6);
  });

  it('掉落判定线在地面底部之下（掉坑才算掉，正常跳不会误判）', () => {
    const groundBottom = GROUND[0]!.y + GROUND[0]!.h;
    expect(FALL_LINE).toBeGreaterThan(groundBottom - 1);
    expect(FALL_LINE).toBeGreaterThan(WORLD.h - 100);
  });

  it('世界宽度是屏幕的 3–4 倍（需要相机跟随）', () => {
    expect(WORLD.w / 390).toBeGreaterThan(3);
    expect(WORLD.w / 390).toBeLessThan(4.5);
  });

  it('SOLIDS = 地面 + 平台 + 边界墙（不多不少）', () => {
    expect(SOLIDS.length).toBe(GROUND.length + PLATFORMS.length + WALLS.length);
    for (const wall of WALLS) expect(SOLIDS).toContain(wall);
  });

  it('左右边界墙贴在世界边界外侧，玩家走不出世界（真机「往左走摔死」回归）', () => {
    expect(WALLS.length).toBe(2);
    const left = WALLS[0]!;
    const right = WALLS[1]!;
    // 左墙内侧面正好在世界 x=0（玩家中心最小 = 半宽 14），右墙内侧面在 x=WORLD.w
    expect(left.x + left.w).toBe(0);
    expect(right.x).toBe(WORLD.w);
    expect(left.y).toBe(0);
    expect(left.h).toBe(WORLD.h);
    expect(right.h).toBe(WORLD.h);
    expect(left.h).toBe(WORLD.h);
    // 墙从 y=0 盖到世界底部，覆盖玩家从跳跃顶点到地面的整段纵向范围
    expect(left.y + left.h).toBeGreaterThanOrEqual(GROUND[0]!.y);
  });

  it('边界墙不会被 feetOn 误判成可站立的地面', () => {
    for (const wall of WALLS) {
      expect(feetOn(wall, SPAWN.x, SPAWN.y)).toBe(false);
    }
  });

  it('相机参数：横向死区 120、前瞻 60、纵向死区大到固定', () => {
    expect(CAMERA.deadzone.w).toBe(120);
    expect(CAMERA.lookAhead).toBe(60);
    expect(CAMERA.deadzone.h).toBeGreaterThan(WORLD.h * 10);
  });
});

describe('脚下探测 feetOn', () => {
  const ground = { x: 0, y: 680, w: 520, h: 164 };

  it('站在地面上 → true', () => {
    expect(feetOn(ground, 100, 680 - PLAYER.h / 2)).toBe(true);
  });

  it('离地 20px → false（不能浮空起跳）', () => {
    expect(feetOn(ground, 100, 680 - PLAYER.h / 2 - 20)).toBe(false);
  });

  it('横向在坑上方 → false（即使高度对）', () => {
    expect(feetOn(ground, 560, 680 - PLAYER.h / 2)).toBe(false);
  });

  it('脚在平台顶面 → true（平台同样可站）', () => {
    const platform = PLATFORMS[0]!;
    expect(feetOn(platform, platform.x + 10, platform.y - PLAYER.h / 2)).toBe(true);
  });
});
