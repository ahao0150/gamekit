/**
 * v0.4 主轴对齐 `justify` 的语义测试。
 *
 * 独立文件（不塞进 layout.test.ts）的原因：那边已接近 300 行铁律上限，
 * 而 justify 是一条独立原语，语义、边界、与 fill/百分比混用都该单独钉住。
 */

import { describe, expect, it } from 'vitest';
import { fixed, layout } from './layout';
import type { Justify, LayoutSpec, Length, StackSpec } from './layout';

const VIEW = { width: 390, height: 844 };

/** 一个 fill 带，里面 column 流排两个固定高元素（100 + gap 10 + 60）。 */
const columnSpec = (justify?: Justify, gap: Length = 10): LayoutSpec => ({
  regions: [
    {
      name: 'body',
      edge: 'fill',
      node: {
        stack: {
          direction: 'column',
          gap,
          ...(justify === undefined ? {} : { justify }),
          children: [
            { name: 'a', size: fixed(100) },
            { name: 'b', size: fixed(60) },
          ],
        },
      },
    },
  ],
});

const columnStack = (direction: 'row' | 'column', justify: Justify, children: StackSpec['children']): LayoutSpec => ({
  regions: [{ name: 'body', edge: 'fill', node: { stack: { direction, justify, children } } }],
});

const rectOf = (spec: LayoutSpec, name: string) => layout(spec, VIEW).rects[name];

describe('justify：主轴分配剩余空间（column）', () => {
  it('start 是默认值：与完全不写 justify 逐值一致', () => {
    const withDefault = layout(columnSpec('start'), VIEW);
    const omitted = layout(columnSpec(), VIEW);
    expect(withDefault.rects).toEqual(omitted.rects);
    expect(withDefault.regions).toEqual(omitted.regions);
  });

  it('center：剩余空间两端平分', () => {
    // 844 - 100 - 60 - 10 = 674 → 上下各 337
    const spec = columnSpec('center');
    expect(rectOf(spec, 'a')?.y).toBe(337);
    expect(rectOf(spec, 'b')?.y).toBe(447);
  });

  it('end：贴主轴终点', () => {
    const spec = columnSpec('end');
    expect(rectOf(spec, 'a')?.y).toBe(674);
    expect(rectOf(spec, 'b')?.y).toBe(784);
  });

  it('space-between：两端贴边，剩余空间均分到子元素之间', () => {
    // gap 10 + 均分 674 = 684 → b.y = 100 + 684 = 784（底边 844）
    const spec = columnSpec('space-between');
    expect(rectOf(spec, 'a')?.y).toBe(0);
    expect(rectOf(spec, 'b')?.y).toBe(784);
  });

  it('space-between 只有一个子元素时等同 start', () => {
    const spec = columnStack('column', 'space-between', [{ name: 'only', size: fixed(100) }]);
    expect(rectOf(spec, 'only')?.y).toBe(0);
  });
});

describe('justify：row 方向走水平（x）', () => {
  it('center / end / space-between 作用在 x 上', () => {
    // 390 - 100 - 60 = 230（这个用例没有 gap）
    const center = columnStack('row', 'center', [
      { name: 'a', size: fixed(100) },
      { name: 'b', size: fixed(60) },
    ]);
    expect(rectOf(center, 'a')?.x).toBe(115);
    expect(rectOf(center, 'b')?.x).toBe(215);

    const end = columnStack('row', 'end', [
      { name: 'a', size: fixed(100) },
      { name: 'b', size: fixed(60) },
    ]);
    expect(rectOf(end, 'a')?.x).toBe(230);
    expect(rectOf(end, 'b')?.x).toBe(330);

    const between = columnStack('row', 'space-between', [
      { name: 'a', size: fixed(100) },
      { name: 'b', size: fixed(60) },
    ]);
    expect(rectOf(between, 'a')?.x).toBe(0);
    expect(rectOf(between, 'b')?.x).toBe(330);
  });
});

describe('justify 与 fill / 百分比混用', () => {
  it('fill 子元素先吃剩余空间，justify 不再改变分配', () => {
    // 定长 100（gap 0）→ fill 吃 744；没有剩余给 justify
    const spec = columnStack('column', 'center', [{ name: 'a', size: fixed(100) }, { name: 'b', size: { kind: 'fill' } }]);
    expect(rectOf(spec, 'a')?.y).toBe(0);
    expect(rectOf(spec, 'a')?.h).toBe(100);
    expect(rectOf(spec, 'b')?.y).toBe(100);
    expect(rectOf(spec, 'b')?.h).toBe(744);
  });

  it('百分比 gap 与 justify 混用：gap 按视口高取基数', () => {
    // gap = 844 × 10% = 84.4；剩余 844 - 100 - 60 - 84.4 = 599.6 → 上下各 299.8
    const spec = columnSpec('center', { kind: 'ratio', r: 0.1 });
    expect(rectOf(spec, 'a')?.y).toBe(299.8);
    expect(rectOf(spec, 'b')?.y).toBe(484.2);
  });

  it('百分比尺寸 + justify：剩余空间按解析后的实际尺寸算', () => {
    // a 高 10%（84.4），b 高 20%（168.8），gap 0 → 剩余 590.8 → 各 295.4
    const spec = columnStack('column', 'center', [
      { name: 'a', size: { kind: 'ratio', r: 0.1 } },
      { name: 'b', size: { kind: 'ratio', r: 0.2 } },
    ]);
    const result = layout(spec, VIEW);
    expect(result.errors).toEqual([]);
    expect(result.rects['a']?.h).toBe(84.4);
    expect(result.rects['b']?.h).toBe(168.8);
    expect(result.rects['a']?.y).toBe(295.4);
    expect(result.rects['b']?.y).toBe(379.8);
  });

  it('溢出时不分配负空间，且错误照常上报', () => {
    const spec = columnStack('column', 'center', [
      { name: 'a', size: fixed(500) },
      { name: 'b', size: fixed(500) },
    ]);
    const result = layout(spec, VIEW);
    expect(result.rects['a']?.y).toBe(0);
    expect(result.rects['b']?.y).toBe(500);
    expect(result.errors.some((error) => error.includes('主轴溢出'))).toBe(true);
  });
});
