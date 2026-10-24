// 第二轮动效的纯数值层（spec 的数值出处都标在 anim.ts）：连击阶梯、锁定高光、粒子、烫糊、温度脉冲
import { expect, it } from 'vitest';
import { IRON_BURN, IRON_COLD } from './skin';
import {
  BURN_DISSOLVE,
  BURN_DISSOLVE_DELAY_MS,
  BURN_DISSOLVE_MS,
  COMBO_PEAK,
  LOCK_DOWN_MS,
  LOCK_UP_MS,
  PARTICLE_FLY,
  PARTICLE_MS,
  TEMP_HOT_PULSE_AMP,
  TEMP_WARN_PULSE_AMP,
  burnDissolveAt,
  burnPatches,
  comboPeak,
  ironCellColor,
  lockIntensityAt,
  mixColor,
  parseHex,
  particleAt,
  shiftColor,
  tempPulse,
} from './anim';

it('连击光晕阶梯：1/2/3/4 → 1.40/1.80/2.20/2.60，≥5 封顶', () => {
  expect(comboPeak(1)).toBeCloseTo(1.4, 6);
  expect(comboPeak(2)).toBeCloseTo(1.8, 6);
  expect(comboPeak(3)).toBeCloseTo(2.2, 6);
  expect(comboPeak(4)).toBeCloseTo(2.6, 6);
  expect(comboPeak(5)).toBeCloseTo(2.6, 6);
  expect(comboPeak(99)).toBeCloseTo(2.6, 6);
  // 坏输入不抛，回落到最低档
  expect(comboPeak(0)).toBeCloseTo(COMBO_PEAK[0], 6);
  expect(comboPeak(Number.NaN)).toBeCloseTo(COMBO_PEAK[0], 6);
});

it('锁定高光：0 → peak(80ms out) → 0(80ms in)，160ms 之后恒为 0', () => {
  expect(lockIntensityAt(1, 0)).toBeCloseTo(0, 6);
  expect(lockIntensityAt(1, LOCK_UP_MS)).toBeCloseTo(1.4, 6);
  expect(lockIntensityAt(1, LOCK_UP_MS + 1)).toBeGreaterThan(1.3);
  expect(lockIntensityAt(1, LOCK_UP_MS + LOCK_DOWN_MS)).toBeCloseTo(0, 6);
  expect(lockIntensityAt(1, 999)).toBe(0);
  expect(lockIntensityAt(1, -5)).toBe(0);
  // 连击越高越亮（时长不变 —— 改时长节奏就乱）
  expect(lockIntensityAt(3, LOCK_UP_MS)).toBeGreaterThan(lockIntensityAt(2, LOCK_UP_MS));
});

it('归位粒子：3 颗、起始 alpha 0.9、120ms 内飞散 12px 且淡出到 0', () => {
  const first = [0, 1, 2].map((i) => particleAt(0, i));
  expect(first).toHaveLength(3);
  for (const p of first) expect(p.alpha).toBeCloseTo(0.9, 6);
  const last = [0, 1, 2].map((i) => particleAt(PARTICLE_MS, i));
  for (const p of last) {
    expect(p.alpha).toBeCloseTo(0, 6);
    expect(Math.hypot(p.dx, p.dy)).toBeCloseTo(PARTICLE_FLY, 4);
  }
});

it('熨烫单格颜色：未烫 → 暖褐（120ms）／烫糊 → 焦褐（120ms in）', () => {
  const done = '#5aa06a';
  expect(ironCellColor(done, 0, 0)).toBe(IRON_COLD);
  expect(ironCellColor(done, 1, 1000)).toBe(mixColor(IRON_COLD, done, 1));
  expect(ironCellColor(done, 2, 1000)).toBe(mixColor(IRON_COLD, IRON_BURN, 1));
  // 中间态既不是起点也不是终点（真的在过渡）
  const mid = ironCellColor(done, 1, 60);
  expect(mid).not.toBe(IRON_COLD);
  expect(mid).not.toBe(mixColor(IRON_COLD, done, 1));
});

it('烫糊溶解进度：延迟 40ms 才起，480ms 后停在 0.60（留下糊痕，不全消失）', () => {
  expect(burnDissolveAt(0)).toBe(0);
  expect(burnDissolveAt(BURN_DISSOLVE_DELAY_MS)).toBeCloseTo(0, 6);
  expect(burnDissolveAt(BURN_DISSOLVE_DELAY_MS + BURN_DISSOLVE_MS)).toBeCloseTo(BURN_DISSOLVE, 6);
  expect(burnDissolveAt(99999)).toBeCloseTo(0.6, 6);
  expect(burnDissolveAt(Number.NaN)).toBe(0);
});

it('烫糊噪声小块：进度 0 不盖、进度 1 盖满 16 块、确定性、都在格内', () => {
  const rect = { x: 10, y: 20, w: 40, h: 40 };
  expect(burnPatches(rect, 0)).toEqual([]);
  const all = burnPatches(rect, 1);
  expect(all).toHaveLength(16);
  expect(burnPatches(rect, 1)).toEqual(all); // 同一输入同一输出（不用 Math.random）
  for (const p of all) {
    expect(p.x).toBeGreaterThanOrEqual(rect.x - 0.01);
    expect(p.y).toBeGreaterThanOrEqual(rect.y - 0.01);
    expect(p.x + p.w).toBeLessThanOrEqual(rect.x + rect.w + 1);
    expect(p.y + p.h).toBeLessThanOrEqual(rect.y + rect.h + 1);
  }
  const half = burnPatches(rect, 0.6);
  expect(half.length).toBeGreaterThan(0);
  expect(half.length).toBeLessThan(16);
});

it('温度脉冲：绿窗不脉冲；琥珀 ±12/400ms；超温 ±20/300ms', () => {
  expect(tempPulse('ok', 0)).toBe(0);
  expect(tempPulse('ok', 137)).toBe(0);
  expect(tempPulse('warn', 100)).toBeCloseTo(TEMP_WARN_PULSE_AMP, 6);
  expect(tempPulse('warn', 300)).toBeCloseTo(-TEMP_WARN_PULSE_AMP, 6);
  expect(tempPulse('hot', 75)).toBeCloseTo(TEMP_HOT_PULSE_AMP, 6);
  expect(tempPulse('hot', 225)).toBeCloseTo(-TEMP_HOT_PULSE_AMP, 6);
});

it('颜色工具：插值端点/钳制、亮度偏移不越界、坏输入回落中性灰', () => {
  expect(mixColor('#000000', '#ffffff', 0)).toBe('#000000');
  expect(mixColor('#000000', '#ffffff', 1)).toBe('#ffffff');
  expect(mixColor('#000000', '#ffffff', 2)).toBe('#ffffff');
  expect(mixColor('#000000', '#ffffff', -1)).toBe('#000000');
  expect(shiftColor('#ffffff', 100)).toBe('#ffffff');
  expect(shiftColor('#000000', -100)).toBe('#000000');
  expect(parseHex('not-a-color')).toEqual([136, 136, 136]);
  expect(parseHex('#C2543F')).toEqual([194, 84, 63]);
});
