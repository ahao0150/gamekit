/**
 * 全屏级特效测试（T23）：flash / shake / vignette / scanline。
 *
 * shake 的重点是 **save/restore 严格配对**（它不自己 restore，交给返回的函数）；
 * scanline 的重点是**条纹数量 ≈ viewport.h / (gap + thickness)** 与每条 alpha。
 */

import { describe, expect, it } from 'vitest';
import { drawFlash } from './flash';
import { beginShake } from './shake';
import { drawScanline } from './scanline';
import { drawVignette } from './vignette';
import { VIEWPORT, fxSpy } from './test-helpers';

describe('drawFlash', () => {
  it('全屏 fillRect = viewport，颜色默认白、alpha 透传', () => {
    const spy = fxSpy();
    drawFlash(spy.ctx, VIEWPORT, { alpha: 0.35 });
    expect(spy.fills).toEqual([[0, 0, 390, 844]]);
    expect(spy.fillStyles).toEqual(['#ffffff']);
    expect(spy.alphas).toEqual([0.35]);
    expect(spy.saves).toBe(1);
    expect(spy.restores).toBe(1);
  });

  it('颜色可覆盖；alpha 钳到 0..1', () => {
    const custom = fxSpy();
    drawFlash(custom.ctx, VIEWPORT, { alpha: 2, color: '#ff0000' });
    expect(custom.fills).toHaveLength(1);
    expect(custom.fillStyles).toEqual(['#ff0000']);
    expect(custom.alphas).toEqual([1]);
  });

  it('alpha<=0 / 坏视口：一笔都不画', () => {
    const zero = fxSpy();
    drawFlash(zero.ctx, VIEWPORT, { alpha: 0 });
    expect(zero.fills).toHaveLength(0);
    expect(zero.saves).toBe(0);
    const bad = fxSpy();
    drawFlash(bad.ctx, { width: 0, height: 844 }, { alpha: 1 });
    expect(bad.fills).toHaveLength(0);
  });
});

describe('beginShake', () => {
  it('正常：save + translate 非零，返回函数调用后 restore 一次（严格配对）', () => {
    const spy = fxSpy();
    const restorer = beginShake(spy.ctx, VIEWPORT, { amplitude: 10, seed: 7 });
    expect(spy.saves).toBe(1);
    expect(spy.translates).toHaveLength(1);
    const [dx, dy] = spy.translates[0] ?? [0, 0];
    expect(Math.abs(dx ?? 0)).toBeGreaterThan(0);
    expect(Math.abs(dy ?? 0)).toBeLessThanOrEqual(10);
    expect(spy.restores).toBe(0); // 它不自己 restore
    restorer();
    expect(spy.restores).toBe(1);
    expect(spy.restores).toBe(spy.saves); // 配对
  });

  it('amplitude=0 且 rotation=0：不 save，返回空函数（调用也不多 restore）', () => {
    const spy = fxSpy();
    const restorer = beginShake(spy.ctx, VIEWPORT, { amplitude: 0 });
    expect(spy.saves).toBe(0);
    expect(spy.translates).toHaveLength(0);
    restorer();
    expect(spy.restores).toBe(0);
  });

  it('同一 seed 抖动一致、不同 seed 不同（确定性，不碰 Math.random）', () => {
    const first = fxSpy();
    beginShake(first.ctx, VIEWPORT, { amplitude: 8, seed: 3 })();
    const again = fxSpy();
    beginShake(again.ctx, VIEWPORT, { amplitude: 8, seed: 3 })();
    const other = fxSpy();
    beginShake(other.ctx, VIEWPORT, { amplitude: 8, seed: 4 })();
    expect(again.translates).toEqual(first.translates);
    expect(other.translates).not.toEqual(first.translates);
  });

  it('rotation 生效且钳到 ±3°；振幅钳到视口短边 10%（39px）', () => {
    const rotated = fxSpy();
    beginShake(rotated.ctx, VIEWPORT, { amplitude: 0, rotation: 90 })();
    expect(rotated.rotates).toHaveLength(1);
    expect(Math.abs(rotated.rotates[0] ?? 0)).toBeLessThanOrEqual((3 * Math.PI) / 180 + 1e-9);

    const huge = fxSpy();
    beginShake(huge.ctx, VIEWPORT, { amplitude: 10000, seed: 1 })();
    for (const value of huge.translates[0] ?? []) expect(Math.abs(value)).toBeLessThanOrEqual(39 + 1e-9);
  });
});

