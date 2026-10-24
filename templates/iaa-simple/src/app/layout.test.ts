import { describe, expect, it } from 'vitest';
import { isInside } from './deps';
import type { Layout } from './layout';
import { computeLayout, hitTest, scoreFillRect } from './layout';

const SCREENS = [
  { name: '390×844（19.5:9）', w: 390, h: 844 },
  { name: '320×480（小屏）', w: 320, h: 480 },
  { name: '1024×768（4:3）', w: 1024, h: 768 },
  { name: '1000×300（超宽）', w: 1000, h: 300 },
];

const layoutFor = (w: number, h: number, reserveBanner: boolean): Layout =>
  computeLayout({
    screen: { x: 0, y: 0, w, h },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    reserveBanner,
  });

const rectsOf = (layout: Layout): Array<[string, Layout[keyof Layout]]> => [
  ['scoreBar', layout.scoreBar],
  ['tapButton', layout.tapButton],
  ['rewardedButton', layout.rewardedButton],
  ['bannerSlot', layout.bannerSlot],
  ['hintArea', layout.hintArea],
];

describe('computeLayout（纯函数）', () => {
  it('四种屏型 × 有无 banner：widget 全部落在安全区内且尺寸非负', () => {
    for (const screen of SCREENS) {
      for (const reserveBanner of [false, true]) {
        const layout = layoutFor(screen.w, screen.h, reserveBanner);
        for (const [name, rect] of rectsOf(layout)) {
          if (name === 'bannerSlot' && !reserveBanner) continue; // 无广告能力时为零矩形
          expect(rect.w, `${screen.name} / ${name} 宽`).toBeGreaterThan(0);
          expect(rect.h, `${screen.name} / ${name} 高`).toBeGreaterThan(0);
          expect(isInside(rect, layout.safe), `${screen.name} / ${name} 越界`).toBe(true);
        }
      }
    }
  });

  it('主按钮与激励按钮不重叠', () => {
    for (const screen of SCREENS) {
      const { tapButton: a, rewardedButton: b } = layoutFor(screen.w, screen.h, true);
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${screen.name} 按钮重叠`).toBe(false);
    }
  });

  it('无 banner 能力时 bannerSlot 是零矩形，且分数条更靠底', () => {
    const without = layoutFor(390, 844, false);
    const withBanner = layoutFor(390, 844, true);
    expect(without.bannerSlot).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(without.scoreBar.y).toBeGreaterThan(withBanner.scoreBar.y);
  });

  it('安全区（刘海）生效：所有 widget 在 inset 之内', () => {
    const layout = computeLayout({
      screen: { x: 0, y: 0, w: 390, h: 844 },
      insets: { top: 44, right: 0, bottom: 34, left: 0 },
      reserveBanner: true,
    });
    expect(layout.safe.y).toBe(44);
    expect(layout.safe.h).toBe(844 - 78);
    expect(layout.hintArea.y).toBeGreaterThanOrEqual(44);
  });

  it('同一输入两次调用结果一致（纯函数）', () => {
    expect(layoutFor(390, 844, true)).toEqual(layoutFor(390, 844, true));
  });
});

describe('scoreFillRect / hitTest', () => {
  const bar = { x: 10, y: 100, w: 200, h: 10 };

  it('分数比例夹到 0..1', () => {
    expect(scoreFillRect(bar, 0, 10).w).toBe(0);
    expect(scoreFillRect(bar, 5, 10).w).toBe(100);
    expect(scoreFillRect(bar, 10, 10).w).toBe(200);
    expect(scoreFillRect(bar, 99, 10).w).toBe(200);
    expect(scoreFillRect(bar, -3, 10).w).toBe(0);
    expect(scoreFillRect(bar, 5, 0).w).toBe(0);
  });

  it('点击命中判定：按钮内命中、按钮外不命中、零矩形永不命中', () => {
    const layout = layoutFor(390, 844, false);
    const { tapButton } = layout;
    expect(hitTest(tapButton, { x: tapButton.x + tapButton.w / 2, y: tapButton.y + tapButton.h / 2 })).toBe(true);
    expect(hitTest(tapButton, { x: 0, y: 0 })).toBe(false);
    expect(hitTest({ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0 })).toBe(false);
  });
});
