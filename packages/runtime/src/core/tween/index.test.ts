import { describe, expect, it } from 'vitest';
import { ORDER } from '../extension';
import {
  CURVES,
  MOTION,
  createEasing,
  createSpring,
  createTimeline,
  createTweenRunner,
  createTweenSystem,
  easingAt,
  easingAtParam,
  easingProgressAt,
  sampleSpring,
  sampleTimeline,
} from './index';

/** 团队规范 §4.1：back-out 的全局峰值出现在参数 t = 39/67。 */
const PEAK_T = 39 / 67;
/** 该峰值处的 y 值（精确分数，123201/112225 = 1.0978035197148585…）。 */
const PEAK_Y = 123201 / 112225;
/** 该参数 t 对应的进度 x（精确分数）。 */
const PEAK_PROGRESS = 4306887 / 7519075;

describe('缓动曲线（docs/motion.md §4）', () => {
  it('standard 的中点 y(0.5) = 0.775561', () => {
    expect(easingAt('standard', 0.5)).toBeCloseTo(0.775561, 6);
    expect(easingAt('standard', 0.5)).toBeCloseTo(0.775561311116, 9);
  });

  it('in / out 的中点值分别是 0.324815 / 0.839245', () => {
    expect(easingAt('in', 0.5)).toBeCloseTo(0.324815, 6);
    expect(easingAt('out', 0.5)).toBeCloseTo(0.839245, 6);
  });

  it('back 的中点 y(0.5) = 1.087401（有过冲）', () => {
    expect(easingAt('back', 0.5)).toBeCloseTo(1.087401, 6);
    expect(easingAt('back', 0.5)).toBeCloseTo(1.087400670219, 9);
  });

  it('back 的全局峰值 = 1.097804，出现在参数 t = 39/67', () => {
    expect(easingAtParam('back', PEAK_T)).toBeCloseTo(PEAK_Y, 12);
    expect(easingAtParam('back', PEAK_T)).toBeCloseTo(1.097804, 6);
    expect(easingProgressAt('back', PEAK_T)).toBeCloseTo(PEAK_PROGRESS, 12);
  });

  it('back 的参数 t = 39/67 处确实是全局最大值（扫参数空间验证）', () => {
    let bestT = 0;
    let bestY = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.0005) {
      const y = easingAtParam('back', t);
      if (y > bestY) {
        bestY = y;
        bestT = t;
      }
    }
    expect(Math.abs(bestT - PEAK_T)).toBeLessThan(0.001);
    expect(bestY).toBeCloseTo(PEAK_Y, 6);
  });

  it('端点精确：每条曲线在 0 / 1 处分别是 0 / 1', () => {
    for (const name of ['in', 'standard', 'out', 'back'] as const) {
      expect(easingAt(name, 0)).toBe(0);
      expect(easingAt(name, 1)).toBe(1);
      expect(easingAt(name, -0.5)).toBe(0);
      expect(easingAt(name, 1.5)).toBe(1);
    }
  });

  it('曲线表与规范 §9 一致（一个数字都不许自创）', () => {
    expect(CURVES.standard).toEqual({ x1: 0.4, y1: 0, x2: 0.2, y2: 1 });
    expect(CURVES.out).toEqual({ x1: 0, y1: 0, x2: 0.2, y2: 1 });
    expect(CURVES.in).toEqual({ x1: 0.4, y1: 0, x2: 1, y2: 1 });
    expect(CURVES.back).toEqual({ x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 });
    expect(MOTION.ms).toEqual({ instant: 60, micro: 120, state: 240, emphasis: 480 });
    // MOTION.squash 已删（2026-10-20 定稿）：那是「包裹落位」的业务表现参数，
    // 不属 runtime 原语；唯一真源在 games/kuaidi-load/src/app/motion/timelines.ts 的 LANDING。
    expect(MOTION.spring.tap).toEqual({ stiffness: 1400, damping: 52, mass: 1 });
    expect(MOTION.spring.settle).toEqual({ stiffness: 900, damping: 39, mass: 1 });
    expect(MOTION.stagger).toEqual({ step: 60, max: 4 });
    expect(MOTION.shake).toEqual({ amplitude: 4, frequency: 20, duration: 180 });
  });

  it('createEasing 暴露两种求值口径且与模块级函数一致', () => {
    const e = createEasing('back');
    expect(e.at(0.5)).toBe(easingAt('back', 0.5));
    expect(e.atParam(PEAK_T)).toBe(easingAtParam('back', PEAK_T));
    expect(e.atParam(PEAK_T)).toBeCloseTo(PEAK_Y, 12);
    expect(e.progressAt(PEAK_T)).toBeCloseTo(PEAK_PROGRESS, 12);
    expect(e.name).toBe('back');
  });
});

