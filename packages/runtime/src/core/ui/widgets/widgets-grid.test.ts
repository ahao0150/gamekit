import { expect, it } from 'vitest';
import { cellWidth, grid } from './grid';
import { makeBox, makeDeps, render } from './test-helpers';
import type { Rect } from '../contract';
import type { DrawDeps } from '../components';

/** 行高 50 + 行距 5 → 165 正好装 3 行。 */
const BOX = makeBox(0, 0, 390, 165);
const BASE = { cols: 4, cellH: 50, gapX: 8, gapY: 5 };

interface ItemCall {
  readonly index: number;
  readonly rect: Rect;
}

/** 造 count 项数据 + 记录每次 renderItem 的下标与矩形。 */
const countingDeps = (count: number): { deps: DrawDeps; calls: ItemCall[] } => {
  const calls: ItemCall[] = [];
  const base = makeDeps();
  return {
    calls,
    deps: {
      ...base,
      data: {
        items: Array.from({ length: count }, (_unused, index) => ({ id: index })),
        renderItem: (_ctx: unknown, _item: unknown, rect: Rect, index: number) => {
          calls.push({ index, rect: { ...rect } });
        },
      },
    },
  };
};

it('虚拟渲染：1000 项只调 12 次 renderItem（3 行 × 4 列），不是 1000 次', () => {
  const { deps, calls } = countingDeps(1000);
  const spy = render(grid, BOX, { ...BASE, virtual: true }, deps);
  expect(calls.length).toBe(12);
  expect(spy.fills.length).toBe(12); // 每格一次底色
  expect(calls.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

it('实渲染：virtual=false 时 1000 项全画（1000 次 renderItem）', () => {
  const { deps, calls } = countingDeps(1000);
  const spy = render(grid, BOX, { ...BASE, virtual: false }, deps);
  expect(calls.length).toBe(1000);
  // 最后一项的 y 在容器外（clip 掉），但组件确实画了 —— 这是「全画」的语义
  expect(spy.clips).toBe(1);
});

it('cellW 精确：box.w=390、gapX=8、cols=4 → (390-24)/4 = 91.5', () => {
  expect(cellWidth(390, 4, 8)).toBe(91.5);
  expect(cellWidth(390, 4, 8) * 4 + 8 * 3).toBe(390);
  // 直接看绘制：单元格宽 91.5
  const { deps, calls } = countingDeps(8);
  render(grid, BOX, BASE, deps);
  expect(calls[0]?.rect.w).toBe(91.5);
});

it('列 x 逐差 = cellW + gapX（91.5 + 8 = 99.5）', () => {
  const { deps, calls } = countingDeps(8);
  render(grid, BOX, BASE, deps);
  const xs = calls.slice(0, 4).map((c) => c.rect.x);
  expect(xs).toEqual([0, 99.5, 199, 298.5]);
  for (let i = 1; i < xs.length; i += 1) {
    expect((xs[i] ?? 0) - (xs[i - 1] ?? 0)).toBeCloseTo(99.5, 10);
  }
});

it('行 y 逐差 = cellH + gapY（50 + 5 = 55）', () => {
  const { deps, calls } = countingDeps(12);
  render(grid, BOX, BASE, deps);
  const ys = calls.map((c) => c.rect.y);
  // 每行 4 个，取每行第一个
  expect([ys[0], ys[4], ys[8]]).toEqual([0, 55, 110]);
});

it('最后一行不满：count=10、cols=4 → 第 3 行只画 2 项（不画空格子）', () => {
  const { deps, calls } = countingDeps(10);
  const spy = render(grid, BOX, BASE, deps);
  expect(calls.length).toBe(10);
  expect(spy.fills.length).toBe(10);
  const thirdRow = calls.filter((c) => Math.abs(c.rect.y - 110) < 0.01);
  expect(thirdRow.map((c) => c.index)).toEqual([8, 9]);
  expect(thirdRow.map((c) => c.rect.x)).toEqual([0, 99.5]);
});

it('clip：裁到自己的 box 一次，save / restore 配对（不配对会污染后续组件）', () => {
  const { deps } = countingDeps(100);
  const spy = render(grid, BOX, BASE, deps);
  expect(spy.clips).toBe(1);
  expect(spy.saves).toBe(1);
  expect(spy.restores).toBe(1);
  // clip 区域 = 自己的 box
  expect(spy.rects).toEqual([[BOX.x, BOX.y, BOX.w, BOX.h]]);
});

it('空数据：画 emptyText（居中），不调 renderItem、save/restore 仍配对', () => {
  const base = makeDeps();
  let called = 0;
  const deps: DrawDeps = {
    ...base,
    data: { items: [], renderItem: () => void (called += 1) },
  };
  const spy = render(grid, BOX, { ...BASE, emptyText: '暂无物品' }, deps);
  expect(called).toBe(0);
  expect(spy.texts.map((t) => t.text)).toContain('暂无物品');
  expect(spy.saves).toBe(1);
  expect(spy.restores).toBe(1);
});

it('没有 renderItem：只画底格，不崩', () => {
  const base = makeDeps();
  const deps: DrawDeps = { ...base, data: { items: Array.from({ length: 8 }, (_u, i) => i) } };
  const spy = render(grid, BOX, BASE, deps);
  expect(spy.fills.length).toBe(8);
  expect(spy.texts.length).toBe(0);
});

it('cols=1：退化成纵向列表（一行一项，3 行画 3 项）', () => {
  const { deps, calls } = countingDeps(5);
  render(grid, BOX, { ...BASE, cols: 1 }, deps);
  expect(calls.length).toBe(3);
  expect(calls.map((c) => c.index)).toEqual([0, 1, 2]);
});

it('cols > count：一行画完（不制造空行）', () => {
  const { deps, calls } = countingDeps(3);
  render(grid, BOX, { ...BASE, cols: 8 }, deps);
  expect(calls.length).toBe(3);
  expect(new Set(calls.map((c) => c.rect.y)).size).toBe(1);
});

it('滚动 55px（整一行）：首项变成下标 4、y 从 0 开始', () => {
  const { deps, calls } = countingDeps(100);
  render(grid, BOX, { ...BASE, scrollTop: 55 }, deps);
  expect(calls[0]?.index).toBe(4);
  expect(calls[0]?.rect.y).toBe(0);
  // 第 2 行（index 8）：110 - 55 = 55
  expect(calls[4]?.index).toBe(8);
  expect(calls[4]?.rect.y).toBe(55);
});

it('滚动 20px（半行）：首行仍可见，y 从 -20 开始', () => {
  const { deps, calls } = countingDeps(100);
  render(grid, BOX, { ...BASE, scrollTop: 20 }, deps);
  expect(calls[0]?.index).toBe(0);
  expect(calls[0]?.rect.y).toBe(-20);
});

it('单元格底色用 itemColor（默认主题色能否被覆盖）', () => {
  const { deps } = countingDeps(4);
  const spy = render(grid, BOX, { ...BASE, itemColor: '#123456' }, deps);
  expect(spy.fills[0]?.color).toBe('#123456');
});

it('box 尺寸非法 / cellH 非法：一次都不画（不崩）', () => {
  const { deps, calls } = countingDeps(8);
  expect(render(grid, makeBox(0, 0, 0, 165), BASE, deps).fills.length).toBe(0);
  expect(render(grid, makeBox(0, 0, 390, 0), BASE, deps).fills.length).toBe(0);
  expect(render(grid, BOX, { ...BASE, cellH: 0 }, deps).fills.length).toBe(0);
  expect(calls.length).toBe(0);
});

it('列太密（cellW <= 0）：不画，也不出现负宽度', () => {
  const { deps, calls } = countingDeps(8);
  // gapX=200、cols=4 → cellW = (100 - 600)/4 < 0
  const spy = render(grid, makeBox(0, 0, 100, 165), { ...BASE, gapX: 200 }, deps);
  expect(spy.fills.length).toBe(0);
  expect(calls.length).toBe(0);
});
