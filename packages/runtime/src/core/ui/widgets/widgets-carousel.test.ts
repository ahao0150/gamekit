/**
 * `carousel` 组件测试（T21）：可见页绘制次数 + 指示点 + clip/平移。
 *
 * 团队硬规则：数「真实调用」——`renderItem` 被调了几次、指示点画了几个 arc。
 * 「100 页只画 2 页」是虚拟渲染的核心承诺，必须用调用次数钉住，不能只断言状态。
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Ctx2D } from '../../../platform/contract';
import type { Rect } from '../contract';
import { bindComponents } from '../bind';
import { layout } from '../layout';
import { parse } from '../parse';
import { DEFAULT_THEME } from '../components';
import type { DrawDeps } from '../components';
import { carousel } from './carousel';
import { createWidgetRegistry } from './index';
import { makeBox, makeDeps, makeEnv, render, spyCtx } from './test-helpers';

/** 记录 renderItem 收到的页与矩形。 */
const recorder = (): {
  seen: number[];
  rects: Rect[];
  renderItem: (ctx: Ctx2D, page: unknown, rect: Rect, index: number) => void;
} => {
  const seen: number[] = [];
  const rects: Rect[] = [];
  return {
    seen,
    rects,
    renderItem: (_ctx: Ctx2D, _page: unknown, rect: Rect, index: number): void => {
      seen.push(index);
      rects.push(rect);
    },
  };
};

const withData = (data: Record<string, unknown>): DrawDeps => ({ ...makeDeps(), data });

/** 390×600 的轮播框。 */
const box = makeBox(0, 0, 390, 600);
const pages = (count: number): readonly number[] => Array.from({ length: count }, (_, i) => i);

describe('measure', () => {
  it('回显可用框（尺寸由外层 size 决定）', () => {
    expect(carousel.def.measure(makeEnv(), box, {})).toEqual({ w: 390, h: 600 });
  });
});

describe('只画可见页', () => {
  it('3 页、offset=0：只调 1 次 renderItem，clip/save/translate 各 1 次', () => {
    const spy = spyCtx();
    const rec = recorder();
    carousel.def.draw(spy.ctx, box, {}, withData({ pages: pages(3), renderItem: rec.renderItem }));
    expect(rec.seen).toEqual([0]);
    expect(spy.clips).toBe(1);
    expect(spy.saves).toBe(1);
    expect(spy.restores).toBe(1);
    expect(spy.translates).toHaveLength(1);
    expect(spy.translates[0]?.[0]).toBeCloseTo(0, 10); // 对齐时不平移（-0 也算 0）
    expect(spy.translates[0]?.[1]).toBe(0);
    expect(spy.rects).toEqual([[0, 0, 390, 600]]); // clip 到自己的框
  });

  it('3 页、offset=100：画 2 页（当前页 + 露出的下一页）', () => {
    const spy = spyCtx();
    const rec = recorder();
    carousel.def.draw(spy.ctx, box, { offset: 100 }, withData({ pages: pages(3), renderItem: rec.renderItem }));
    expect(rec.seen).toEqual([0, 1]);
    expect(rec.rects[1]?.x).toBe(390); // 第 2 页在内容坐标 390
    expect(spy.translates).toEqual([[-100, 0]]);
  });

  it('100 页、offset=100：也只画 2 页（不是 100 次）', () => {
    const spy = spyCtx();
    const rec = recorder();
    carousel.def.draw(spy.ctx, box, { offset: 100 }, withData({ pages: pages(100), renderItem: rec.renderItem }));
    expect(rec.seen).toEqual([0, 1]);
  });

  it('index=3、offset=0：平移 -3 页，只画第 4 页', () => {
    const spy = spyCtx();
    const rec = recorder();
    carousel.def.draw(spy.ctx, box, { index: 3 }, withData({ pages: pages(5), renderItem: rec.renderItem }));
    expect(rec.seen).toEqual([3]);
    expect(spy.translates).toEqual([[-1170, 0]]); // -3 × 390
  });

  it('pageGap 生效：相邻页起点差 = box.w + gap', () => {
    const spy = spyCtx();
    const rec = recorder();
    carousel.def.draw(spy.ctx, box, { offset: 100, pageGap: 20 }, withData({ pages: pages(3), renderItem: rec.renderItem }));
    expect(rec.seen).toEqual([0, 1]);
    expect(rec.rects[1]?.x).toBe(410); // 390 + 20
  });
});

