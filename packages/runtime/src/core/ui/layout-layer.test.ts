/**
 * v0.5 分层（layer）与命中语义（hit）的布局语义测试。
 *
 * 独立文件：layout.test.ts / layout-justify.test.ts 已各自接近 300 行，
 * 分层是新原语，语义（overlay 独立整屏、paintOrder、meta）单独钉。
 */

import { describe, expect, it } from 'vitest';
import { fill, fixed, layout, ratio } from './layout';
import type { LayoutSpec } from './layout';

const VIEW = { width: 390, height: 844 };

/** base 两带：head 100 + body fill；body 里 justify center 一个 200 高的块。 */
const baseSpec = (): LayoutSpec => ({
  regions: [
    {
      name: 'head',
      edge: 'top',
      height: fixed(100),
      node: { stack: { direction: 'column', children: [{ name: 'title', size: fixed(40) }] } },
    },
    {
      name: 'body',
      edge: 'fill',
      node: { stack: { direction: 'column', justify: 'center', children: [{ name: 'content', size: fixed(200) }] } },
    },
  ],
});

/** 弹窗：base 一个按钮；overlay 遮罩 + 面板 + 按钮（各自整屏）。 */
const popupSpec = (): LayoutSpec => ({
  regions: [
    { name: 'base', edge: 'fill', node: { stack: { direction: 'column', children: [{ name: 'openButton', size: fixed(56) }] } } },
    {
      name: 'mask',
      edge: 'fill',
      layer: 'overlay',
      node: { stack: { direction: 'column', children: [{ name: 'maskBox', size: fill, hit: 'block' }] } },
    },
    {
      name: 'dialog',
      edge: 'fill',
      layer: 'overlay',
      node: {
        stack: {
          direction: 'column',
          justify: 'center',
          align: 'center',
          children: [{ name: 'panel', size: ratio(0.34), cross: ratio(0.8) }],
        },
      },
    },
    {
      name: 'action',
      edge: 'fill',
      layer: 'overlay',
      node: {
        stack: {
          direction: 'column',
          justify: 'center',
          align: 'center',
          children: [{ name: 'okButton', size: ratio(0.12), cross: ratio(0.56) }],
        },
      },
    },
  ],
});

describe('layer：base 零变化', () => {
  it('不写 layer 与显式 layer base 的布局结果逐值一致', () => {
    const omitted = layout(baseSpec(), VIEW);
    const explicit: LayoutSpec = {
      regions: baseSpec().regions.map((region) => ({ ...region, layer: 'base' as const })),
    };
    const withLayer = layout(explicit, VIEW);
    expect(withLayer.rects).toEqual(omitted.rects);
    expect(withLayer.regions).toEqual(omitted.regions);
    expect(withLayer.paintOrder).toEqual(omitted.paintOrder);
    expect(withLayer.meta).toEqual(omitted.meta);
    expect(withLayer.errors).toEqual([]);
  });

  it('base 的流布局不受 overlay region 影响', () => {
    const baseOnly = layout(baseSpec(), VIEW);
    const mixed = layout({ regions: [...baseSpec().regions, ...popupSpec().regions.filter((r) => r.layer === 'overlay')] }, VIEW);
    expect(mixed.regions['body']?.h).toBe(baseOnly.regions['body']?.h);
    expect(mixed.rects['content']).toEqual(baseOnly.rects['content']);
  });
});

