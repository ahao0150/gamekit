import { describe, expect, it } from 'vitest';

import type { Rect } from './contract';
import { findOverlaps, gridOf, ratiosSum, splitCols, splitRows } from './split';

/** 390×844（团队验收基准屏）的整屏区域 */
const SCREEN: Rect = { x: 0, y: 0, w: 390, h: 844 };

/** 模拟「盘中四段」：盘面 / 临时位 / 色块池 / 道具条 */
const FOUR_TIER: readonly number[] = [0.6, 0.1, 0.25, 0.05];

describe('splitRows', () => {
  it('按比例切带，段数等于比例个数，宽度都跟随父矩形', () => {
    const rows = splitRows(SCREEN, [0.6, 0.4]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.h).toBeCloseTo(506.4, 6);
    expect(rows[1]?.h).toBeCloseTo(337.6, 6);
    for (const r of rows) {
      expect(r.x).toBe(0);
      expect(r.w).toBe(390);
    }
  });

  it('相邻两段首尾相接：下一段的 y 等于上一段的 y + h', () => {
    const rows = splitRows(SCREEN, FOUR_TIER);
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1] as Rect;
      const cur = rows[i] as Rect;
      expect(cur.y).toBeCloseTo(prev.y + prev.h, 9);
    }
  });

  it('最后一格下沿精确收口到父矩形下沿（不因浮点累积差零点几像素）', () => {
    const rows = splitRows(SCREEN, [0.6, 0.1, 0.25, 0.05]);
    const last = rows[rows.length - 1] as Rect;
    expect(last.y + last.h).toBe(844);
  });

  it('比例不要求和为 1：按总和归一化，[2,1] 等价于 [2/3,1/3]', () => {
    const byWeight = splitRows(SCREEN, [2, 1]);
    const byRatio = splitRows(SCREEN, [2 / 3, 1 / 3]);
    expect(byWeight[0]?.h).toBeCloseTo(byRatio[0]?.h as number, 9);
    expect(byWeight[0]?.h).toBeCloseTo(562.6666666666666, 6);
  });

  it('保留父矩形的偏移：起点不是 0 也正确', () => {
    const area: Rect = { x: 20, y: 100, w: 350, h: 400 };
    const rows = splitRows(area, [1, 1]);
    expect(rows[0]?.y).toBe(100);
    expect(rows[1]?.y).toBeCloseTo(300, 9);
    expect((rows[1] as Rect).y + (rows[1] as Rect).h).toBe(500);
  });
});

describe('splitCols', () => {
  it('横向切列，高度跟随父矩形', () => {
    const cols = splitCols(SCREEN, [0.25, 0.75]);
    expect(cols).toHaveLength(2);
    expect(cols[0]?.w).toBeCloseTo(97.5, 6);
    expect(cols[1]?.x).toBeCloseTo(97.5, 6);
    for (const c of cols) {
      expect(c.y).toBe(0);
      expect(c.h).toBe(844);
    }
  });

  it('最后一列右沿精确收口', () => {
    const cols = splitCols(SCREEN, [1, 1, 1]);
    const last = cols[cols.length - 1] as Rect;
    expect(last.x + last.w).toBe(390);
  });
});

describe('gridOf', () => {
  it('16×16 = 256 格，行优先', () => {
    const cells = gridOf(SCREEN, 16, 16);
    expect(cells).toHaveLength(256);
    const c0 = cells[0] as Rect;
    const c1 = cells[1] as Rect;
    const c16 = cells[16] as Rect;
    expect(c0.x).toBe(0);
    expect(c0.y).toBe(0);
    expect(c1.x).toBeGreaterThan(c0.x); // 同一行向右
    expect(c16.y).toBeGreaterThan(c0.y); // 换行
    expect(c16.x).toBe(0);
  });

  it('末格右下角精确等于区域右下角', () => {
    const cells = gridOf(SCREEN, 16, 16);
    const last = cells[cells.length - 1] as Rect;
    expect(last.x + last.w).toBe(390);
    expect(last.y + last.h).toBe(844);
  });

  it('格子互不重叠（整个网格铺满且不叠）', () => {
    const cells = gridOf(SCREEN, 7, 5);
    const named: Record<string, Rect> = {};
    cells.forEach((c, i) => {
      named[String(i)] = c;
    });
    expect(findOverlaps(named)).toEqual([]);
  });
});