describe('指示点', () => {
  it('3 页画 3 个点，当前页更大且用 activeColor', () => {
    const spy = spyCtx();
    carousel.def.draw(spy.ctx, box, { index: 1 }, withData({ pages: pages(3), renderItem: () => undefined }));
    expect(spy.arcs).toHaveLength(3);
    // size=6、gap=8 → 总宽 34，startX = (390-34)/2 = 178；cy = 600 - 3 - 4 = 593
    expect(spy.arcs[0]?.slice(0, 2)).toEqual([181, 593]);
    expect(spy.arcs[0]?.[2]).toBeCloseTo(3, 10);
    expect(spy.arcs[1]?.slice(0, 2)).toEqual([195, 593]);
    expect(spy.arcs[1]?.[2]).toBeCloseTo(4.05, 10); // active：3 × 1.35
    expect(spy.arcs[2]?.slice(0, 2)).toEqual([209, 593]);
    expect(spy.arcs[2]?.[2]).toBeCloseTo(3, 10);
    expect(spy.pathFillColors).toEqual([DEFAULT_THEME.light, DEFAULT_THEME.primary, DEFAULT_THEME.light]);
  });

  it('indicator=false 不画点；count=1 也不画点（一个点没意义）', () => {
    const noIndicator = spyCtx();
    carousel.def.draw(noIndicator.ctx, box, { indicator: false }, withData({ pages: pages(3), renderItem: () => undefined }));
    expect(noIndicator.arcs).toHaveLength(0);
    const single = spyCtx();
    carousel.def.draw(single.ctx, box, {}, withData({ pages: pages(1), renderItem: () => undefined }));
    expect(single.arcs).toHaveLength(0);
  });

  it('指示点颜色可覆盖', () => {
    const spy = spyCtx();
    carousel.def.draw(
      spy.ctx,
      box,
      { index: 0, indicatorColor: '#111111', indicatorActiveColor: '#222222' },
      withData({ pages: pages(2), renderItem: () => undefined }),
    );
    expect(spy.pathFillColors).toEqual(['#222222', '#111111']);
  });
});

describe('空数据与越界', () => {
  it('没有任何页：零绘制（clip / translate 都不调）', () => {
    const spy = spyCtx();
    carousel.def.draw(spy.ctx, box, {}, withData({ pages: [] }));
    expect(spy.clips).toBe(0);
    expect(spy.saves).toBe(0);
    expect(spy.arcs).toHaveLength(0);
  });

  it('index 越界钳到最后一页；offset NaN 不崩', () => {
    const rec = recorder();
    carousel.def.draw(spyCtx().ctx, box, { index: 99 }, withData({ pages: pages(3), renderItem: rec.renderItem }));
    expect(rec.seen).toEqual([2]);
    expect(() =>
      carousel.def.draw(spyCtx().ctx, box, { offset: Number.NaN }, withData({ pages: pages(3), renderItem: () => undefined })),
    ).not.toThrow();
  });
});

describe('carousel.ui 校验（离线 ui.check 不接注册表，靠这条守住）', () => {
  const source = (): string => readFileSync(new URL('../../../../../../games/ui-demo/ui/carousel.ui', import.meta.url), 'utf8');
  const registry = createWidgetRegistry();
  const parsed = parse(source(), {
    knownComponents: registry.names(),
    componentProps: registry.propKeys(),
    fileName: 'carousel.ui',
  });

  it('组件名与参数键全部通过注册表校验', () => {
    expect(parsed.errors).toEqual([]);
    expect([...parsed.components]).toEqual(['label', 'carousel']);
  });

  it('bindComponents 无错，两视口布局无错且矩形在视口内', () => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const bound = bindComponents(parsed.spec, { registry, env: makeEnv(viewport.width, viewport.height) });
      expect(bound.errors, `${viewport.width} 绑定错误`).toEqual([]);
      const solved = layout(bound.spec, viewport);
      expect(solved.errors, `${viewport.width}×${viewport.height} 布局错误`).toEqual([]);
      for (const name of parsed.components) {
        const rect = solved.rects[name];
        if (rect === undefined) throw new Error(`${viewport.width} 下 ${name} 没有矩形`);
        expect(rect.w, `${name} 宽`).toBeGreaterThan(0);
        expect(rect.h, `${name} 高`).toBeGreaterThan(0);
      }
    }
  });
});
