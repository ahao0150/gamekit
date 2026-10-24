/**
 * `core/ui/wheel.ts` 的单测（T36）。
 *
 * 钉住四条语义：
 * 1. delta 正 → 滚动位变大（向下滚看后面），负 → 变小；
 * 2. 钳到 `[0, maxScroll]`，与拖动共用同一套口径（复用 `scrollClamp`）；
 * 3. `maxScroll <= 0`（内容比视口短）→ 恒 0，且不产 NaN；
 * 4. speed 乘子生效（滚轮一格在手机上偏快，游戏可以调小）。
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_WHEEL_SPEED, scrollByWheel, sumWheelDeltas } from './wheel';

const base = { offset: 0, contentSize: 1000, viewSize: 400, delta: 0 } as const;

describe('scrollByWheel', () => {
  it('deltaY 正 → 向下滚（offset 变大）', () => {
    expect(scrollByWheel({ ...base, delta: 120 })).toBe(120);
  });

  it('deltaY 负 → 向上滚，但在 0 处停住（不回弹、不出现负数）', () => {
    expect(scrollByWheel({ ...base, offset: 200, delta: -120 })).toBe(80);
    expect(scrollByWheel({ ...base, offset: 50, delta: -120 })).toBe(0);
  });

  it('向下滚到底 → 钳在 maxScroll（contentSize - viewSize = 600）', () => {
    expect(scrollByWheel({ ...base, offset: 550, delta: 500 })).toBe(600);
  });

  it('maxScroll <= 0（内容比视口短）→ 恒 0，任何 delta 都不动', () => {
    expect(scrollByWheel({ offset: 0, contentSize: 300, viewSize: 400, delta: 120 })).toBe(0);
    expect(scrollByWheel({ offset: 99, contentSize: 400, viewSize: 400, delta: -50 })).toBe(0);
    expect(scrollByWheel({ offset: 99, contentSize: 0, viewSize: 0, delta: 10 })).toBe(0);
  });

  it('speed 乘子：0.5 倍 → 一格 120px 只走 60px', () => {
    expect(scrollByWheel({ ...base, delta: 120, speed: 0.5 })).toBe(60);
    expect(DEFAULT_WHEEL_SPEED).toBe(1);
  });

  it('脏数据不产 NaN：offset / delta / speed 非有限值都当安全值', () => {
    expect(scrollByWheel({ ...base, delta: Number.NaN })).toBe(0);
    expect(scrollByWheel({ ...base, offset: Number.NaN, delta: 100 })).toBe(100);
    expect(scrollByWheel({ ...base, delta: 100, speed: Number.NaN })).toBe(100);
    const result = scrollByWheel({ ...base, contentSize: Number.NaN, delta: 100 });
    expect(Number.isFinite(result)).toBe(true);
  });

  it('浮点增量（触控板）也精确：0.5 像素不丢', () => {
    expect(scrollByWheel({ ...base, delta: 0.5 })).toBe(0.5);
  });
});

describe('sumWheelDeltas', () => {
  it('一帧多条滚轮事件合并为一个增量', () => {
    expect(sumWheelDeltas([40, 40, 40])).toBe(120);
    expect(sumWheelDeltas([])).toBe(0);
    expect(sumWheelDeltas([100, -30])).toBe(70);
  });

  it('丢弃非有限值（一条脏事件不该毁掉整帧）', () => {
    expect(sumWheelDeltas([50, Number.NaN, 50])).toBe(100);
    expect(sumWheelDeltas([Number.POSITIVE_INFINITY, 10])).toBe(10);
  });
});
