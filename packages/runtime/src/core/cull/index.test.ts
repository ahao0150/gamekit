import { describe, expect, it } from 'vitest';
import { activeWindow, intersects, isVisible, partitionByVisibility } from './index';

const VIEW = { x: 0, y: 0, w: 390, h: 844 };

describe('intersects', () => {
  it('完全分离 → false', () => {
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(false);
  });

  it('部分相交 → true', () => {
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });

  it('边挨着（右边缘 == 左边缘）算相交', () => {
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(true);
  });

  it('完全包含 → true（两个方向都是）', () => {
    expect(intersects({ x: 0, y: 0, w: 100, h: 100 }, { x: 10, y: 10, w: 5, h: 5 })).toBe(true);
    expect(intersects({ x: 10, y: 10, w: 5, h: 5 }, { x: 0, y: 0, w: 100, h: 100 })).toBe(true);
  });

  it('零宽 / 负宽 / 零高 → false（0 宽实体不许永远可见）', () => {
    expect(intersects({ x: 0, y: 0, w: 0, h: 10 }, VIEW)).toBe(false);
    expect(intersects({ x: 0, y: 0, w: -5, h: 10 }, VIEW)).toBe(false);
    expect(intersects({ x: 0, y: 0, w: 10, h: 0 }, VIEW)).toBe(false);
  });

  it('NaN 坐标 → false，不崩', () => {
    expect(intersects({ x: Number.NaN, y: 0, w: 10, h: 10 }, VIEW)).toBe(false);
    expect(intersects({ x: 0, y: 0, w: Number.NaN, h: 10 }, VIEW)).toBe(false);
  });
});

describe('activeWindow / isVisible', () => {
  it('margin 外扩：四边各加 margin', () => {
    const win = activeWindow(VIEW, 150);
    expect(win).toEqual({ x: -150, y: -150, w: 390 + 300, h: 844 + 300 });
  });

  it('margin=0 时等于 view 本身', () => {
    expect(activeWindow(VIEW, 0)).toEqual(VIEW);
  });

  it('负 margin 当 0（不会缩窗口把实体全藏了）', () => {
    expect(activeWindow(VIEW, -50)).toEqual(VIEW);
    expect(activeWindow(VIEW, Number.NaN)).toEqual(VIEW);
  });

  it('isVisible：窗口内 / 外 / 边缘 / margin 生效', () => {
    expect(isVisible({ x: 10, y: 10, w: 10, h: 10 }, VIEW)).toBe(true);
    expect(isVisible({ x: 1000, y: 10, w: 10, h: 10 }, VIEW)).toBe(false);
    // 右边缘正好在视口右边界：算可见
    expect(isVisible({ x: 380, y: 0, w: 10, h: 10 }, VIEW)).toBe(true);
    // 离屏 100px：默认不可见，margin 150 时可见
    expect(isVisible({ x: 490, y: 10, w: 10, h: 10 }, VIEW)).toBe(false);
    expect(isVisible({ x: 490, y: 10, w: 10, h: 10 }, VIEW, 150)).toBe(true);
  });
});

describe('partitionByVisibility', () => {
  const entities = [
    { id: 'far-left', rect: { x: -800, y: 0, w: 20, h: 20 } },
    { id: 'near-left', rect: { x: -100, y: 0, w: 20, h: 20 } },
    { id: 'inside', rect: { x: 100, y: 100, w: 20, h: 20 } },
    { id: 'near-right', rect: { x: 480, y: 0, w: 20, h: 20 } },
    { id: 'far-right', rect: { x: 2000, y: 0, w: 20, h: 20 } },
  ];
  const rectOf = (item: { rect: { x: number; y: number; w: number; h: number } }): typeof item.rect => item.rect;

  it('混合：按 margin 分区，且保持原顺序', () => {
    const result = partitionByVisibility(entities, rectOf, VIEW, 150);
    expect(result.visible.map((e) => e.id)).toEqual(['near-left', 'inside', 'near-right']);
    expect(result.hidden.map((e) => e.id)).toEqual(['far-left', 'far-right']);
  });

  it('全可见 / 全隐藏', () => {
    const all = partitionByVisibility([entities[2]!], rectOf, VIEW, 0);
    expect(all.visible.length).toBe(1);
    expect(all.hidden.length).toBe(0);
    const none = partitionByVisibility([entities[0]!, entities[4]!], rectOf, VIEW, 0);
    expect(none.visible.length).toBe(0);
    expect(none.hidden.length).toBe(2);
  });

  it('空列表返回两个空数组（不崩）', () => {
    const result = partitionByVisibility([], rectOf, VIEW, 150);
    expect(result.visible).toEqual([]);
    expect(result.hidden).toEqual([]);
  });

  it('零尺寸实体永远落在 hidden（不会因为坐标在视口内就算可见）', () => {
    const ghost = [{ id: 'ghost', rect: { x: 100, y: 100, w: 0, h: 0 } }];
    const result = partitionByVisibility(ghost, (item) => item.rect, VIEW, 150);
    expect(result.visible.length).toBe(0);
    expect(result.hidden.length).toBe(1);
  });
});
