/**
 * UI 布局核心的原语语义测试（region / stack / size / align / 溢出）。
 *
 * 真实游戏布局的对照在 `layout.kuaidi.test.ts`（拆开是为了守 300 行上限）。
 */

import { describe, expect, it } from 'vitest';
import { auto, fill, fixed, layout, ratio } from './layout';
import type { LayoutSpec } from './layout';

const VIEW = { width: 390, height: 844 };

/** 取命名 rect（不存在直接失败，避免断言悄悄跳过）。 */
const rectOf = (spec: LayoutSpec, name: string) => {
  const result = layout(spec, VIEW);
  const rect = result.rects[name] ?? result.regions[name];
  if (rect === undefined) throw new Error(`没有算出 ${name} 的矩形：${result.errors.join('; ')}`);
  return rect;
};

describe('region：切带', () => {
  it('top 从顶部累加', () => {
    const result = layout(
      {
        regions: [
          { name: 'a', edge: 'top', height: 48 },
          { name: 'b', edge: 'top', height: 100 },
          { name: 'rest', edge: 'fill' },
        ],
      },
      VIEW,
    );
    expect(result.regions['a']).toEqual({ x: 0, y: 0, w: 390, h: 48 });
    expect(result.regions['b']).toEqual({ x: 0, y: 48, w: 390, h: 100 });
    expect(result.regions['rest']).toEqual({ x: 0, y: 148, w: 390, h: 696 });
    expect(result.errors).toEqual([]);
  });

  it('bottom 从底部累减（第一条贴最底）', () => {
    const result = layout(
      {
        regions: [
          { name: 'footer', edge: 'bottom', height: 64 },
          { name: 'above', edge: 'bottom', height: 32 },
          { name: 'body', edge: 'fill' },
        ],
      },
      VIEW,
    );
    expect(result.regions['footer']).toEqual({ x: 0, y: 780, w: 390, h: 64 });
    expect(result.regions['above']).toEqual({ x: 0, y: 748, w: 390, h: 32 });
    expect(result.regions['body']).toEqual({ x: 0, y: 0, w: 390, h: 748 });
  });

  it('fill 吃掉剩余，多个 fill 平分', () => {
    const result = layout(
      {
        regions: [
          { name: 'head', edge: 'top', height: 100 },
          { name: 'half-a', edge: 'fill' },
          { name: 'half-b', edge: 'fill' },
          { name: 'foot', edge: 'bottom', height: 144 },
        ],
      },
      VIEW,
    );
    // 844 - 100 - 144 = 600 → 两个 fill 各 300
    expect(result.regions['half-a']?.h).toBe(300);
    expect(result.regions['half-b']?.h).toBe(300);
    expect(result.regions['half-b']?.y).toBe(400);
  });

  it('顺序无关：数组打乱后结果完全一致', () => {
    const regions = [
      { name: 'head', edge: 'top' as const, height: 60 },
      { name: 'foot', edge: 'bottom' as const, height: 80 },
      { name: 'body', edge: 'fill' as const },
    ];
    const a = layout({ regions }, VIEW);
    const b = layout({ regions: [regions[2]!, regions[0]!, regions[1]!] }, VIEW);
    const c = layout({ regions: [regions[1]!, regions[2]!, regions[0]!] }, VIEW);
    expect(b.regions).toEqual(a.regions);
    expect(c.regions).toEqual(a.regions);
    expect(a.regions['body']).toEqual({ x: 0, y: 60, w: 390, h: 704 });
  });

  it('带 padding（安全区）时整体内缩', () => {
    const result = layout(
      {
        padding: { top: 47, right: 0, bottom: 34, left: 0 },
        regions: [
          { name: 'head', edge: 'top', height: 50 },
          { name: 'body', edge: 'fill' },
        ],
      },
      VIEW,
    );
    expect(result.regions['head']).toEqual({ x: 0, y: 47, w: 390, h: 50 });
    // 844 - 47 - 34 = 763，减去 head 50 = 713
    expect(result.regions['body']).toEqual({ x: 0, y: 97, w: 390, h: 713 });
  });

  it('top + bottom 超过视口时 errors 报溢出（不抛异常）', () => {
    const result = layout(
      {
        regions: [
          { name: 'head', edge: 'top', height: 500 },
          { name: 'foot', edge: 'bottom', height: 400 },
        ],
      },
      VIEW,
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('region 溢出');
    expect(result.errors[0]).toContain('900');
    expect(result.errors[0]).toContain('844');
  });
});

describe('stack：一维流', () => {
  it('row：按宽排列 + gap 生效', () => {
    const result = layout(
      {
        regions: [
          {
            name: 'body',
            edge: 'fill',
            node: {
              stack: {
                direction: 'row',
                gap: 12,
                children: [
                  { name: 'a', size: 100 },
                  { name: 'b', size: 200 },
                  { name: 'c', size: fill },
                ],
              },
            },
          },
        ],
      },
      VIEW,
    );
    expect(result.rects['a']).toEqual({ x: 0, y: 0, w: 100, h: 844 });
    expect(result.rects['b']).toEqual({ x: 112, y: 0, w: 200, h: 844 });
    // 390 - 100 - 200 - 12*2 = 66
    expect(result.rects['c']).toEqual({ x: 324, y: 0, w: 66, h: 844 });
  });

  it('column：按高排列 + gap 生效', () => {
    const result = layout(
      {
        regions: [
          {
            name: 'body',
            edge: 'fill',
            node: {
              stack: {
                direction: 'column',
                gap: 8,
                children: [
                  { name: 'a', size: 100 },
                  { name: 'b', size: fixed(200) },
                  { name: 'c', size: fill },
                ],
              },
            },
          },
        ],
      },
      VIEW,
    );
    expect(result.rects['a']?.y).toBe(0);
    expect(result.rects['b']?.y).toBe(108);
    expect(result.rects['c']?.y).toBe(316);
    expect(result.rects['c']?.h).toBe(844 - 100 - 200 - 16);
  });

  it('ratio 按容器主轴取比例', () => {
    const result = layout(
      {
        regions: [
          {
            name: 'body',
            edge: 'fill',
            node: { stack: { direction: 'row', children: [{ name: 'half', size: ratio(0.5) }, { name: 'rest', size: fill }] } },
          },
        ],
      },
      VIEW,
    );
    expect(result.rects['half']?.w).toBe(195);
    expect(result.rects['rest']?.w).toBe(195);
  });

  it('auto 用 measure() 取尺寸；没注册 measure 时按 0 且不报错', () => {
    const result = layout(
      {
        regions: [
          {
            name: 'body',
            edge: 'fill',
            node: {
              stack: {
                direction: 'row',
                children: [
                  { name: 'text', size: auto, measure: () => ({ w: 120, h: 24 }) },
                  { name: 'nothing', size: auto },
                  { name: 'rest', size: fill },
                ],
              },
            },
          },
        ],
      },
      VIEW,
    );
    expect(result.rects['text']?.w).toBe(120);
    expect(result.rects['nothing']?.w).toBe(0);
    expect(result.rects['rest']?.w).toBe(270);
    expect(result.errors).toEqual([]);
  });

  it('column 内容总高超过容器时 errors 报溢出并带数字', () => {
    const result = layout(
      {
        regions: [
          {
            name: 'body',
            edge: 'top',
            height: 200,
            node: {
              stack: {
                direction: 'column',
                gap: 10,
                children: [{ name: 'a', size: 100 }, { name: 'b', size: 120 }],
              },
            },
          },
        ],
      },
      VIEW,
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('主轴溢出');
    expect(result.errors[0]).toContain('230'); // 100 + 120 + 10
    expect(result.errors[0]).toContain('200');
  });
});

describe('stack：交叉轴 align', () => {
  const build = (align: 'start' | 'center' | 'end' | 'stretch', cross?: number): LayoutSpec => ({
    regions: [
      {
        name: 'body',
        edge: 'top',
        height: 200,
        node: {
          stack: {
            direction: 'row',
            gap: 0,
            align,
            children: [{ name: 'item', size: 100, ...(cross === undefined ? {} : { cross: fixed(cross) }) }],
          },
        },
      },
    ],
  });

  it('start：贴交叉轴起点', () => {
    expect(rectOf(build('start', 40), 'item')).toEqual({ x: 0, y: 0, w: 100, h: 40 });
  });

  it('center：交叉轴居中', () => {
    expect(rectOf(build('center', 40), 'item')).toEqual({ x: 0, y: 80, w: 100, h: 40 });
  });

  it('end：贴交叉轴末尾', () => {
    expect(rectOf(build('end', 40), 'item')).toEqual({ x: 0, y: 160, w: 100, h: 40 });
  });

  it('stretch：交叉轴拉满（忽略 cross）', () => {
    expect(rectOf(build('stretch', 40), 'item')).toEqual({ x: 0, y: 0, w: 100, h: 200 });
  });
});

describe('性能：Node 里跑得上千次也是毫秒级', () => {
  it('1000 次求解 < 100ms', () => {
    const spec: LayoutSpec = {
      regions: [
        { name: 'head', edge: 'top', height: 48 },
        { name: 'body', edge: 'fill', node: { stack: { direction: 'column', gap: 8, children: [{ name: 'a', size: fill }, { name: 'b', size: fixed(56) }, { name: 'c', size: ratio(0.2) }] } } },
        { name: 'foot', edge: 'bottom', height: 64 },
      ],
    };
    const started = performance.now();
    for (let i = 0; i < 1000; i += 1) layout(spec, VIEW);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
