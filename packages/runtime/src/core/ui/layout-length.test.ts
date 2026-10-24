/**
 * 百分比长度（v0.3）的语义测试：`pad` / `gap` 的百分比**按方向取基数**。
 *
 * 这是 v0.3 唯一一条容易写错的规则：
 * - 水平方向（左右 padding、row 的 gap）→ 基数 = **视口宽**
 * - 垂直方向（上下 padding、column 的 gap）→ 基数 = **视口高**
 *
 * 单独一个文件是因为 layout.test.ts 已经贴着 300 行上限（AGENTS 铁律 2）。
 */

import { describe, expect, it } from 'vitest';
import { layout } from './layout';
import type { LengthInsets, LayoutSpec } from './layout';

const VIEW = { width: 390, height: 844 };
const pct = (r: number) => ({ kind: 'ratio' as const, r });

describe('padding 百分比：左右按视口宽、上下按视口高', () => {
  it('四边都 10% 时内缩量各按自己的方向算', () => {
    const padding: LengthInsets = { top: pct(0.1), right: pct(0.1), bottom: pct(0.1), left: pct(0.1) };
    const spec: LayoutSpec = {
      regions: [
        {
          name: 'body',
          edge: 'fill',
          padding,
          node: { stack: { direction: 'row', children: [{ name: 'inner', size: { kind: 'fill' } }] } },
        },
      ],
    };
    const result = layout(spec, VIEW);
    // left/right = 0.1 × 390 = 39；top/bottom = 0.1 × 844 = 84.4
    expect(result.rects['inner']).toEqual({ x: 39, y: 84.4, w: 312, h: 675.2 });
    expect(result.errors).toEqual([]);
  });

  it('只写左右百分比（pad-x）时上下保持 0', () => {
    const spec: LayoutSpec = {
      regions: [
        {
          name: 'body',
          edge: 'fill',
          padding: { top: 0, right: pct(0.05), bottom: 0, left: pct(0.05) },
          node: { stack: { direction: 'row', children: [{ name: 'inner', size: { kind: 'fill' } }] } },
        },
      ],
    };
    const result = layout(spec, VIEW);
    expect(result.rects['inner']).toEqual({ x: 19.5, y: 0, w: 351, h: 844 });
  });

  it('像素与百分比可以混用', () => {
    const spec: LayoutSpec = {
      regions: [
        {
          name: 'body',
          edge: 'fill',
          padding: { top: 10, right: pct(0.05), bottom: 10, left: pct(0.05) },
          node: { stack: { direction: 'row', children: [{ name: 'inner', size: { kind: 'fill' } }] } },
        },
      ],
    };
    const result = layout(spec, VIEW);
    expect(result.rects['inner']).toEqual({ x: 19.5, y: 10, w: 351, h: 824 });
  });
});

describe('gap 百分比：row 用视口宽、column 用视口高', () => {
  const children = [
    { name: 'a', size: { kind: 'fill' as const } },
    { name: 'b', size: { kind: 'fill' as const } },
  ];

  it('row 的 gap 10% = 视口宽的 10%', () => {
    const spec: LayoutSpec = {
      regions: [{ name: 'body', edge: 'fill', node: { stack: { direction: 'row', gap: pct(0.1), children } } }],
    };
    const result = layout(spec, VIEW);
    // gap = 39 → 两个 fill 各 (390-39)/2 = 175.5
    expect(result.rects['a']?.w).toBe(175.5);
    expect(result.rects['b']?.x).toBe(214.5);
  });

  it('column 的 gap 10% = 视口高的 10%', () => {
    const spec: LayoutSpec = {
      regions: [{ name: 'body', edge: 'fill', node: { stack: { direction: 'column', gap: pct(0.1), children } } }],
    };
    const result = layout(spec, VIEW);
    // gap = 84.4 → 两个 fill 各 (844-84.4)/2 = 379.8
    expect(result.rects['a']?.h).toBe(379.8);
    expect(result.rects['b']?.y).toBe(464.2);
  });

  it('百分比 gap 在小屏上按比例缩小（旧实现是固定像素，这正是 v0.3 要修的）', () => {
    const spec: LayoutSpec = {
      regions: [{ name: 'body', edge: 'fill', node: { stack: { direction: 'row', gap: pct(0.02), children } } }],
    };
    const big = layout(spec, { width: 390, height: 844 });
    const small = layout(spec, { width: 320, height: 568 });
    // gap: 390×0.02 = 7.8 → fill (390-7.8)/2 = 191.1 → b.x = 198.9
    // gap: 320×0.02 = 6.4 → fill (320-6.4)/2 = 156.8 → b.x = 163.2
    expect(big.rects['b']?.x).toBe(198.9);
    expect(small.rects['b']?.x).toBe(163.2);
  });
});
