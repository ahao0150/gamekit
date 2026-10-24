/**
 * 帧耗时统计（T26）。
 *
 * 为什么不用平均数：一帧 GC 停顿、一次系统调度、一次后台任务抢占，都会把平均数
 * 拉高；而玩家感知到的是「大多数帧卡不卡」+「最烂的那 5% 卡多狠」。所以报
 * **中位数**（典型帧）和 **p95**（卡顿帧），两个都不受长尾单个异常值主导。
 *
 * p95 用最近秩法（nearest-rank）：`sorted[ceil(0.95 × n) - 1]`。
 * 这是监控系统的通行口径，可直接和「16.7ms 一帧」对比，不需要插值假设分布。
 */

/** 一组帧耗时的分布摘要（单位由调用方决定，bench 里是毫秒）。 */
export interface FrameSummary {
  readonly count: number;
  readonly min: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
}

/** 只保留有限数值：NaN / Infinity 来自计时器异常，混进分位数会污染结果。 */
const finiteOnly = (values: readonly number[]): number[] =>
  values.filter((value) => Number.isFinite(value));

/** 最近秩分位数：p 钳到 [0,1]，空数组返回 0。 */
export const percentile = (values: readonly number[], p: number): number => {
  const clean = finiteOnly(values);
  if (clean.length === 0) return 0;
  const sorted = [...clean].sort((a, b) => a - b);
  const clamped = Math.min(Math.max(Number.isFinite(p) ? p : 0, 0), 1);
  const rank = Math.ceil(clamped * sorted.length) - 1;
  const index = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[index] ?? 0;
};

/** 中位数：偶数个取中间两个的平均（与最近秩法不同，这是独立定义）。 */
export const median = (values: readonly number[]): number => {
  const clean = finiteOnly(values);
  if (clean.length === 0) return 0;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  const lower = sorted[mid - 1] ?? 0;
  const upper = sorted[mid] ?? 0;
  return (lower + upper) / 2;
};

/** 一次汇总：中位数 + p95 + 边界值。空输入返回全 0（不返回 NaN）。 */
export const summarize = (values: readonly number[]): FrameSummary => {
  const clean = finiteOnly(values);
  if (clean.length === 0) {
    return { count: 0, min: 0, median: 0, p95: 0, max: 0 };
  }
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianValue =
    sorted.length % 2 === 1
      ? (sorted[mid] ?? 0)
      : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return {
    count: clean.length,
    min: sorted[0] ?? 0,
    median: medianValue,
    p95: percentile(clean, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
  };
};

/** 保留 2 位小数用于报告显示；内部计算不碰这个函数。 */
export const fixed2 = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(2) : '—';