describe('layer：overlay 是独立整屏坐标系', () => {
  it('多个 overlay region 都写 fill 时各自占满视口（天然重叠）', () => {
    const result = layout(popupSpec(), VIEW);
    expect(result.errors).toEqual([]);
    for (const name of ['mask', 'dialog', 'action']) {
      expect(result.regions[name], `${name} 应整屏`).toEqual({ x: 0, y: 0, w: 390, h: 844 });
    }
  });

  it('overlay 的 edge/高度被忽略：写 top 也按整屏算', () => {
    const spec: LayoutSpec = {
      regions: [
        {
          name: 'odd',
          edge: 'top',
          height: fixed(50),
          layer: 'overlay',
          node: { stack: { direction: 'column', children: [{ name: 'box', size: fill }] } },
        },
      ],
    };
    const result = layout(spec, VIEW);
    expect(result.regions['odd']).toEqual({ x: 0, y: 0, w: 390, h: 844 });
    expect(result.rects['box']?.h).toBe(844);
  });

  it('overlay 里 justify / align 照常生效：面板居中、按钮叠在面板中心', () => {
    const result = layout(popupSpec(), VIEW);
    const panel = result.rects['panel'];
    const ok = result.rects['okButton'];
    // 面板：高 34%、宽 80%，整屏居中
    expect(panel?.h).toBe(286.96);
    expect(panel?.w).toBe(312);
    expect(panel?.x).toBe(39);
    expect(panel?.y).toBe(278.52);
    // 按钮：高 12%、宽 56%，与面板同心（叠在面板中央）
    expect(ok?.h).toBe(101.28);
    expect(ok?.w).toBe(218.4);
    expect(ok?.x).toBe(85.8);
    expect(ok?.y).toBe(371.36);
    expect((panel?.y ?? 0) + (panel?.h ?? 0) / 2).toBeCloseTo((ok?.y ?? 0) + (ok?.h ?? 0) / 2, 2);
  });
});

describe('paintOrder 与 meta', () => {
  it('绘制顺序 = layer 声明序 → 层内声明序', () => {
    const result = layout(popupSpec(), VIEW);
    // base 先（openButton），overlay 按声明序（mask → dialog → action）
    expect(result.paintOrder).toEqual(['openButton', 'maskBox', 'panel', 'okButton']);
  });

  it('meta 记录每个组件的 layer / hit / layerIndex / index', () => {
    const result = layout(popupSpec(), VIEW);
    expect(result.meta['openButton']).toEqual({ layer: 'base', hit: 'self', layerIndex: 0, index: 0 });
    expect(result.meta['maskBox']).toEqual({ layer: 'overlay', hit: 'block', layerIndex: 1, index: 0 });
    expect(result.meta['panel']).toEqual({ layer: 'overlay', hit: 'self', layerIndex: 1, index: 1 });
    expect(result.meta['okButton']).toEqual({ layer: 'overlay', hit: 'self', layerIndex: 1, index: 2 });
    // paintOrder 与 meta 的键一致
    expect(Object.keys(result.meta).sort()).toEqual([...result.paintOrder].sort());
  });

  it('hit 默认 self：不写与显式 hit self 的布局结果逐值一致', () => {
    const omitted = layout(popupSpec(), VIEW);
    const explicit: LayoutSpec = {
      regions: popupSpec().regions.map((region) => {
        const stack = region.node?.stack;
        if (stack === undefined) return region;
        return {
          ...region,
          node: {
            stack: {
              ...stack,
              // 只给「原本没写 hit」的元素补上显式 self；mask 的 block 不能被覆盖
              children: stack.children.map((child) => (child.hit === undefined ? { ...child, hit: 'self' as const } : child)),
            },
          },
        };
      }),
    };
    const withSelf = layout(explicit, VIEW);
    expect(withSelf.rects).toEqual(omitted.rects);
    expect(withSelf.meta).toEqual(omitted.meta);
    expect(withSelf.paintOrder).toEqual(omitted.paintOrder);
  });

  it('hit: none 只影响 meta，不影响矩形与绘制顺序', () => {
    const spec: LayoutSpec = {
      regions: [
        {
          name: 'body',
          edge: 'fill',
          node: { stack: { direction: 'column', children: [{ name: 'deco', size: fixed(40), hit: 'none' }] } },
        },
      ],
    };
    const result = layout(spec, VIEW);
    expect(result.rects['deco']?.h).toBe(40);
    expect(result.meta['deco']?.hit).toBe('none');
    expect(result.paintOrder).toEqual(['deco']);
  });
});
