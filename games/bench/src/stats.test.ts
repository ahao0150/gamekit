/**
 * stats.ts 的单测（T26）。
 *
 * 分位数是本轮所有结论的基础，算错了三张表全错——所以口径必须钉死：
 * 最近秩法、空输入不返回 NaN、不修改入参。
 */
import { describe, expect, it } from 'vitest';
import { fixed2, median, percentile, summarize } from './stats';

describe('percentile（最近秩法）', () => {
  it('10 个数取 p95 命中最大值', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 0.95)).toBe(10);
  });

  it('20 个数取 p95 是第 19 个（不是最大）', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(values, 0.95)).toBe(19);
  });

  it('p=0 是 min、p=1 是 max', () => {
    const values = [5, 1, 9, 3];
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 1)).toBe(9);
  });

  it('p 越界钳制到 [0,1]', () => {
    const values = [1, 2, 3];
    expect(percentile(values, -1)).toBe(1);
    expect(percentile(values, 2)).toBe(3);
  });

  it('空数组返回 0，不是 NaN', () => {
    expect(percentile([], 0.95)).toBe(0);
  });

  it('不计入 NaN / Infinity', () => {
    const values = [1, Number.NaN, 3, Number.POSITIVE_INFINITY, 2];
    expect(percentile(values, 0.95)).toBe(3);
  });
});

describe('median', () => {
  it('奇数个取正中', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('偶数个取中间两个的平均', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('空数组返回 0', () => {
    expect(median([])).toBe(0);
  });
});

describe('summarize', () => {
  it('空输入返回 count=0 且全 0', () => {
    expect(summarize([])).toEqual({ count: 0, min: 0, median: 0, p95: 0, max: 0 });
  });

  it('单元素：min/median/p95/max 全相等', () => {
    expect(summarize([7])).toEqual({ count: 1, min: 7, median: 7, p95: 7, max: 7 });
  });

  it('不修改入参数组（排序走副本）', () => {
    const values = [3, 1, 2];
    summarize(values);
    expect(values).toEqual([3, 1, 2]);
  });

  it('典型分布：p95 > median', () => {
    // 10 个元素：ceil(0.95×10)-1 = 9 → 取最大值 20；20 个元素才会落在第 19 个
    const ten = summarize([1, 1, 1, 1, 1, 1, 1, 1, 1, 20]);
    expect(ten.median).toBe(1);
    expect(ten.p95).toBe(20);
    expect(ten.max).toBe(20);

    const twenty = summarize([...Array.from({ length: 19 }, () => 1), 20]);
    expect(twenty.p95).toBe(1);
    expect(twenty.max).toBe(20);
  });
});

describe('fixed2', () => {
  it('两位小数；非有限值给占位符', () => {
    expect(fixed2(1.2345)).toBe('1.23');
    expect(fixed2(Number.NaN)).toBe('—');
  });
});
