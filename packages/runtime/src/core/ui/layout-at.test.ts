/**
 * `at` 任意位置的布局测试（v0.6）。
 *
 * 验收口径是**精确数值**，不是「没报错」：
 * `at 30% 70%` + `size 60% 18%` 在 390×844 下必须是
 * x = 0、y = 514.84、w = 234、h = 151.92。
 *
 * 另外钉死边界：左上 / 右下 / 完全跑出视口都被钳回来（内容不会消失）。
 */
import { describe, expect, it } from 'vitest';
import { fill, layout } from './layout';
import type { LayoutSpec } from './layout';

const ratio = (r: number) => ({ kind: 'ratio' as const, r });

const atRegion = (
  opts: {
    readonly at?: { x: number | { readonly kind: 'ratio'; readonly r: number }; y: number | { readonly kind: 'ratio'; readonly r: number } };
    readonly size?: { w: number | { readonly kind: 'ratio'; readonly r: number }; h: number | { readonly kind: 'ratio'; readonly r: number } };
    readonly name?: string;
  } = {},
): LayoutSpec => ({
  regions: [
    {
      name: opts.name ?? 'tip',
      edge: 'fill',
      layer: 'overlay',
      ...(opts.at === undefined ? {} : { at: opts.at }),
      ...(opts.size === undefined ? {} : { size: opts.size }),
    },
  ],
});

const VIEWPORT = { width: 390, height: 844 };

describe('at：中心点 + size 的精确几何', () => {
  it('at 30% 70% + size 60% 18% → x=0 / y=514.84 / w=234 / h=151.92', () => {
    const result = layout(
      atRegion({ at: { x: ratio(0.3), y: ratio(0.7) }, size: { w: ratio(0.6), h: ratio(0.18) } }),
      VIEWPORT,
    );
    expect(result.errors).toEqual([]);
    expect(result.regions.tip).toEqual({ x: 0, y: 514.84, w: 234, h: 151.92 });
  });

  it('像素写法：at 100 200 + size 200 100 → x=0 / y=150', () => {
    const result = layout(atRegion({ at: { x: 100, y: 200 }, size: { w: 200, h: 100 } }), VIEWPORT);
    expect(result.errors).toEqual([]);
    expect(result.regions.tip).toEqual({ x: 0, y: 150, w: 200, h: 100 });
  });

  it('region 内的元素用 region 的框排布（justify/align 仍作用于内部）', () => {
    const result = layout(
      {
        regions: [
          {
            name: 'tip',
            edge: 'fill',
            layer: 'overlay',
            at: { x: ratio(0.3), y: ratio(0.7) },
            size: { w: ratio(0.6), h: ratio(0.18) },
            node: {
              stack: {
                direction: 'column',
                justify: 'center',
                children: [{ name: 'label', size: fill }],
              },
            },
          },
        ],
      },
      VIEWPORT,
    );
    expect(result.errors).toEqual([]);
    // 交叉轴默认 stretch → 宽度拉满 234；主轴 fill → 高度 151.92，整框与 region 一致
    expect(result.rects.label).toEqual({ x: 0, y: 514.84, w: 234, h: 151.92 });
  });

  it('没写 at 的 overlay region 仍然是整屏（回归）', () => {
    const result = layout({ regions: [{ name: 'mask', edge: 'fill', layer: 'overlay' }] }, VIEWPORT);
    expect(result.regions.mask).toEqual({ x: 0, y: 0, w: 390, h: 844 });
  });
});

describe('at 的边界钳制', () => {
  it('at 0% 0%（左上）→ 左上角落在 -半宽 / -半高，中心仍在视口角上', () => {
    const result = layout(
      atRegion({ at: { x: ratio(0), y: ratio(0) }, size: { w: ratio(0.6), h: ratio(0.18) } }),
      VIEWPORT,
    );
    expect(result.regions.tip).toEqual({ x: -117, y: -75.96, w: 234, h: 151.92 });
  });

  it('at 100% 100%（右下）→ 中心在视口右下角', () => {
    const result = layout(
      atRegion({ at: { x: ratio(1), y: ratio(1) }, size: { w: ratio(0.6), h: ratio(0.18) } }),
      VIEWPORT,
    );
    expect(result.regions.tip).toEqual({ x: 273, y: 768.04, w: 234, h: 151.92 });
  });

  it('at 150% -50%（完全跑出）→ 中心被钳回视口边缘，内容不消失', () => {
    const result = layout(
      atRegion({ at: { x: ratio(1.5), y: ratio(-0.5) }, size: { w: ratio(0.6), h: ratio(0.18) } }),
      VIEWPORT,
    );
    // 150% → 中心 x 钳到 390；-50% → 中心 y 钳到 0
    expect(result.regions.tip).toEqual({ x: 273, y: -75.96, w: 234, h: 151.92 });
  });

  it('size 大于视口 → 钳到视口，并进 errors（不报错但 AI 看得到）', () => {
    const result = layout(
      atRegion({ at: { x: ratio(0.5), y: ratio(0.5) }, size: { w: ratio(2), h: ratio(2) } }),
      VIEWPORT,
    );
    expect(result.regions.tip).toEqual({ x: 0, y: 0, w: 390, h: 844 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("region 'tip' 的 size 超出视口");
  });

  it('有视口内边距时，at 相对内边距后的区域定位', () => {
    const result = layout(
      {
        padding: 10,
        regions: [
          {
            name: 'tip',
            edge: 'fill',
            layer: 'overlay',
            at: { x: ratio(0), y: ratio(0) },
            size: { w: 100, h: 50 },
          },
        ],
      },
      VIEWPORT,
    );
    // 内区 370×824、原点 (10,10)；中心钳在 (0,0) → x = 10 - 50 = -40、y = 10 - 25 = -15
    expect(result.regions.tip).toEqual({ x: -40, y: -15, w: 100, h: 50 });
  });
});
