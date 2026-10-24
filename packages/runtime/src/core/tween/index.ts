/**
 * 补间实现。
 *
 * 结构：全部状态在闭包里（无全局可变状态，AGENTS 铁律 3）。
 *
 * 三个要点：
 * 1. **同 key 替换，不排队**（规范 §0）：`set()` 直接覆盖同名补间；
 *    打断时从**当前值**出发继续（`redirect`），视觉上不跳。
 * 2. **previous 保留上一推进步的值**：渲染时用主循环的 alpha 在
 *    previous 与 value 之间插值 —— 固定 60Hz 步长在 120Hz 屏上会一格一格跳，
 *    这就是 core/loop 那个 alpha 一直没人消费的原因（见 `TweenRunner.sample`）。
 * 3. **单位分工**：补间用毫秒；弹簧用秒（物理量纲）。
 *
 * 档位：runner.order = ORDER.animation（300），框架侧挂 System 时用它插队。
 */

import { ORDER } from '../extension';
import type { System } from '../extension';
import { easingAt } from './easing';
import type { EasingName, Tween, TweenOptions, TweenRunner } from './contract';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 造一个补间。所有状态在闭包里。 */
export const createTween = (key: string, opts: TweenOptions): Tween => {
  let from = opts.from;
  let to = opts.to;
  let duration = opts.duration;
  let delay = opts.delay ?? 0;
  let easing: EasingName = opts.easing ?? 'standard';
  let loop = opts.loop ?? false;
  let elapsed = 0;
  let value = from;
  let previous = from;

  /** 当前进度 0..1（含 delay 段与循环取模）。 */
  const progress = (): number => {
    if (duration <= 0) return 1;
    const e = elapsed - delay;
    if (e <= 0) return 0;
    if (loop) return (e % duration) / duration;
    return clamp01(e / duration);
  };

  const compute = (): number => {
    const p = progress();
    if (p <= 0) return from;
    if (p >= 1 && !loop) return to;
    return from + (to - from) * easingAt(easing, p);
  };

  const tween: Tween = {
    key,
    get from(): number {
      return from;
    },
    get to(): number {
      return to;
    },
    get duration(): number {
      return duration;
    },
    get delay(): number {
      return delay;
    },
    get easing(): EasingName {
      return easing;
    },
    get loop(): boolean {
      return loop;
    },
    get elapsed(): number {
      return elapsed;
    },
    get value(): number {
      return value;
    },
    get previous(): number {
      return previous;
    },
    get done(): boolean {
      return !loop && elapsed >= delay + duration;
    },
    advance(dtMs: number): void {
      if (!Number.isFinite(dtMs) || dtMs <= 0) return;
      previous = value;
      elapsed += dtMs;
      value = compute();
    },
    redirect(next: number, durationMs: number, nextEasing?: EasingName): void {
      // 从当前值出发：视觉连续，不跳
      from = value;
      to = next;
      duration = durationMs;
      delay = 0;
      elapsed = 0;
      if (nextEasing !== undefined) easing = nextEasing;
      previous = value;
    },
  };
  return tween;
};

/**
 * 补间容器：按 key 管理。
 *
 * 为什么按 key 而不是数组：规范 §0 要求「重复触发时替换当前动效，不排队」，
 * key 就是「哪个元素的哪个通道」。
 */
export const createTweenRunner = (): TweenRunner => {
  const tweens = new Map<string, Tween>();
  return {
    set(key: string, opts: TweenOptions): Tween {
      const tween = createTween(key, opts);
      tweens.set(key, tween);
      return tween;
    },
    get(key: string): Tween | null {
      return tweens.get(key) ?? null;
    },
    value(key: string): number | null {
      const tween = tweens.get(key);
      return tween ? tween.value : null;
    },
    sample(key: string, alpha: number): number | null {
      const tween = tweens.get(key);
      if (!tween) return null;
      const a = clamp01(alpha);
      return tween.previous + (tween.value - tween.previous) * a;
    },
    remove(key: string): void {
      tweens.delete(key);
    },
    clear(): void {
      tweens.clear();
    },
    advance(dtMs: number): void {
      // 完成的补间**不删**：终值要能读到（元素不能因为动画结束就跳回默认值）。
      for (const tween of tweens.values()) tween.advance(dtMs);
    },
    get activeCount(): number {
      let n = 0;
      for (const tween of tweens.values()) if (!tween.done) n += 1;
      return n;
    },
    order: ORDER.animation,
  };
};

/**
 * 框架侧接入点：把 runner 挂成 System，档位用 ORDER.animation（300）。
 *
 * 这个档位之前是空的（core/extension.ts 建了但没人用）：动效更新排在
 * gameplay(200) 之后、ui(400) 之前 —— 逻辑先算完，画面再读。
 *
 * 注意 dt 单位：System.update 的 dt 是**秒**，runner 用毫秒，这里换算。
 */
export const createTweenSystem = (runner: TweenRunner): System => ({
  name: 'tween',
  order: ORDER.animation,
  update(dtSeconds: number): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    runner.advance(dtSeconds * 1000);
  },
});

export { MOTION } from './contract';
export type {
  BezierCurve,
  EasingName,
  EasingSample,
  Keyframe,
  Spring,
  SpringConfig,
  Timeline,
  Tween,
  TweenOptions,
  TweenRunner,
} from './contract';
export { CURVES, createEasing, createTimeline, easingAt, easingAtParam, easingProgressAt, sampleTimeline } from './easing';
export { createSpring, sampleSpring } from './spring';
