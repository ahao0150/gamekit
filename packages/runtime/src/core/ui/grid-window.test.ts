import { expect, it } from 'vitest';
import { gridWindow } from './grid-window';

it('空窗口：cols / count / cellH / viewH 任一非法都退化成全 0（不抛错）', () => {
  const empty = { rowStart: 0, rowEnd: 0, offsetY: 0, totalH: 0 };
  expect(gridWindow({ scrollTop: 0, count: 10, cols: 0, cellH: 50, viewH: 200 })).toEqual(empty);
  expect(gridWindow({ scrollTop: 0, count: 10, cols: -4, cellH: 50, viewH: 200 })).toEqual(empty);
  expect(gridWindow({ scrollTop: 0, count: 0, cols: 4, cellH: 50, viewH: 200 })).toEqual(empty);
  expect(gridWindow({ scrollTop: 0, count: -3, cols: 4, cellH: 50, viewH: 200 })).toEqual(empty);
  expect(gridWindow({ scrollTop: 0, count: 10, cols: 4, cellH: 0, viewH: 200 })).toEqual(empty);
  expect(gridWindow({ scrollTop: 0, count: 10, cols: 4, cellH: 50, viewH: 0 })).toEqual(empty);
});

it('行数：最后一行不满也算一行（count=10 / cols=4 → 3 行）', () => {
  // 3 行 × 50 + 2 × 5 = 160
  const win = gridWindow({ scrollTop: 0, count: 10, cols: 4, cellH: 50, gapY: 5, viewH: 400 });
  expect(win.totalH).toBe(160);
  expect(win.rowStart).toBe(0);
  expect(win.rowEnd).toBe(3);
});

it('itemColor 无关：totalH = 行数×cellH + (行数-1)×gapY，末尾不留 gap', () => {
  // 5 行：count=20 / cols=4 → 5×50 + 4×5 = 270
  expect(gridWindow({ scrollTop: 0, count: 20, cols: 4, cellH: 50, gapY: 5, viewH: 100 }).totalH).toBe(270);
  // 末尾不留 gap：count=4 / cols=4 → 1 行 → totalH = 50（不是 55）
  expect(gridWindow({ scrollTop: 0, count: 4, cols: 4, cellH: 50, gapY: 5, viewH: 100 }).totalH).toBe(50);
});

it('视口只装 3 行：rowStart=0、rowEnd=3，offsetY=0', () => {
  // pitch=55，viewH=165 正好 3 行
  const win = gridWindow({ scrollTop: 0, count: 1000, cols: 4, cellH: 50, gapY: 5, viewH: 165 });
  expect(win).toEqual({ rowStart: 0, rowEnd: 3, offsetY: 0, totalH: 1000 / 4 * 55 - 5 });
});

it('滚动 1 行（55px）：rowStart=1，offsetY=0（正好整行滚过）', () => {
  const win = gridWindow({ scrollTop: 55, count: 100, cols: 4, cellH: 50, gapY: 5, viewH: 165 });
  expect(win.rowStart).toBe(1);
  expect(win.rowEnd).toBe(4);
  expect(win.offsetY).toBe(0);
});

it('滚动半行（20px）：rowStart=0，offsetY=-20（首行部分露出），rowEnd 覆盖满视口', () => {
  const win = gridWindow({ scrollTop: 20, count: 100, cols: 4, cellH: 50, gapY: 5, viewH: 165 });
  expect(win.rowStart).toBe(0);
  expect(win.offsetY).toBe(-20);
  // (20 + 165) / 55 = 3.36 → ceil 4 行（覆盖满视口）
  expect(win.rowEnd).toBe(4);
});

it('scrollTop 钳制：负数当 0、超过上限当上限', () => {
  const base = { count: 100, cols: 4, cellH: 50, gapY: 5, viewH: 165 };
  const clampedTop = gridWindow({ ...base, scrollTop: -999 }) ;
  expect(clampedTop).toEqual(gridWindow({ ...base, scrollTop: 0 }));
  // 内容 100/4=25 行 → 25×55-5 = 1370；max = 1370-165 = 1205
  const atBottom = gridWindow({ ...base, scrollTop: 1205 });
  expect(atBottom.rowEnd).toBe(25);
  expect(gridWindow({ ...base, scrollTop: 99999 })).toEqual(atBottom);
});

it('offsetY 恒 ≤ 0（契约：首行顶边不会落在视口顶下方）', () => {
  for (const scrollTop of [0, 1, 27, 55, 56, 111, 500, 1205]) {
    const win = gridWindow({ scrollTop, count: 200, cols: 3, cellH: 40, gapY: 8, viewH: 200 });
    expect(win.offsetY, `scrollTop=${scrollTop}`).toBeLessThanOrEqual(0);
  }
});

it('cols > count：一行就装下（col 约束不制造空行）', () => {
  const win = gridWindow({ scrollTop: 0, count: 3, cols: 8, cellH: 60, gapY: 10, viewH: 300 });
  expect(win.rowStart).toBe(0);
  expect(win.rowEnd).toBe(1);
  expect(win.totalH).toBe(60);
});

it('cols=1：退化成纵向列表（每行一项）', () => {
  const win = gridWindow({ scrollTop: 0, count: 5, cols: 1, cellH: 40, gapY: 0, viewH: 80 });
  expect(win.rowEnd).toBe(2);
  expect(win.totalH).toBe(200);
});

it('viewH 大于内容总高：一屏看全，rowEnd = 行数', () => {
  const win = gridWindow({ scrollTop: 0, count: 10, cols: 4, cellH: 50, gapY: 5, viewH: 5000 });
  expect(win.rowStart).toBe(0);
  expect(win.rowEnd).toBe(3);
});

it('非整数输入容错：count / cols 取 floor，gapY 负数当 0', () => {
  const win = gridWindow({ scrollTop: 0, count: 10.9, cols: 4.8, cellH: 50, gapY: -5, viewH: 200 });
  expect(win.rowEnd).toBe(3); // ceil(10 / 4) = 3 行
  expect(win.totalH).toBe(150); // 3 × 50，负 gap 当 0
});
