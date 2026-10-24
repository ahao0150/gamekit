/**
 * 缓动曲线与关键帧时间线（纯函数，无状态）。
 *
 * 为什么单独一个文件：曲线求值是**纯数学**（Bernstein 基 + Newton 反解），
 * 与「补间怎么推进」完全无关。混在一起会让两个都超 300 行。
 *
 * 曲线口径 = CSS `cubic-bezier(x1,y1,x2,y2)`：
 * - x(t) = 3(1-t)²t·x1 + 3(1-t)t²·x2 + t³
 * - y(t) = 3(1-t)²t·y1 + 3(1-t)t²·y2 + t³
 * 给定**进度** p 要先解 x(t)=p（Newton 迭代），再取 y(t)。
 *
 * 团队规范 docs/motion.md §4 的四条曲线与自检值：
 * - standard y(0.5) = 0.775561311116
 * - back 中点 y(0.5) = 1.087400670219
 * - back **全局峰值 y = 123201/112225 = 1.0978035197148585**，
 *   出现在**参数 t = 39/67**（对应进度 x = 4306887/7519075 = 0.5727947919125690）；
 *   峰值位置的判别式 784/625（写成 7056/625 是同一个数的 9 倍形式）。
 */

import type { BezierCurve, EasingName, EasingSample, Keyframe, Timeline } from './contract';

/** 团队规范 §4 的四条曲线（cubic-bezier 精确值，一个数字都不许自创）。 */
export const CURVES: Readonly<Record<EasingName, BezierCurve>> = {
  in: { x1: 0.4, y1: 0, x2: 1, y2: 1 },
  standard: { x1: 0.4, y1: 0, x2: 0.2, y2: 1 },
  out: { x1: 0, y1: 0, x2: 0.2, y2: 1 },
  back: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 },
};

/** Bernstein 基：3(1-t)²t·p1 + 3(1-t)t²·p2 + t³（首尾控制点固定 0 与 1）。 */
const bernstein = (t: number, p1: number, p2: number): number => {
  const mt = 1 - t;
  return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
};

/** x(t) 的导数：3(1-t)²x1 + 6(1-t)t(x2-x1) + 3t²(1-x2)。 */
const dx = (t: number, x1: number, x2: number): number => {
  const mt = 1 - t;
  return 3 * mt * mt * x1 + 6 * mt * t * (x2 - x1) + 3 * t * t * (1 - x2);
};

/**
 * 解 x(t) = p（Newton 迭代）。
 *
 * 为什么用 Newton 而不是二分：8 次迭代就到 float64 精度（残差 ~1e-16），
 * 二分要 50 次。x1/x2 都在 [0,1] 时 x(t) 单调，Newton 收敛良好。
 */
const solveT = (curve: BezierCurve, p: number): number => {
  let t = p;
  for (let i = 0; i < 8; i += 1) {
    const x = bernstein(t, curve.x1, curve.x2);
    const d = dx(t, curve.x1, curve.x2);
    if (Math.abs(d) < 1e-9) break;
    const next = t - (x - p) / d;
    if (next < 0) return 0;
    if (next > 1) return 1;
    if (Math.abs(next - t) < 1e-12) return next;
    t = next;
  }
  return Math.min(1, Math.max(0, t));
};

/** 按参数 t 求 y(t)。 */
export const easingAtParam = (name: EasingName, t: number): number => {
  const c = CURVES[name];
  return bernstein(t, c.y1, c.y2);
};

/** 参数 t 对应的进度 x(t)。 */
export const easingProgressAt = (name: EasingName, t: number): number => {
  const c = CURVES[name];
  return bernstein(t, c.x1, c.x2);
};

/** 按进度求值：解 x(t)=p，返回 y(t)。p<0 → 0，p>1 → 1。 */
export const easingAt = (name: EasingName, progress: number): number => {
  if (!Number.isFinite(progress)) return 0;
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return easingAtParam(name, solveT(CURVES[name], progress));
};

/** 造一条带两种求值口径的曲线描述。 */
export const createEasing = (name: EasingName): EasingSample => ({
  name,
  curve: CURVES[name],
  at: (progress: number): number => easingAt(name, progress),
  atParam: (t: number): number => easingAtParam(name, t),
  progressAt: (t: number): number => easingProgressAt(name, t),
});

/**
 * 采样关键帧时间线。
 *
 * 每段用**起点关键帧上的缓动**（Keyframe.easing 描述「本帧 → 下一帧」这一段），
 * 这样 squash & stretch 能做到出段 ease-out / 回段 standard（M-03）：
 * 0→110ms 用 out，110→220ms 用 standard。
 */
export const sampleTimeline = (timeline: Timeline, elapsedMs: number): number => {
  const frames = timeline.keyframes;
  if (frames.length === 0) return 0;
  const first = frames[0]!;
  if (elapsedMs <= first.at) return first.value;
  const last = frames[frames.length - 1]!;
  if (elapsedMs >= last.at) return last.value;
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1]!;
    const b = frames[i]!;
    if (elapsedMs <= b.at) {
      const span = b.at - a.at;
      const p = span <= 0 ? 1 : (elapsedMs - a.at) / span;
      return a.value + (b.value - a.value) * easingAt(a.easing, p);
    }
  }
  return last.value;
};

/** 造一条时间线（顺带把关键帧按时间排好，调用方不必自己排）。 */
export const createTimeline = (duration: number, keyframes: readonly Keyframe[]): Timeline => ({
  duration,
  keyframes: [...keyframes].sort((a, b) => a.at - b.at),
});