describe('drawVignette', () => {
  it('一次全屏径向渐变：中心透明、四角 alpha=strength', () => {
    const spy = fxSpy();
    drawVignette(spy.ctx, VIEWPORT, { strength: 0.6 });
    expect(spy.gradients).toHaveLength(1);
    // 中心 (195, 422)、内圈 = min(195,422)*0.45 = 87.75、外圈 = hypot(195,422) ≈ 464.86
    expect(spy.gradients[0]?.args[0]).toBe(195);
    expect(spy.gradients[0]?.args[1]).toBe(422);
    expect(spy.gradients[0]?.args[2]).toBeCloseTo(87.75, 2);
    expect(spy.gradients[0]?.args[5]).toBeCloseTo(464.86, 1);
    expect(spy.gradients[0]?.stops[0]?.color).toBe('rgba(0, 0, 0, 0)');
    expect(spy.gradients[0]?.stops[1]?.color).toBe('rgba(0, 0, 0, 0.6)');
    expect(spy.fills).toEqual([[0, 0, 390, 844]]);
  });

  it('strength=0 / 坏视口：不画', () => {
    const zero = fxSpy();
    drawVignette(zero.ctx, VIEWPORT, { strength: 0 });
    expect(zero.gradients).toHaveLength(0);
    expect(zero.fills).toHaveLength(0);
  });

  it('strength 钳到 1；颜色可覆盖', () => {
    const spy = fxSpy();
    drawVignette(spy.ctx, VIEWPORT, { strength: 5, color: '#112233' });
    expect(spy.gradients[0]?.stops[1]?.color).toBe('rgba(17, 34, 51, 1)');
  });
});

describe('drawScanline', () => {
  it('条纹数 ≈ h / (gap + thickness)：844 / 6 → 141 条，首条 y=0、步长 6', () => {
    const spy = fxSpy();
    drawScanline(spy.ctx, VIEWPORT, { gap: 4, thickness: 2, alpha: 0.3 });
    expect(spy.fills).toHaveLength(141);
    expect(spy.fills[0]).toEqual([0, 0, 390, 2]);
    expect(spy.fills[1]).toEqual([0, 6, 390, 2]);
    expect(spy.fills[140]).toEqual([0, 840, 390, 2]);
    expect(spy.alphas).toEqual([0.3]);
    expect(spy.fillStyles.every((style) => style === '#000000')).toBe(true);
  });

  it('alpha<=0 / 坏视口 / 负 gap：不画', () => {
    for (const opts of [
      { gap: 4, thickness: 2, alpha: 0 },
      { gap: -4, thickness: 2, alpha: 1 },
    ]) {
      const spy = fxSpy();
      drawScanline(spy.ctx, VIEWPORT, opts);
      expect(spy.fills).toHaveLength(0);
    }
    const bad = fxSpy();
    drawScanline(bad.ctx, { width: 390, height: 0 }, { gap: 4, thickness: 2, alpha: 1 });
    expect(bad.fills).toHaveLength(0);
  });

  it('thickness 超过 gap 时钳到 gap（否则条纹连成一片）', () => {
    const spy = fxSpy();
    drawScanline(spy.ctx, { width: 100, height: 20 }, { gap: 3, thickness: 50, alpha: 1 });
    // 除最后一条被剩余高度裁短外，厚度都钳到 gap=3
    expect(spy.fills.slice(0, -1).every((fill) => fill[3] === 3)).toBe(true);
    expect(spy.fills).toHaveLength(Math.ceil(20 / 6)); // 步长 = gap + thickness(钳后) = 6
  });

  it('最后一条按剩余高度裁，不画出视口外', () => {
    const spy = fxSpy();
    drawScanline(spy.ctx, { width: 100, height: 7 }, { gap: 4, thickness: 2, alpha: 1 });
    expect(spy.fills).toHaveLength(2);
    expect(spy.fills[1]).toEqual([0, 6, 100, 1]); // 只剩 1px
  });
});
