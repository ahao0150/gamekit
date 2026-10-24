/**
 * 吸附判定单测（T22）：中心距离、最近优先、距离相同取先出现的、边界回落。
 *
 * 这里特意留了一条「大槽位 vs 小目标」的用例：用**边缘距离**时大槽位会把远处的元素
 * 吸过去（点在槽位里边缘距离就是 0），用中心距离才是「拖到它身上」的直觉。
 */

import { describe, expect, it } from 'vitest';
import type { Rect } from './contract';
import { snapTo } from './snap';

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe('命中', () => {
  it('半径内单个目标 → 命中，distance = 中心距（56.57）', () => {
    const result = snapTo({ x: 100, y: 100 }, [{ id: 'slot', rect: rect(120, 120, 40, 40) }], 100);
    expect(result?.id).toBe('slot');
    expect(result?.distance).toBeCloseTo(56.57, 1); // hypot(40, 40)
    expect(result?.rect).toEqual({ x: 120, y: 120, w: 40, h: 40 });
  });

  it('半径外 → null', () => {
    expect(snapTo({ x: 100, y: 100 }, [{ id: 'slot', rect: rect(120, 120, 40, 40) }], 50)).toBeNull();
  });

  it('两个目标都在半径内 → 取最近的（不是数组里第一个）', () => {
    const targets = [
      { id: 'far', rect: rect(120, 120, 40, 40) }, // 中心 (140,140) → 56.57
      { id: 'near', rect: rect(100, 100, 10, 10) }, // 中心 (105,105) → 7.07
    ];
    const result = snapTo({ x: 100, y: 100 }, targets, 100);
    expect(result?.id).toBe('near');
    expect(result?.distance).toBeCloseTo(7.07, 1);
  });

  it('距离相同 → 取数组里先出现的（稳定，不随机）', () => {
    const targets = [
      { id: 'first', rect: rect(10, 0, 10, 10) }, // 中心 (15,5)
      { id: 'second', rect: rect(0, 10, 10, 10) }, // 中心 (5,15)
    ];
    // center (0,0)：两者距离都是 hypot(15,5)=15.81
    expect(snapTo({ x: 0, y: 0 }, targets, 100)?.id).toBe('first');
    expect(snapTo({ x: 0, y: 0 }, [targets[1]!, targets[0]!], 100)?.id).toBe('second');
  });

  it('大槽位不会把远处的元素吸过来（中心距 28.28 > 小目标 7.07）', () => {
    const targets = [
      { id: 'bigSlot', rect: rect(0, 0, 200, 200) }, // 中心 (100,100)
      { id: 'small', rect: rect(110, 110, 10, 10) }, // 中心 (115,115)
    ];
    // 点 (120,120) 在 bigSlot 内部（边缘距离 0），但中心距更远 → 应该吸 small
    const result = snapTo({ x: 120, y: 120 }, targets, 100);
    expect(result?.id).toBe('small');
    expect(result?.distance).toBeCloseTo(7.07, 1);
  });
});

describe('边界', () => {
  const targets = [{ id: 'slot', rect: rect(100, 100, 20, 20) }];

  it('radius = 0 / 负数 / NaN → null', () => {
    expect(snapTo({ x: 110, y: 110 }, targets, 0)).toBeNull();
    expect(snapTo({ x: 110, y: 110 }, targets, -5)).toBeNull();
    expect(snapTo({ x: 110, y: 110 }, targets, Number.NaN)).toBeNull();
  });

  it('空目标数组 → null', () => {
    expect(snapTo({ x: 110, y: 110 }, [], 100)).toBeNull();
  });

  it('坏坐标（NaN）→ null', () => {
    expect(snapTo({ x: Number.NaN, y: 110 }, targets, 100)).toBeNull();
  });

  it('刚好在半径上算命中（distance > radius 才排除）', () => {
    // 点 (110, 110) 到目标中心 (110,110) 距离 0；换一个到中心距离恰好 50 的点
    const exact = [{ id: 'slot', rect: rect(100, 100, 100, 100) }]; // 中心 (150,150)
    expect(snapTo({ x: 100, y: 150 }, exact, 50)?.id).toBe('slot'); // 距离正好 50
    expect(snapTo({ x: 100, y: 150 }, exact, 49.9)).toBeNull();
  });

  it('不修改入参（目标矩形与数组内容保持原样）', () => {
    const target = { id: 'slot', rect: rect(100, 100, 20, 20) };
    const result = snapTo({ x: 110, y: 110 }, [target], 100);
    expect(target.rect).toEqual({ x: 100, y: 100, w: 20, h: 20 });
    // 结果是快照：改它不影响入参
    if (result !== null) (result.rect as { x: number }).x = 999;
    expect(target.rect.x).toBe(100);
  });
});