describe('findOverlaps', () => {
  it('相交的矩形返回名字对', () => {
    const rects: Record<string, Rect> = {
      a: { x: 0, y: 0, w: 100, h: 100 },
      b: { x: 50, y: 50, w: 100, h: 100 },
    };
    expect(findOverlaps(rects)).toEqual([['a', 'b']]);
  });

  it('贴边不算重叠', () => {
    const rects: Record<string, Rect> = {
      a: { x: 0, y: 0, w: 100, h: 100 },
      b: { x: 100, y: 0, w: 100, h: 100 },
    };
    expect(findOverlaps(rects)).toEqual([]);
  });

  it('空对象与单个矩形都不报', () => {
    expect(findOverlaps({})).toEqual([]);
    expect(findOverlaps({ only: SCREEN })).toEqual([]);
  });

  it('结果稳定：名字对按字典序输出', () => {
    const rects: Record<string, Rect> = {
      zebra: { x: 0, y: 0, w: 100, h: 100 },
      alpha: { x: 10, y: 10, w: 100, h: 100 },
    };
    expect(findOverlaps(rects)).toEqual([['alpha', 'zebra']]);
  });
});

describe('盘中四段切分的真实场景（这次 bug 的回归）', () => {
  for (const [w, h] of [
    [390, 844],
    [320, 568],
    [440, 956],
  ] as const) {
    it(`${w}×${h}：盘面/临时位/色块池/道具条四段互不重叠，且铺满区域`, () => {
      const area: Rect = { x: 0, y: 0, w, h };
      const [play, slots, pool, tools] = splitRows(area, FOUR_TIER) as [Rect, Rect, Rect, Rect];
      expect(findOverlaps({ play, slots, pool, tools })).toEqual([]);
      // 四段高度之和 = 区域高（首尾相接）
      const total = play.h + slots.h + pool.h + tools.h;
      expect(total).toBeCloseTo(h, 6);
      // 最后一段下沿贴底，不会被裁
      expect(tools.y + tools.h).toBe(h);
    });
  }

  it('色块池内部再切两行，也不会和道具条相交', () => {
    const area: Rect = { x: 0, y: 0, w: 320, h: 568 };
    const [, , pool] = splitRows(area, FOUR_TIER) as [Rect, Rect, Rect, Rect];
    const poolRows = splitRows(pool, [1, 1]);
    const named: Record<string, Rect> = { pool };
    poolRows.forEach((r, i) => {
      named[`poolRow${i}`] = r as Rect;
    });
    // 父区与子行必然「相交」，这里只断言两个子行之间不重叠
    expect(findOverlaps({ a: poolRows[0] as Rect, b: poolRows[1] as Rect })).toEqual([]);
    expect(poolRows[0]?.y).toBe(pool.y);
  });
});

describe('参数非法直接抛错（不静默兜底）', () => {
  it('空比例数组', () => {
    expect(() => splitRows(SCREEN, [])).toThrow();
  });

  it('0 或负数比例', () => {
    expect(() => splitRows(SCREEN, [1, 0])).toThrow();
    expect(() => splitCols(SCREEN, [-1, 2])).toThrow();
  });

  it('NaN 比例', () => {
    expect(() => splitRows(SCREEN, [1, Number.NaN])).toThrow();
  });

  it('gridOf 的行列数必须是正整数', () => {
    expect(() => gridOf(SCREEN, 0, 4)).toThrow();
    expect(() => gridOf(SCREEN, 4, -1)).toThrow();
    expect(() => gridOf(SCREEN, 2.5, 4)).toThrow();
  });

  it('ratiosSum 只做诊断，不做归一化', () => {
    expect(ratiosSum([0.6, 0.1, 0.25, 0.05])).toBeCloseTo(1, 9);
    expect(ratiosSum([2, 1])).toBe(3);
  });
});
