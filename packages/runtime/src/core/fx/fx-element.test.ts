/**
 * 元素级特效测试（T23）：glow / dissolve / chromatic。
 *
 * 断言点都是「真实画了什么」——渐变层数、合成模式、内容回调次数、擦除块数量，
 * 不是只断言参数被读到了。
 */

import { describe, expect, it } from 'vitest';
import { drawWithChromatic } from './chromatic';
import { drawWithDissolve } from './dissolve';
import { drawWithGlow } from './glow';
import { fxSpy, makeRect } from './test-helpers';

const rect = makeRect(100, 100, 200, 120);

describe('drawWithGlow', () => {
  it('layers=3 → 3 层径向渐变 + lighter 混合，内容回调仍被调用，save/restore 配对', () => {
    const spy = fxSpy();
    let drew = 0;
    drawWithGlow(spy.ctx, rect, { color: '#ffcc00' }, () => void (drew += 1));
    expect(spy.gradients).toHaveLength(3);
    expect(spy.gradients.every((g) => g.kind === 'radial')).toBe(true);
    expect(spy.compositeOps).toContain('lighter');
    expect(spy.fills).toHaveLength(3); // 每层一次全框填充
    expect(drew).toBe(1);
    expect(spy.saves).toBe(1);
    expect(spy.restores).toBe(1);
  });

  it('渐变参数精确：中心 = 矩形中心、半径逐层递增、色标 0 亮 1 透明', () => {
    const spy = fxSpy();
    drawWithGlow(spy.ctx, rect, { color: '#ffcc00', intensity: 0.9, layers: 2 }, () => undefined);
    // 中心 (200, 160)，maxRadius = max(200,120)/2 = 100
    expect(spy.gradients[0]?.args).toEqual([200, 160, 0, 200, 160, 50]);
    expect(spy.gradients[1]?.args).toEqual([200, 160, 0, 200, 160, 100]);
    expect(spy.gradients[0]?.stops[0]?.color).toBe('rgba(255, 204, 0, 0.45)');
    expect(spy.gradients[0]?.stops[1]?.color).toBe('rgba(255, 204, 0, 0)');
  });

  it('intensity=0：不画光晕（0 次渐变），但内容照画', () => {
    const spy = fxSpy();
    let drew = 0;
    drawWithGlow(spy.ctx, rect, { color: '#ffcc00', intensity: 0 }, () => void (drew += 1));
    expect(spy.gradients).toHaveLength(0);
    expect(spy.fills).toHaveLength(0);
    expect(spy.saves).toBe(0);
    expect(drew).toBe(1);
  });

  it('blur 外扩画布；坏矩形/负 layers 不崩且不吞内容', () => {
    const withBlur = fxSpy();
    drawWithGlow(withBlur.ctx, rect, { color: '#fff', blur: 10, layers: 1 }, () => undefined);
    expect(withBlur.fills[0]).toEqual([90, 90, 220, 140]); // 外扩 blur
    for (const bad of [makeRect(0, 0, 0, 0), makeRect(0, 0, -5, 10)]) {
      const spy = fxSpy();
      let drew = 0;
      drawWithGlow(spy.ctx, bad, { color: '#fff' }, () => void (drew += 1));
      expect(spy.gradients).toHaveLength(0);
      expect(drew).toBe(1);
    }
    const negative = fxSpy();
    drawWithGlow(negative.ctx, rect, { color: '#fff', layers: -2 }, () => undefined);
    expect(negative.gradients).toHaveLength(0);
  });
});

