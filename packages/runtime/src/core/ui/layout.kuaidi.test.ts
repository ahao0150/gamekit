/**
 * 布局核心 ↔ 真实游戏布局的对照测试。
 *
 * 为什么单独一个文件：AGENTS 铁律 2 要求单文件 ≤300 行，原语语义测试与对照测试
 * 是两件不同的事（一个钉语义，一个证表达力），拆开后各自都读得完。
 *
 * 对照方式：用新求解器（region / stack / size）重算《快递装车员》的 info / grid / cards，
 * 与它现有的 `computeLayout` 逐值比对，误差 ≤1px。
 * 测试里 import 游戏代码是只读的，不进任何构建产物。
 */

import { describe, expect, it } from 'vitest';
import { fill, fixed, layout, ratio } from './layout';
import type { LayoutSpec } from './layout';
import { computeLayout } from '../../../../../games/kuaidi-load/src/app/layout';
import { LEVELS } from '../../../../../games/kuaidi-load/src/app/levels';

const VIEW = { width: 390, height: 844 };
describe('对照《快递装车员》现有布局（±1px）', () => {
  // 第一关：cols=3 rows=2 parcels=2 —— 尺寸落在 390×844 上
  const level = LEVELS[0]!;
  const screen = {
    width: 390,
    height: 844,
    dpr: 2,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    orientation: 'portrait' as const,
  };
  const old = computeLayout(screen, level);

  // 旧实现里的中间量，原样抄出来构造等价 spec
  const cell = Math.min(screen.width * 0.84 / level.cols, screen.height * 0.32 / level.rows);
  const gridW = cell * level.cols;
  const gridH = cell * level.rows;
  const infoBottom = screen.height * 0.09 + screen.height * 0.13;
  const gridY = screen.height * 0.25;
  const cardsY = screen.height * 0.61;

  // 旧实现的卡片是「步进 0.9/n、宽 0.86/n」—— 卡片之间自带 0.04/n 的缝，
  // 这不是笔误：两张卡之间留缝才看得出是两张。等价 spec 要把这个缝写成 gap。
  const cardW = (screen.width * 0.86) / level.parcels.length;
  const cardGap = (screen.width * 0.9) / level.parcels.length - cardW;

  const spec: LayoutSpec = {
    regions: [
      { name: 'head', edge: 'top', height: ratio(0.09) },
      {
        name: 'info-band',
        edge: 'top',
        height: ratio(0.13),
        node: {
          stack: {
            direction: 'row',
            children: [{ size: ratio(0.05) }, { name: 'info', size: fill }, { size: ratio(0.05) }],
          },
        },
      },
      { name: 'gap-before-grid', edge: 'top', height: fixed(gridY - infoBottom) },
      {
        name: 'grid-band',
        edge: 'top',
        height: fixed(gridH),
        node: {
          stack: { direction: 'row', children: [{ size: fill }, { name: 'grid', size: fixed(gridW) }, { size: fill }] },
        },
      },
      { name: 'gap-before-cards', edge: 'top', height: fixed(cardsY - gridY - gridH) },
      {
        name: 'cards-band',
        edge: 'top',
        height: ratio(0.08),
        node: {
          stack: {
            direction: 'row',
            children: [
              { size: ratio(0.05) },
              {
                size: ratio(0.9),
                stack: {
                  direction: 'row',
                  gap: cardGap,
                  children: level.parcels.map((_, index) => ({ name: `card-${index}`, size: fixed(cardW) })),
                },
              },
              { size: fill },
            ],
          },
        },
      },
    ],
  };

  const result = layout(spec, VIEW);

  it('求解器没有报错', () => {
    expect(result.errors).toEqual([]);
  });

  it('info 面板：x/y/w/h 与旧实现一致', () => {
    const next = result.rects['info']!;
    expect(Math.abs(next.x - old.info.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(next.y - old.info.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(next.w - old.info.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(next.h - old.info.h)).toBeLessThanOrEqual(1);
    // 顺带把绝对值也钉住，防止两边一起漂
    expect(next.x).toBeCloseTo(19.5, 1);
    expect(next.y).toBeCloseTo(75.96, 1);
    expect(next.w).toBeCloseTo(351, 1);
    expect(next.h).toBeCloseTo(109.72, 1);
  });

  it('车厢网格：居中 + cell 尺寸与旧实现一致', () => {
    const next = result.rects['grid']!;
    expect(Math.abs(next.x - old.grid.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(next.y - old.grid.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(next.w - old.grid.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(next.h - old.grid.h)).toBeLessThanOrEqual(1);
    expect(next.x).toBeCloseTo(31.2, 1);
    expect(next.y).toBeCloseTo(211, 1);
    expect(next.w).toBeCloseTo(327.6, 1);
    expect(next.h).toBeCloseTo(218.4, 1);
  });

  it('包裹卡片：每张的 x/y/w/h 与旧实现逐个一致', () => {
    expect(old.cards).toHaveLength(level.parcels.length);
    old.cards.forEach((expected, index) => {
      const next = result.rects[`card-${index}`];
      expect(next).toBeDefined();
      expect(Math.abs((next?.x ?? 0) - expected.x)).toBeLessThanOrEqual(1);
      expect(Math.abs((next?.y ?? 0) - expected.y)).toBeLessThanOrEqual(1);
      expect(Math.abs((next?.w ?? 0) - expected.w)).toBeLessThanOrEqual(1);
      expect(Math.abs((next?.h ?? 0) - expected.h)).toBeLessThanOrEqual(1);
      expect(next?.y).toBeCloseTo(514.84, 1);
      expect(next?.h).toBeCloseTo(67.52, 1);
      expect(next?.w).toBeCloseTo(167.7, 1);
    });
    // 两张卡片的间距 = 旧实现的 0.04/n（不是 0）：x1 = x0 + w0 + gap
    const first = result.rects['card-0']!;
    const second = result.rects['card-1']!;
    expect(second.x).toBeCloseTo(first.x + first.w + cardGap, 1);
    expect(cardGap).toBeCloseTo(7.8, 1);
  });
});
