/**
 * `listWindow` 单测（T16）：边界口径逐条锁死 + 与暴力遍历对拍 + O(1) 性能。
 *
 * 断言的是**真实数值**（不是「大概对」）：虚拟列表一旦算错一项，表现是
 * 「滚动时底部露白 / 少画一行 / 多画一行」，肉眼看不出是哪一项错，只能靠数字锁住。
 */

import { describe, expect, it } from 'vitest';
import { listWindow } from './list-window';

const base = { itemH: 56, viewH: 448 } as const; // 8 项刚好装满视口

describe('常规位置', () => {
  it('顶部：start=0、end=8、offsetY=0、totalH=5600', () => {
    expect(listWindow({ ...base, scrollTop: 0, count: 100 })).toEqual({
      start: 0,
      end: 8,
      offsetY: 0,
      totalH: 5600,
    });
  });

  it('中间整对齐：滚到第 5 项顶，offsetY=0', () => {
    expect(listWindow({ ...base, scrollTop: 280, count: 100 })).toEqual({
      start: 5,
      end: 13,
      offsetY: 0,
      totalH: 5600,
    });
  });

  it('中间不对齐：offsetY 为负，且两边部分可见项都算进来', () => {
    const win = listWindow({ ...base, scrollTop: 300, count: 100 });
    expect(win.start).toBe(5);
    expect(win.offsetY).toBe(-20); // 第 5 项顶已滚出视口 20px
    expect(win.end).toBe(14); // 第 13 项只露一条也算
  });

  it('底部：scrollTop 超大时钳到最大滚动位，最后一项贴底', () => {
    const win = listWindow({ ...base, scrollTop: 99999, count: 100 });
    expect(win.start).toBe(92);
    expect(win.end).toBe(100);
    expect(win.offsetY).toBe(0); // 5152 = 92 × 56，正好整对齐
  });
});

describe('边界', () => {
  it('0 项：空窗口', () => {
    expect(listWindow({ ...base, scrollTop: 0, count: 0 })).toEqual({ start: 0, end: 0, offsetY: 0, totalH: 0 });
  });

  it('1 项：start=0、end=1、totalH 只有一项高', () => {
    expect(listWindow({ ...base, scrollTop: 0, count: 1 })).toEqual({ start: 0, end: 1, offsetY: 0, totalH: 56 });
  });

  it('scrollTop 越界（负数 / NaN）当 0 处理，不崩', () => {
    expect(listWindow({ ...base, scrollTop: -500, count: 10 }).start).toBe(0);
    expect(listWindow({ ...base, scrollTop: Number.NaN, count: 10 }).start).toBe(0);
    expect(listWindow({ ...base, scrollTop: Number.NaN, count: 10 }).offsetY).toBe(0);
  });

  it('itemH / viewH / count 非法时返回空窗口（不做除法）', () => {
    for (const bad of [
      { ...base, scrollTop: 0, count: 10, itemH: 0 },
      { ...base, scrollTop: 0, count: 10, itemH: -56 },
      { ...base, scrollTop: 0, count: 10, itemH: Number.NaN },
      { ...base, scrollTop: 0, count: 10, viewH: 0 },
      { ...base, scrollTop: 0, count: 10, viewH: -1 },
      { ...base, scrollTop: 0, count: -3 },
    ]) {
      expect(listWindow(bad), JSON.stringify(bad)).toEqual({ start: 0, end: 0, offsetY: 0, totalH: 0 });
    }
  });
});

describe('带 gap', () => {
  const options = { itemH: 56, gap: 8, viewH: 100, count: 3 } as const;

  it('totalH 不含末尾 gap：3 × 56 + 2 × 8 = 184', () => {
    expect(listWindow({ ...options, scrollTop: 0 }).totalH).toBe(184);
  });

  it('pitch = itemH + gap：scrollTop=64 时从第 2 项开始', () => {
    expect(listWindow({ ...options, scrollTop: 0 })).toMatchObject({ start: 0, end: 2, offsetY: 0 });
    expect(listWindow({ ...options, scrollTop: 64 })).toMatchObject({ start: 1, end: 3, offsetY: 0 });
  });

  it('滚到底（maxScroll = 184 - 100 = 84）：start=1、offsetY=-20', () => {
    const win = listWindow({ ...options, scrollTop: 84 });
    expect(win).toMatchObject({ start: 1, end: 3, offsetY: -20, totalH: 184 });
  });
});

describe('超长列表', () => {
  it('10000 项：窗口只覆盖视口内的 8 项，totalH 正确', () => {
    const win = listWindow({ ...base, scrollTop: 0, count: 10000 });
    expect(win.end - win.start).toBe(8);
    expect(win.totalH).toBe(560000);
    const mid = listWindow({ ...base, scrollTop: 280000, count: 10000 });
    expect(mid.end - mid.start).toBe(8);
    expect(mid.start).toBe(5000);
  });

  it('与暴力遍历对拍：60 个滚动位置逐项一致', () => {
    // 参考实现：遍历所有项，取与 [top, top+viewH) 相交的首尾（故意 O(n)，只用它对拍）
    const brute = (count: number, itemH: number, gap: number, viewH: number, scrollTop: number): [number, number] => {
      const pitch = itemH + gap;
      const totalH = count * itemH + (count - 1) * gap;
      const top = Math.min(Math.max(scrollTop, 0), Math.max(0, totalH - viewH));
      let first = -1;
      let last = -1;
      for (let i = 0; i < count; i += 1) {
        const y = i * pitch;
        if (y < top + viewH && y + itemH > top) {
          if (first < 0) first = i;
          last = i;
        }
      }
      return [first, last + 1];
    };
    for (const gap of [0, 8, 3.5]) {
      for (let step = 0; step <= 60; step += 1) {
        const scrollTop = step * 97.3; // 故意用非整数步长，覆盖半项/半 gap
        const win = listWindow({ ...base, gap, scrollTop, count: 100 });
        const [first, last] = brute(100, 56, gap, 448, scrollTop);
        // start 允许比「第一个真正相交的项」早 1 项（有 gap 时的取整口径），但绝不能更晚：
        // 更晚就会漏画视口顶部那一项（露白）。gap = 0 时必须严格相等。
        expect(win.start, `gap=${gap} scrollTop=${scrollTop}`).toBeLessThanOrEqual(first);
        expect(first - win.start, `gap=${gap} scrollTop=${scrollTop}`).toBeLessThanOrEqual(gap > 0 ? 1 : 0);
        // end 必须正好盖住最后一个相交项（少画一项底部就露白）
        expect(win.end, `gap=${gap} scrollTop=${scrollTop}`).toBe(last);
        // offsetY 必须 ≤ 0 且不超过一个步长（否则会画出额外空白）
        expect(win.offsetY).toBeLessThanOrEqual(0);
        expect(win.offsetY).toBeGreaterThan(-(56 + gap));
      }
    }
  });

  it('O(1)：10000 项算 1000 次，平均耗时远低于一次遍历', () => {
    const run = (count: number): number => {
      const started = performance.now();
      for (let i = 0; i < 1000; i += 1) listWindow({ ...base, scrollTop: i * 13, count });
      return performance.now() - started;
    };
    run(10000); // 预热，避开首次 JIT 抖动
    const elapsed = run(10000);
    // O(n) 实现 1000 次 × 10000 项 = 1e7 次迭代，实测要 20ms 以上；O(1) 在 1ms 内
    expect(elapsed, `1000 次换算耗时 ${elapsed.toFixed(2)}ms`).toBeLessThan(20);
  });
});