describe('drawWithDissolve', () => {
  it('progress=0：完整画内容，不擦除', () => {
    const spy = fxSpy();
    let drew = 0;
    drawWithDissolve(spy.ctx, rect, { progress: 0, noise: { width: 32, height: 32 } }, () => void (drew += 1));
    expect(drew).toBe(1);
    expect(spy.compositeOps).toHaveLength(0);
    expect(spy.fills).toHaveLength(0);
  });

  it('progress=1：内容完全不画、一次 fillRect 都没有', () => {
    const spy = fxSpy();
    let drew = 0;
    drawWithDissolve(spy.ctx, rect, { progress: 1, noise: { width: 32, height: 32 } }, () => void (drew += 1));
    expect(drew).toBe(0);
    expect(spy.fills).toHaveLength(0);
    expect(spy.compositeOps).toHaveLength(0);
  });

  it('中间进度：走 destination-out 挖洞，且进度越大挖得越多', () => {
    const counts: number[] = [];
    for (const progress of [0.2, 0.5, 0.8]) {
      const spy = fxSpy();
      let drew = 0;
      drawWithDissolve(spy.ctx, rect, { progress, noise: { width: 32, height: 32 } }, () => void (drew += 1));
      expect(drew, `progress=${progress} 内容要画`).toBe(1);
      expect(spy.compositeOps).toContain('destination-out');
      expect(spy.saves).toBe(1);
      expect(spy.restores).toBe(1);
      counts.push(spy.fills.length);
    }
    expect(counts[0]).toBeLessThan(counts[1]!);
    expect(counts[1]).toBeLessThan(counts[2]!);
    // 网格 8×5（200/24、120/24 取整并下限 4）→ 最多 40 块
    expect(counts[2]).toBeLessThanOrEqual(40);
  });

  it('带 native 噪声图：用 createPattern 一次擦除（不走网格）', () => {
    const spy = fxSpy();
    let drew = 0;
    const noise = { width: 32, height: 32, native: { fake: 'noise' } };
    drawWithDissolve(spy.ctx, rect, { progress: 0.5, noise }, () => void (drew += 1));
    expect(drew).toBe(1);
    expect(spy.patterns).toHaveLength(1);
    expect(spy.patterns[0]?.repetition).toBe('repeat');
    expect(spy.fills).toHaveLength(1);
    expect(spy.compositeOps).toContain('destination-out');
    expect(spy.alphas).toContain(0.5);
  });

  it('edgeColor 画在擦除之前（strokeRect），且不吃掉内容回调', () => {
    const spy = fxSpy();
    let drew = 0;
    drawWithDissolve(spy.ctx, rect, { progress: 0.5, noise: { width: 32, height: 32 }, edgeColor: '#ff9900' }, () => void (drew += 1));
    expect(drew).toBe(1);
    expect(spy.strokes.length).toBeGreaterThan(0);
    expect(spy.strokes.length).toBeLessThanOrEqual(spy.fills.length); // 边缘只在被挖的格子上
  });
});

describe('drawWithChromatic', () => {
  it('内容画 3 次（右偏 → 左偏 → 原色），偏移量精确，lighter 叠加', () => {
    const spy = fxSpy();
    let drew = 0;
    drawWithChromatic(spy.ctx, rect, { offset: 3 }, () => void (drew += 1));
    expect(drew).toBe(3);
    expect(spy.translates).toEqual([
      [3, 0],
      [-3, 0],
    ]);
    expect(spy.compositeOps).toContain('lighter');
    expect(spy.alphas).toContain(0.3); // alpha 默认 0.6，两份各半
    expect(spy.saves).toBe(3); // 外层 1 + 两个偏移份 2
    expect(spy.restores).toBe(3); // 与 save 严格配对
  });

  it('offset=0：只画一次原色（不浪费两次绘制）', () => {
    const spy = fxSpy();
    let drew = 0;
    drawWithChromatic(spy.ctx, rect, { offset: 0 }, () => void (drew += 1));
    expect(drew).toBe(1);
    expect(spy.translates).toHaveLength(0);
    expect(spy.compositeOps).toHaveLength(0);
  });

  it('alpha=0 / 坏矩形：只画一次原色', () => {
    for (const [badRect, alpha] of [
      [rect, 0],
      [makeRect(0, 0, 0, 0), 1],
    ] as const) {
      const spy = fxSpy();
      let drew = 0;
      drawWithChromatic(spy.ctx, badRect, { offset: 4, alpha }, () => void (drew += 1));
      expect(drew).toBe(1);
      expect(spy.translates).toHaveLength(0);
    }
  });

  it('offset 为负 / NaN 时不崩（负值按绝对值以外的口径钳成 0）', () => {
    const spy = fxSpy();
    let drew = 0;
    drawWithChromatic(spy.ctx, rect, { offset: -1 }, () => void (drew += 1));
    expect(drew).toBe(1); // nonNegative 钳成 0 → 退化
    const nan = fxSpy();
    drawWithChromatic(nan.ctx, rect, { offset: Number.NaN }, () => void (drew += 1));
    expect(drew).toBe(2); // 1（负值那次）+ 1（NaN 这次）
    expect(nan.translates).toHaveLength(0);
  });
});
