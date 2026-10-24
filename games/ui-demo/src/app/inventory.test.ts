import { expect, it } from 'vitest';
import { contentHeight, itemAt, itemIndexAt, ITEM_H, ITEMS, scrollRatios } from './inventory';

it('假数据 20 件，名字带序号、数量在 1..13', () => {
  expect(ITEMS.length).toBe(20);
  expect(ITEMS[0]).toEqual({ id: 1, name: '物品 01', count: 1 });
  expect(ITEMS[19]?.name).toBe('物品 20');
  for (const item of ITEMS) {
    expect(item.count).toBeGreaterThanOrEqual(1);
    expect(item.count).toBeLessThanOrEqual(13);
  }
});

it('contentHeight = 项数 × 项高（gap 0：20×56=1120）', () => {
  expect(contentHeight()).toBe(ITEMS.length * ITEM_H);
  expect(contentHeight()).toBe(1120);
});

it('itemIndexAt：列表顶 + 滚动位换算出下标', () => {
  // 列表从 y=100 开始、没滚动：第 0 项占 100..156
  expect(itemIndexAt(100, 100, 0)).toBe(0);
  expect(itemIndexAt(155.9, 100, 0)).toBe(0);
  expect(itemIndexAt(156, 100, 0)).toBe(1);
  // 滚了 200px（=3.57 项）：y=100 落在第 3 项里（200/56 = 3.57 → floor 3）
  expect(itemIndexAt(100, 100, 200)).toBe(3);
  expect(itemIndexAt(100 + 56 * 2, 100, 200)).toBe(5);
});

it('itemIndexAt：列表上方 / 越界 / 坏输入都返回 null', () => {
  expect(itemIndexAt(99, 100, 0)).toBeNull(); // 在列表上方
  expect(itemIndexAt(-5, 0, 0)).toBeNull();
  // 滚到底后点列表下方 → 下标超过 19
  expect(itemIndexAt(100 + 56 * 20, 100, 0)).toBeNull();
  expect(itemIndexAt(Number.NaN, 100, 0)).toBeNull();
  expect(itemIndexAt(100, Number.NaN, 0)).toBeNull();
});

it('scrollRatios：可滚动时 value 按可滚动距离算、viewport 按高度比例', () => {
  const content = 1120;
  const view = 400;
  const maxOffset = content - view; // 720
  expect(scrollRatios(content, view, 0)).toEqual({ value: 0, viewport: 400 / 1120 });
  expect(scrollRatios(content, view, maxOffset).value).toBeCloseTo(1, 10);
  expect(scrollRatios(content, view, 360).value).toBeCloseTo(0.5, 10);
  // 越界钳制
  expect(scrollRatios(content, view, 99999).value).toBeCloseTo(1, 10);
  expect(scrollRatios(content, view, -50).value).toBe(0);
});

it('scrollRatios：内容装得下时 viewport 钳到 1（scrollbar 自己会不画）', () => {
  // content 200 / view 400 → view/content = 2 → 钳到 1
  expect(scrollRatios(200, 400, 0)).toEqual({ value: 0, viewport: 1 });
  expect(scrollRatios(400, 400, 0)).toEqual({ value: 0, viewport: 1 });
  expect(scrollRatios(100, 400, 0)).toEqual({ value: 0, viewport: 1 });
  // 内容比视口高才 < 1
  expect(scrollRatios(800, 400, 0).viewport).toBeCloseTo(0.5, 10);
  // 非法尺寸不崩
  expect(scrollRatios(Number.NaN, 400, 0)).toEqual({ value: 0, viewport: 1 });
  expect(scrollRatios(1120, 0, 0)).toEqual({ value: 0, viewport: 1 });
});

it('itemAt：下标合法才返回物品，否则 null', () => {
  expect(itemAt(0)?.name).toBe('物品 01');
  expect(itemAt(19)?.name).toBe('物品 20');
  expect(itemAt(20)).toBeNull();
  expect(itemAt(-1)).toBeNull();
  expect(itemAt(null)).toBeNull();
  expect(itemAt(Number.NaN)).toBeNull();
});
