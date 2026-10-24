import { describe, expect, it } from 'vitest';
import type { Rect, WidgetProps } from './contract';
import { SCREENS, WIDGETS } from './fixtures';
import { clampInside, computeRect, createUi, EPSILON, insetRect, isInside } from './index';

const screen = (width: number, height: number): Rect => ({ x: 0, y: 0, w: width, h: height });

describe('computeRect：全部屏型都不越界', () => {
  it('12 种屏型 × 12 个 widget 都完整落在父矩形内', () => {
    expect(SCREENS.length).toBeGreaterThanOrEqual(10);
    const names = SCREENS.map((s) => s.name).join('|');
    expect(names).toContain('19.5:9');
    expect(names).toContain('4:3');

    for (const s of SCREENS) {
      const parent = screen(s.width, s.height);
      for (const w of WIDGETS) {
        const rect = computeRect(parent, w.props);
        expect(rect.w, `${s.name} / ${w.name} 宽度非法`).toBeGreaterThanOrEqual(0);
        expect(rect.h, `${s.name} / ${w.name} 高度非法`).toBeGreaterThanOrEqual(0);
        expect(isInside(rect, parent), `${s.name} / ${w.name} 越界：${JSON.stringify(rect)}`).toBe(true);
      }
    }
  });
});

describe('computeRect：三种模式', () => {
  const parent: Rect = { x: 0, y: 0, w: 1000, h: 600 };

  it('固定尺寸：尺寸原样，anchor/pivot/offset 决定位置', () => {
    const rect = computeRect(parent, {
      anchor: { x: 0.5, y: 0.5 },
      pivot: { x: 0.5, y: 0.5 },
      offset: { x: 10, y: -20 },
      size: { kind: 'fixed', w: 200, h: 100 },
    });
    expect(rect).toEqual({ x: 410, y: 230, w: 200, h: 100 });
  });

  it('比例尺寸：按父矩形宽高取比例', () => {
    const rect = computeRect(parent, {
      anchor: { x: 0, y: 0 },
      pivot: { x: 0, y: 0 },
      size: { kind: 'ratio', w: 0.25, h: 0.5 },
    });
    expect(rect).toEqual({ x: 0, y: 0, w: 250, h: 300 });
  });

  it('四边拉伸：位置由 margin 决定，anchor/pivot 不参与', () => {
    const rect = computeRect(parent, {
      anchor: { x: 1, y: 1 },
      pivot: { x: 1, y: 1 },
      margin: { top: 10, right: 20, bottom: 30, left: 40 },
    });
    expect(rect).toEqual({ x: 40, y: 10, w: 940, h: 560 });
  });

  it('size 与 margin 互斥：同时给直接打回', () => {
    expect(() =>
      computeRect(parent, {
        anchor: { x: 0, y: 0 },
        pivot: { x: 0, y: 0 },
        size: { kind: 'fixed', w: 10, h: 10 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    ).toThrow('互斥');
  });
});

describe('computeRect：anchor × pivot 九种组合', () => {
  it('位置符合 anchor 定位点 - pivot * 尺寸的公式', () => {
    const parent: Rect = { x: 40, y: 50, w: 1000, h: 600 };
    for (const a of [0, 0.5, 1]) {
      for (const p of [0, 0.5, 1]) {
        const rect = computeRect(parent, {
          anchor: { x: a, y: a },
          pivot: { x: p, y: p },
          size: { kind: 'fixed', w: 200, h: 100 },
        });
        expect(rect.x).toBeCloseTo(40 + a * 1000 - p * 200, 10);
        expect(rect.y).toBeCloseTo(50 + a * 600 - p * 100, 10);
        expect(rect.w).toBe(200);
        expect(rect.h).toBe(100);
      }
    }
  });
});

describe('computeRect：minSize / maxSize 夹取', () => {
  const parent: Rect = { x: 0, y: 0, w: 1000, h: 600 };
  const centred = { anchor: { x: 0.5, y: 0.5 }, pivot: { x: 0.5, y: 0.5 } } as const;

  it('minSize 放大过小的固定尺寸', () => {
    const rect = computeRect(parent, { ...centred, size: { kind: 'fixed', w: 10, h: 10 }, minSize: { x: 100, y: 50 } });
    expect(rect.w).toBe(100);
    expect(rect.h).toBe(50);
  });

  it('maxSize 收小过大的固定尺寸', () => {
    const rect = computeRect(parent, { ...centred, size: { kind: 'fixed', w: 5000, h: 5000 }, maxSize: { x: 100, y: 50 } });
    expect(rect.w).toBe(100);
    expect(rect.h).toBe(50);
  });

  it('min 与 max 冲突时以 maxSize 为准', () => {
    const rect = computeRect(parent, {
      ...centred,
      size: { kind: 'fixed', w: 400, h: 400 },
      minSize: { x: 500, y: 500 },
      maxSize: { x: 200, y: 200 },
    });
    expect(rect.w).toBe(200);
    expect(rect.h).toBe(200);
  });

  it('比例尺寸同样受夹取，且夹取后仍然居中', () => {
    const rect = computeRect(parent, {
      ...centred,
      size: { kind: 'ratio', w: 1, h: 1 },
      maxSize: { x: 300, y: 200 },
    });
    expect(rect).toEqual({ x: 350, y: 200, w: 300, h: 200 });
  });
});

describe('computeRect：纯函数', () => {
  it('同一输入两次调用结果完全一致，且不修改父矩形', () => {
    const parent: Rect = { x: 12, y: 24, w: 390, h: 844 };
    const props: WidgetProps = {
      anchor: { x: 0.5, y: 0.5 },
      pivot: { x: 0.5, y: 0.5 },
      size: { kind: 'ratio', w: 0.8, h: 0.2 },
    };
    const first = computeRect(parent, props);
    const second = computeRect(parent, props);
    expect(first).toEqual(second);
    expect(parent).toEqual({ x: 12, y: 24, w: 390, h: 844 });
  });

  it('非法数值不产生 NaN（回落为 0 / 默认）', () => {
    const rect = computeRect(
      { x: 0, y: 0, w: 100, h: 100 },
      {
        anchor: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
        pivot: { x: 0, y: 0 },
        size: { kind: 'fixed', w: -10, h: Number.NaN },
      },
    );
    expect(rect).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('createUi 暴露的三个函数与独立导出一致', () => {
    const ui = createUi();
    const props: WidgetProps = {
      anchor: { x: 1, y: 1 },
      pivot: { x: 1, y: 1 },
      size: { kind: 'fixed', w: 10, h: 10 },
    };
    const rect = ui.computeRect(screen(390, 844), props);
    expect(rect).toEqual(computeRect(screen(390, 844), props));
    expect(ui.isInside(rect, screen(390, 844))).toBe(true);
  });
});

describe('isInside / clampInside / insetRect', () => {
  const parent: Rect = { x: 0, y: 0, w: 390, h: 844 };

  it('贴边算在内，容差内的小数也算在内', () => {
    expect(isInside({ x: 0, y: 0, w: 390, h: 844 }, parent)).toBe(true);
    expect(isInside({ x: 0, y: 0, w: 390 + EPSILON / 2, h: 844 }, parent)).toBe(true);
    expect(isInside({ x: 0, y: 0, w: 390.5, h: 844 }, parent)).toBe(false);
  });

  it('越界断言：故意越界的 widget 被判出，clampInside 收回后落回父矩形', () => {
    const overflow = computeRect(parent, {
      anchor: { x: 1, y: 1 },
      pivot: { x: 1, y: 1 },
      offset: { x: 80, y: 120 },
      size: { kind: 'fixed', w: 100, h: 60 },
    });
    expect(isInside(overflow, parent)).toBe(false);
    const fixed = clampInside(overflow, parent);
    expect(isInside(fixed, parent)).toBe(true);
    expect(fixed).toEqual({ x: 290, y: 784, w: 100, h: 60 });
  });

  it('clampInside：比父矩形还大的矩形被缩到父矩形大小', () => {
    const fixed = clampInside({ x: -50, y: -50, w: 999, h: 999 }, parent);
    expect(fixed).toEqual({ x: 0, y: 0, w: 390, h: 844 });
  });

  it('insetRect 四边内缩，负内缩当 0', () => {
    expect(insetRect({ x: 10, y: 20, w: 100, h: 80 }, { top: 5, right: 10, bottom: 15, left: 20 })).toEqual({
      x: 30,
      y: 25,
      w: 70,
      h: 60,
    });
    expect(insetRect({ x: 0, y: 0, w: 10, h: 10 }, { top: -5, right: 20, bottom: 0, left: 0 })).toEqual({
      x: 0,
      y: 0,
      w: 0,
      h: 10,
    });
  });
});
