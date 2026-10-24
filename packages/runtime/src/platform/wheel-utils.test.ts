/**
 * 滚轮 deltaMode 归一的契约测试（T36）。
 *
 * 为什么钉这么死：同一台机器上，触控板给 `deltaMode 0`（±1~±50 像素）、
 * 老鼠标给 `deltaMode 1`（±3 行）、个别场景给 `deltaMode 2`（±1 页）。
 * 不换算就是「滚轮几乎不动」的真实故障 —— 而它不会报错，只会让人觉得卡。
 */

import { describe, expect, it } from 'vitest';
import { normalizeWheelDelta, WHEEL_LINE_HEIGHT } from './wheel-utils';

describe('normalizeWheelDelta', () => {
  it('mode 0（像素）：原样返回，正负都保留', () => {
    expect(normalizeWheelDelta(120, 0, 844)).toBe(120);
    expect(normalizeWheelDelta(-53, 0, 844)).toBe(-53);
  });

  it('mode 1（行）：× 16 —— 3 行 = 48px', () => {
    expect(WHEEL_LINE_HEIGHT).toBe(16);
    expect(normalizeWheelDelta(3, 1, 844)).toBe(48);
    expect(normalizeWheelDelta(-1, 1, 844)).toBe(-16);
  });

  it('mode 2（页）：× 视口高 —— 1 页 = 844px，方向保留', () => {
    expect(normalizeWheelDelta(1, 2, 844)).toBe(844);
    expect(normalizeWheelDelta(-1, 2, 844)).toBe(-844);
    expect(normalizeWheelDelta(0.5, 2, 568)).toBe(284);
  });

  it('未知 mode 当像素（宁可滚得少，也不要一下跳一屏）', () => {
    expect(normalizeWheelDelta(30, 3, 844)).toBe(30);
    expect(normalizeWheelDelta(30, 99, 844)).toBe(30);
  });

  it('脏数据不产 NaN：delta 非有限 → 0；页模式的视口高无效 → 0', () => {
    expect(normalizeWheelDelta(Number.NaN, 0, 844)).toBe(0);
    expect(normalizeWheelDelta(Number.POSITIVE_INFINITY, 1, 844)).toBe(0);
    expect(normalizeWheelDelta(1, 2, Number.NaN)).toBe(0);
    expect(normalizeWheelDelta(1, 2, 0)).toBe(0);
    expect(normalizeWheelDelta(1, 2, -100)).toBe(0);
  });
});