describe('弹簧（docs/motion.md §5）', () => {
  it('轻点回弹：ω₀ = 10√14，ζ = 0.694879，过冲 4.80%，稳定 115.22ms', () => {
    const tap = createSpring(MOTION.spring.tap);
    expect(tap.omega0).toBeCloseTo(10 * Math.sqrt(14), 12);
    expect(tap.omega0).toBeCloseTo(37.41657386773941, 10);
    expect(tap.zeta).toBeCloseTo((13 * Math.sqrt(14)) / 70, 12);
    expect(tap.zeta).toBeCloseTo(0.6948792289723034, 12);
    expect(tap.overshoot).toBeCloseTo(0.04804267223552392, 12);
    expect(tap.overshoot * 100).toBeCloseTo(4.804267223552392, 9);
    expect(tap.settleSeconds).toBeCloseTo(0.11522047205976888, 12);
    expect(tap.underdamped).toBe(true);
  });

  it('落位/归位：ω₀ = 30，ζ = 0.65，过冲 6.81%，稳定 153.63ms', () => {
    const settle = createSpring(MOTION.spring.settle);
    expect(settle.omega0).toBe(30);
    expect(settle.zeta).toBeCloseTo(0.65, 12);
    expect(settle.overshoot).toBeCloseTo(0.06807664510187792, 12);
    expect(settle.overshoot * 100).toBeCloseTo(6.807664510187792, 9);
    expect(settle.settleSeconds).toBeCloseTo(0.15362729607969185, 12);
  });

  it('采样：t=0 为 0，峰值 1+过冲，稳定后回到 1', () => {
    const settle = createSpring(MOTION.spring.settle);
    const wd = settle.omega0 * Math.sqrt(1 - settle.zeta * settle.zeta);
    const peakAt = Math.PI / wd;
    expect(sampleSpring(settle, 0)).toBe(0);
    expect(sampleSpring(settle, peakAt)).toBeCloseTo(1 + settle.overshoot, 6);
    expect(sampleSpring(settle, peakAt)).toBeCloseTo(1.068077, 5);
    // 220ms 后（规范 M-17 的验收点：稳定 1.000 ±0.01）已回到 1 附近
    expect(Math.abs(sampleSpring(settle, 0.22) - 1)).toBeLessThan(0.01);
  });
});

describe('关键帧时间线', () => {
  // 用局部常量测时间线本身。原来引用 MOTION.squash，已随该常量一起删
  // （业务预置不进 runtime，见 contract.ts 变更记录）。
  const squash = createTimeline(220, [
    { at: 0, value: 1, easing: 'out' },
    { at: 110, value: 1.098, easing: 'standard' },
    { at: 220, value: 1, easing: 'standard' },
  ]);

  it('三个关键帧处取值精确（1.000 / 1.098 / 1.000）', () => {
    expect(sampleTimeline(squash, 0)).toBeCloseTo(1, 12);
    expect(sampleTimeline(squash, 110)).toBeCloseTo(1.098, 12);
    expect(sampleTimeline(squash, 220)).toBeCloseTo(1, 12);
  });

  it('段内按该段的缓动插值（出段 ease-out）', () => {
    // 0→110 段用 out：中点 y(0.5)=0.839245
    expect(sampleTimeline(squash, 55)).toBeCloseTo(1 + 0.098 * 0.839245, 6);
  });

  it('时间线之外取端点值', () => {
    expect(sampleTimeline(squash, -10)).toBeCloseTo(1, 12);
    expect(sampleTimeline(squash, 9999)).toBeCloseTo(1, 12);
  });
});

