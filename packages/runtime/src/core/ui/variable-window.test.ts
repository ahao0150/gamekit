/**
 * 变高窗口的定位契约（前缀和 + 二分）。
 *
 * 最关键的一条是「不线性扫」：用 Proxy 数**数组下标读取次数**，
 * 断言建索引之后每次定位都读不到一项 —— 这不是形式主义，1 万项的聊天记录
 * 每帧全量扫一遍就是掉帧。
 */

import { describe, expect, it } from 'vitest';
import { buildVariableIndex, listIndexAtVariable, variableWindow } from './variable-window';
import type { Rect } from './contract';

const RECT: Rect = { x: 0, y: 100, w: 300, h: 200 };

/** 数下标读取次数的数组桩。 */
const countingHeights = (heights: readonly number[]): { readonly proxy: readonly number[]; readonly reads: () => number } => {
  let reads = 0;
  const proxy = new Proxy([...heights], {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) reads += 1;
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
  return { proxy, reads: () => reads };
};

describe('buildVariableIndex', () => {
  it('前缀和与总高：offsets[0]=0，totalH 不含末尾 gap', () => {
    const index = buildVariableIndex([10, 20, 30], 5);
    expect(index.offsets).toEqual([0, 15, 40]);
    expect(index.totalH).toBe(10 + 5 + 20 + 5 + 30); // 65，末尾不加 gap
  });

  it('非法高度按 0、非法 gap 按 0（不崩、不产生 NaN）', () => {
    const index = buildVariableIndex([10, Number.NaN, -3], Number.NaN);
    expect(index.heights).toEqual([10, 0, 0]);
    expect(index.gap).toBe(0);
    expect(index.offsets).toEqual([0, 10, 10]);
    expect(index.totalH).toBe(10);
  });

  it('空数组：totalH=0、offsets=[]', () => {
    expect(buildVariableIndex([]).totalH).toBe(0);
    expect(buildVariableIndex([]).offsets).toEqual([]);
  });
});

describe('variableWindow', () => {
  const index = buildVariableIndex([100, 100, 100, 100, 100], 0);

  it('未滚动：start=0，end 覆盖满视口（含部分可见项）', () => {
    const win = variableWindow(index, 0, 250);
    expect(win.start).toBe(0);
    expect(win.end).toBe(3); // 第 0/1/2 项覆盖 0–300，视口 0–250
    expect(win.offsetY).toBe(0);
    expect(win.totalH).toBe(500);
  });

  it('滚到中间：start 是「顶边在视口上方的最后一项」，offsetY ≤ 0', () => {
    const win = variableWindow(index, 150, 200);
    expect(win.start).toBe(1); // 第 1 项顶边 100 ≤ 150
    expect(win.offsetY).toBe(-50); // 100 − 150
    expect(win.end).toBe(4); // 顶边 400 > 150+200=350 的第一项是 4 → 不含
  });

  it('scrollTop 越界钳到端头（负数 / 超大）', () => {
    expect(variableWindow(index, -999, 200).start).toBe(0);
    const bottom = variableWindow(index, 99999, 200);
    expect(bottom.start).toBe(3); // 最大滚动 = 500−200 = 300 → 第 3 项（顶边 300）
    expect(bottom.offsetY).toBe(0);
  });

  it('空列表 / 零视口 → 空窗口', () => {
    expect(variableWindow(buildVariableIndex([]), 0, 200)).toEqual({ start: 0, end: 0, offsetY: 0, totalH: 0 });
    expect(variableWindow(index, 0, 0)).toEqual({ start: 0, end: 0, offsetY: 0, totalH: 500 });
  });
});

describe('listIndexAtVariable', () => {
  const index = buildVariableIndex([40, 60, 80], 10);
  // 项 0: y 0–40，gap 40–50，项 1: 50–110，gap 110–120，项 2: 120–200

  it('点在项上 → 返回该项下标', () => {
    expect(listIndexAtVariable({ x: 10, y: 100 + 20 }, RECT, 0, index)).toBe(0);
    expect(listIndexAtVariable({ x: 10, y: 100 + 60 }, RECT, 0, index)).toBe(1);
    expect(listIndexAtVariable({ x: 10, y: 100 + 150 }, RECT, 0, index)).toBe(2);
  });

  it('点在项与项之间的 gap 上 → null（不硬凑到相邻项）', () => {
    expect(listIndexAtVariable({ x: 10, y: 100 + 45 }, RECT, 0, index)).toBeNull();
    expect(listIndexAtVariable({ x: 10, y: 100 + 115 }, RECT, 0, index)).toBeNull();
  });

  it('点在列表外 / 内容之外 → null', () => {
    expect(listIndexAtVariable({ x: -5, y: 150 }, RECT, 0, index)).toBeNull();
    expect(listIndexAtVariable({ x: 10, y: 50 }, RECT, 0, index)).toBeNull(); // 在 rect 上方
    expect(listIndexAtVariable({ x: 10, y: 100 + 250 }, RECT, 0, index)).toBeNull(); // 超过 totalH
  });

  it('滚动后命中的是同一项（坐标随 scrollTop 平移）', () => {
    // 视口只有 100 高（内容 200，可滚 100）；滚 50 后，屏幕顶 y=100 对应内容 y=50 → 项 1 起点
    const view: Rect = { ...RECT, h: 100 };
    expect(listIndexAtVariable({ x: 10, y: 100 }, view, 50, index)).toBe(1);
    // 同一屏幕位置、不滚动时命中的是项 0
    expect(listIndexAtVariable({ x: 10, y: 100 }, view, 0, index)).toBe(0);
  });

  it('也接受裸 heights 数组（便捷写法，内部建一次索引）', () => {
    expect(listIndexAtVariable({ x: 10, y: 100 + 20 }, RECT, 0, [40, 60, 80], 10)).toBe(0);
  });

  it('1 万项：建索引后定位**不再读任何一项**（不是线性扫）', () => {
    const { proxy, reads } = countingHeights(Array.from({ length: 10000 }, () => 20));
    const built = buildVariableIndex(proxy, 0);
    const afterBuild = reads();
    expect(afterBuild).toBeGreaterThanOrEqual(10000); // 建索引确实是 O(n)

    for (let i = 0; i < 200; i += 1) {
      const y = 100 + ((i * 37) % 190);
      variableWindow(built, i * 13, 200);
      listIndexAtVariable({ x: 10, y }, RECT, i * 13, built);
    }
    // 建完之后 200 次定位一次都没再读 heights → 二分只碰 offsets
    expect(reads()).toBe(afterBuild);
  });
});
