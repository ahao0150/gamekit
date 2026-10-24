/**
 * 每帧耗时埋点（T45）：布局 / 绘制 / 帧间隔的滑动平均与峰值，只读给 `__mg`。
 *
 * 为什么单独一个文件：`game.ts` 已经接近 300 行铁律；而且计时是「观测」，
 * 不该和玩法/渲染逻辑缠在一起。
 *
 * 时间源：优先 `performance.now()`（web/部分小游戏都有）；没有就退 `Date.now()`。
 * 这里做的是 `typeof` 兜底，不是平台分支 —— 计时不影响任何玩法判定，
 * 精度差一点不影响结论（结论看的是「有没有明显变慢」，不是纳秒级对比）。
 */

export interface FrameTiming {
  /** 每帧 UI 布局耗时（bind + layout + 动态 props 注入）的滑动平均，ms */
  readonly layoutMs: number;
  /** 每帧绘制耗时（世界 + HUD + 浮层）的滑动平均，ms */
  readonly drawMs: number;
  /** 相邻两次 render 的间隔（≈ rAF 帧间隔）滑动平均，ms */
  readonly frameMs: number;
  /** 累计帧数（读快照时用来判断平均值是否已经收敛） */
  readonly frames: number;
  /** 本次运行内 layout / draw 的最大值，ms（看尖峰） */
  readonly layoutMaxMs: number;
  readonly drawMaxMs: number;
}

export interface FrameTimingTracker {
  /** 当前时间（ms） */
  now(): number;
  /** 一帧开始：更新帧间隔滑动平均 */
  startFrame(): void;
  /** 用区间 [from, to] 记一次布局耗时 */
  markLayout(from: number, to: number): void;
  /** 用区间 [from, to] 记一次绘制耗时 */
  markDraw(from: number, to: number): void;
  snapshot(): FrameTiming;
}

/** 滑动平均的保留系数：0.9 ≈ 最近十几帧的权重占一半以上，又不会被单帧尖峰带跑。 */
const SMOOTH = 0.1;

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

const smooth = (prev: number, value: number): number => (prev === 0 ? value : prev * (1 - SMOOTH) + value * SMOOTH);

export const createFrameTiming = (): FrameTimingTracker => {
  let layoutMs = 0;
  let drawMs = 0;
  let frameMs = 0;
  let layoutMaxMs = 0;
  let drawMaxMs = 0;
  let frames = 0;
  let lastFrameAt = 0;

  return {
    now: nowMs,
    startFrame(): void {
      const at = nowMs();
      // 第一帧没有「上一帧」，不记间隔（否则首帧把平均值拉得没法看）
      if (lastFrameAt !== 0) frameMs = smooth(frameMs, at - lastFrameAt);
      lastFrameAt = at;
      frames += 1;
    },
    markLayout(from: number, to: number): void {
      const cost = Math.max(0, to - from);
      layoutMs = smooth(layoutMs, cost);
      if (cost > layoutMaxMs) layoutMaxMs = cost;
    },
    markDraw(from: number, to: number): void {
      const cost = Math.max(0, to - from);
      drawMs = smooth(drawMs, cost);
      if (cost > drawMaxMs) drawMaxMs = cost;
    },
    snapshot(): FrameTiming {
      return { layoutMs, drawMs, frameMs, frames, layoutMaxMs, drawMaxMs };
    },
  };
};