describe('补间与容器', () => {
  it('按 dt 推进并到达终点', () => {
    const runner = createTweenRunner();
    runner.set('a', { from: 0, to: 10, duration: 100, easing: 'standard' });
    expect(runner.value('a')).toBe(0);
    runner.advance(50);
    expect(runner.value('a')).toBeCloseTo(0 + 10 * 0.775561, 5);
    runner.advance(50);
    expect(runner.value('a')).toBeCloseTo(10, 12);
    expect(runner.activeCount).toBe(0); // 走完就不再活跃（但终值仍可读）
  });

  it('delay 期间停在 from', () => {
    const runner = createTweenRunner();
    runner.set('a', { from: 3, to: 9, duration: 100, delay: 50 });
    runner.advance(30);
    expect(runner.value('a')).toBe(3);
    runner.advance(30);
    expect(runner.value('a')).toBeGreaterThan(3);
  });

  it('同 key 替换而不是排队（规范 §0）', () => {
    const runner = createTweenRunner();
    runner.set('a', { from: 0, to: 10, duration: 100 });
    runner.set('a', { from: 0, to: 20, duration: 100 });
    expect(runner.activeCount).toBe(1);
    runner.advance(100);
    expect(runner.value('a')).toBeCloseTo(20, 12);
  });

  it('redirect 从当前值出发，视觉不跳', () => {
    const runner = createTweenRunner();
    runner.set('a', { from: 0, to: 10, duration: 100, easing: 'standard' });
    runner.advance(50);
    const mid = runner.value('a')!;
    expect(mid).toBeGreaterThan(0);
    runner.get('a')!.redirect(0, 100);
    expect(runner.value('a')).toBeCloseTo(mid, 12);
    runner.advance(100);
    expect(runner.value('a')).toBeCloseTo(0, 12);
  });

  it('sample 用 alpha 在上一值与当前值之间插值（消费主循环的插值系数）', () => {
    const runner = createTweenRunner();
    runner.set('a', { from: 0, to: 100, duration: 100, easing: 'standard' });
    runner.advance(100);
    const now = runner.value('a')!;
    // previous 是上一步的值（0），alpha=0.5 → 中点
    expect(runner.sample('a', 0.5)).toBeCloseTo(now / 2, 6);
    expect(runner.sample('a', 0)).toBeCloseTo(0, 12);
    expect(runner.sample('a', 1)).toBeCloseTo(now, 12);
    expect(runner.sample('missing', 0.5)).toBeNull();
  });

  it('loop 的补间永不到达终点', () => {
    const runner = createTweenRunner();
    runner.set('a', { from: 0, to: 1, duration: 100, loop: true });
    runner.advance(250);
    expect(runner.get('a')?.done).toBe(false);
    expect(runner.activeCount).toBe(1);
  });
});

describe('框架接入', () => {
  it('runner 的档位是 ORDER.animation（300）', () => {
    expect(createTweenRunner().order).toBe(ORDER.animation);
    expect(ORDER.animation).toBe(300);
  });

  it('createTweenSystem 把 runner 挂成 System，update 的 dt 是秒', () => {
    const runner = createTweenRunner();
    const system = createTweenSystem(runner);
    expect(system.order).toBe(ORDER.animation);
    expect(system.name).toBe('tween');
    runner.set('a', { from: 0, to: 10, duration: 100, easing: 'standard' });
    system.update?.(0.05); // 50ms
    expect(runner.value('a')).toBeCloseTo(10 * 0.775561, 5);
  });
});
