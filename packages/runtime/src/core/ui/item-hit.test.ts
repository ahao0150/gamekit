import { expect, it } from 'vitest';
import { gridIndexAt, listIndexAt } from './item-hit';
import { cellWidth, grid } from './widgets/grid';
import { makeBox, makeDeps, render } from './widgets/test-helpers';
import type { Rect } from './contract';
import type { DrawDeps } from './components';

// ---------------------------------------------------------------------------
// listIndexAt
// ---------------------------------------------------------------------------

/** 列表容器：100..500，20 项，itemH 56 + gap 8（pitch 64）。 */
const LIST: Rect = makeBox(0, 100, 300, 400);
const LIST_OPTS = { itemH: 56, gap: 8, count: 20 };

it('list：点第 0 项左上角 → 0；点最后一项右下角 → count-1', () => {
  expect(listIndexAt({ x: 0, y: 100 }, LIST, 0, LIST_OPTS)).toBe(0);
  // 第 19 项 y = 100 + 19×64 = 1316（超出容器 500），所以用容器内的最后一项：容器 400 高只装 6 项
  const lastVisible = Math.floor((LIST.y + LIST.h - LIST.y) / 64) - 1; // 6
  const y = LIST.y + lastVisible * 64 + 55;
  expect(listIndexAt({ x: 299, y }, LIST, 0, LIST_OPTS)).toBe(lastVisible);
});

it('list：点在第 0/1 项内分别命中 0/1（逐项边界）', () => {
  expect(listIndexAt({ x: 10, y: 100 }, LIST, 0, LIST_OPTS)).toBe(0);
  expect(listIndexAt({ x: 10, y: 155.9 }, LIST, 0, LIST_OPTS)).toBe(0);
  expect(listIndexAt({ x: 10, y: 164 }, LIST, 0, LIST_OPTS)).toBe(1);
});

it('list：落在项间距（156..164）→ null，不就近归到某一项', () => {
  expect(listIndexAt({ x: 10, y: 156 }, LIST, 0, LIST_OPTS)).toBeNull();
  expect(listIndexAt({ x: 10, y: 160 }, LIST, 0, LIST_OPTS)).toBeNull();
  expect(listIndexAt({ x: 10, y: 163.9 }, LIST, 0, LIST_OPTS)).toBeNull();
});

it('list：容器外（上 / 下 / 左 / 右 / 负坐标 / NaN）→ null', () => {
  expect(listIndexAt({ x: 10, y: 99 }, LIST, 0, LIST_OPTS)).toBeNull();
  expect(listIndexAt({ x: 10, y: 500 }, LIST, 0, LIST_OPTS)).toBeNull();
  expect(listIndexAt({ x: -1, y: 120 }, LIST, 0, LIST_OPTS)).toBeNull();
  expect(listIndexAt({ x: 300, y: 120 }, LIST, 0, LIST_OPTS)).toBeNull();
  expect(listIndexAt({ x: Number.NaN, y: 120 }, LIST, 0, LIST_OPTS)).toBeNull();
});

it('list：滚动 200px 后同一点索引 +3（200/64 = floor 3）', () => {
  // 不滚动时 y=100 → 0；滚 200 后内容坐标 300 → 3
  expect(listIndexAt({ x: 10, y: 100 }, LIST, 0, LIST_OPTS)).toBe(0);
  expect(listIndexAt({ x: 10, y: 100 }, LIST, 200, LIST_OPTS)).toBe(3);
  // 再滚 64（整整一项）→ +1
  expect(listIndexAt({ x: 10, y: 100 }, LIST, 264, LIST_OPTS)).toBe(4);
});

it('list：超出 count 的位置 → null（内容下方 / 滚到底后仍点下方）', () => {
  // count=2 时第 3 项的位置不存在（索引 2）
  expect(listIndexAt({ x: 10, y: 100 + 64 * 2 }, LIST, 0, { itemH: 56, gap: 8, count: 2 })).toBeNull();
  // 第 2 项存在但第 3 项不存在
  expect(listIndexAt({ x: 10, y: 100 + 64 }, LIST, 0, { itemH: 56, gap: 8, count: 2 })).toBe(1);
  // 滚到很大：内容坐标超出 count
  expect(listIndexAt({ x: 10, y: 400 }, LIST, 5000, LIST_OPTS)).toBeNull();
});

it('list：count=0 / count=1 边界', () => {
  expect(listIndexAt({ x: 10, y: 100 }, LIST, 0, { itemH: 56, count: 0 })).toBeNull();
  expect(listIndexAt({ x: 10, y: 100 }, LIST, 0, { itemH: 56, count: 1 })).toBe(0);
  expect(listIndexAt({ x: 10, y: 100 + 64 }, LIST, 0, { itemH: 56, count: 1 })).toBeNull();
});

it('list：右边界左闭右开（x = rect.x + rect.w 不命中）', () => {
  expect(listIndexAt({ x: LIST.x + LIST.w - 0.01, y: 120 }, LIST, 0, LIST_OPTS)).toBe(0);
  expect(listIndexAt({ x: LIST.x + LIST.w, y: 120 }, LIST, 0, LIST_OPTS)).toBeNull();
});

it('list：gap 缺省 = 0（项紧挨着，没有 null 缝隙）', () => {
  const noGap = { itemH: 56, count: 10 };
  expect(listIndexAt({ x: 0, y: 100 + 55 }, LIST, 0, noGap)).toBe(0);
  expect(listIndexAt({ x: 0, y: 100 + 56 }, LIST, 0, noGap)).toBe(1);
});

// ---------------------------------------------------------------------------
// gridIndexAt
// ---------------------------------------------------------------------------

/** 网格容器：390 宽、500 高（装得下 5 行：100..600），4 列、cellW 91.5、gapX 8 → pitchX 99.5；cellH 72 + gapY 8 → pitchY 80。 */
const GRID: Rect = makeBox(0, 100, 390, 500);
const CELL_W = cellWidth(GRID.w, 4, 8); // 91.5
const GRID_OPTS = { cols: 4, cellW: CELL_W, cellH: 72, gapX: 8, gapY: 8, count: 20 };

it('grid：左上第一格 → 0；同一行第 2/3/4 格 → 1/2/3', () => {
  expect(gridIndexAt({ x: 0, y: 100 }, GRID, 0, GRID_OPTS)).toBe(0);
  expect(gridIndexAt({ x: CELL_W + 8 + 1, y: 100 }, GRID, 0, GRID_OPTS)).toBe(1);
  expect(gridIndexAt({ x: 2 * (CELL_W + 8) + 1, y: 100 }, GRID, 0, GRID_OPTS)).toBe(2);
  expect(gridIndexAt({ x: 3 * (CELL_W + 8) + 1, y: 100 }, GRID, 0, GRID_OPTS)).toBe(3);
});

it('grid：第二行第一格 → cols（4）；最后一行最后一项 → count-1', () => {
  expect(gridIndexAt({ x: 1, y: 100 + 80 + 1 }, GRID, 0, GRID_OPTS)).toBe(4);
  // count=20 → 5 行（20/4）；最后一行 row=4、col=3 → 19
  const y = 100 + 4 * 80 + 1;
  const x = 3 * (CELL_W + 8) + 1;
  expect(gridIndexAt({ x, y }, GRID, 0, GRID_OPTS)).toBe(19);
});

it('grid：落在列间距（91.5..99.5）→ null', () => {
  expect(gridIndexAt({ x: CELL_W, y: 110 }, GRID, 0, GRID_OPTS)).toBeNull();
  expect(gridIndexAt({ x: CELL_W + 8 - 0.01, y: 110 }, GRID, 0, GRID_OPTS)).toBeNull();
});

it('grid：落在行间距（172..180）→ null', () => {
  expect(gridIndexAt({ x: 10, y: 100 + 72 }, GRID, 0, GRID_OPTS)).toBeNull();
  expect(gridIndexAt({ x: 10, y: 100 + 80 - 0.01 }, GRID, 0, GRID_OPTS)).toBeNull();
});

it('grid：容器外（上 / 下 / 左 / 右 / NaN）→ null', () => {
  expect(gridIndexAt({ x: 10, y: 99 }, GRID, 0, GRID_OPTS)).toBeNull();
  expect(gridIndexAt({ x: 10, y: 600 }, GRID, 0, GRID_OPTS)).toBeNull();
  expect(gridIndexAt({ x: -1, y: 110 }, GRID, 0, GRID_OPTS)).toBeNull();
  expect(gridIndexAt({ x: 390, y: 110 }, GRID, 0, GRID_OPTS)).toBeNull();
  expect(gridIndexAt({ x: 10, y: Number.NaN }, GRID, 0, GRID_OPTS)).toBeNull();
});

it('grid：滚动 200px 后同一点索引 +8（200/80 = 2.5 行 → 2 行 × 4 列）', () => {
  // 不滚动：y=100（相对 0）→ 0；滚 160（整 2 行）→ 8
  expect(gridIndexAt({ x: 1, y: 100 }, GRID, 0, GRID_OPTS)).toBe(0);
  expect(gridIndexAt({ x: 1, y: 100 }, GRID, 160, GRID_OPTS)).toBe(8);
  // 滚半行（40）：内容坐标 40 → row 0（40 < 72）→ 仍命中第一行
  expect(gridIndexAt({ x: 1, y: 100 }, GRID, 40, GRID_OPTS)).toBe(0);
});

it('grid：最后一行不满的空位 → null（count=18 → 第 5 行只有 2 格）', () => {
  const opts = { cols: 4, cellW: CELL_W, cellH: 72, gapX: 8, gapY: 8, count: 18 };
  const y = 100 + 4 * 80 + 1;
  expect(gridIndexAt({ x: 1, y }, GRID, 0, opts)).toBe(16);
  expect(gridIndexAt({ x: CELL_W + 9, y }, GRID, 0, opts)).toBe(17);
  // 第 3、4 格是空位
  expect(gridIndexAt({ x: 2 * (CELL_W + 8) + 1, y }, GRID, 0, opts)).toBeNull();
  expect(gridIndexAt({ x: 3 * (CELL_W + 8) + 1, y }, GRID, 0, opts)).toBeNull();
});

it('grid：count=0 / count=1 / cols=1 边界', () => {
  expect(gridIndexAt({ x: 1, y: 101 }, GRID, 0, { ...GRID_OPTS, count: 0 })).toBeNull();
  expect(gridIndexAt({ x: 1, y: 101 }, GRID, 0, { ...GRID_OPTS, count: 1 })).toBe(0);
  expect(gridIndexAt({ x: 100, y: 101 }, GRID, 0, { ...GRID_OPTS, count: 1 })).toBeNull(); // 第 2 格不存在
  // cols=1：一行一格
  expect(gridIndexAt({ x: 5, y: 100 + 80 + 1 }, GRID, 0, { ...GRID_OPTS, cols: 1, count: 5 })).toBe(1);
});

it('grid：容器比内容宽时，右侧多出来的空间 → null', () => {
  // 容器 390 宽，但 cols=2、cellW=91.5 → 内容只占 2×91.5+8 = 191
  const wide = { cols: 2, cellW: 91.5, cellH: 72, gapX: 8, gapY: 8, count: 10 };
  expect(gridIndexAt({ x: 100, y: 110 }, GRID, 0, wide)).toBe(1);
  expect(gridIndexAt({ x: 200, y: 110 }, GRID, 0, wide)).toBeNull(); // col = 2 >= cols
});

// ---------------------------------------------------------------------------
// 画与点同几何：用 grid 绘制时记录的每格矩形，在格内 1px 处必须命中同一个 index
// ---------------------------------------------------------------------------

interface CellCall {
  readonly index: number;
  readonly rect: Rect;
}

const drawGrid = (scrollTop: number, count = 1000): CellCall[] => {
  const calls: CellCall[] = [];
  const base = makeDeps();
  const deps: DrawDeps = {
    ...base,
    data: {
      items: Array.from({ length: count }, (_unused, index) => ({ id: index })),
      renderItem: (_ctx: unknown, _item: unknown, rect: Rect, index: number) => {
        calls.push({ index, rect: { ...rect } });
      },
    },
  };
  // 390 宽、165 高 → 3 行可见（cellH 50 + gapY 5）
  render(grid, makeBox(0, 0, 390, 165), { cols: 4, cellH: 50, gapX: 8, gapY: 5, scrollTop }, deps);
  return calls;
};

it('画与点同几何：grid 绘制的每格，在格内 1px 处命中同一个 index（滚动 0）', () => {
  const BOX = makeBox(0, 0, 390, 165);
  const calls = drawGrid(0);
  expect(calls.length).toBe(12);
  const opts = { cols: 4, cellW: cellWidth(390, 4, 8), cellH: 50, gapX: 8, gapY: 5, count: 1000 };
  for (const call of calls) {
    const point = { x: call.rect.x + 1, y: call.rect.y + 1 };
    expect(gridIndexAt(point, BOX, 0, opts), `index ${call.index} 的格子左上 +1px`).toBe(call.index);
  }
});

it('画与点同几何：滚动 55px 后仍然一致（偏移由两边同一个 scrollTop 反解）', () => {
  const BOX = makeBox(0, 0, 390, 165);
  const calls = drawGrid(55);
  const opts = { cols: 4, cellW: cellWidth(390, 4, 8), cellH: 50, gapX: 8, gapY: 5, count: 1000 };
  expect(calls[0]?.rect.y).toBe(0);
  for (const call of calls) {
    const point = { x: call.rect.x + 1, y: call.rect.y + 1 };
    expect(gridIndexAt(point, BOX, 55, opts), `index ${call.index}（滚动后）`).toBe(call.index);
  }
});

it('画与点同几何：格子中心点也命中同一个 index（不是只有边缘对）', () => {
  const BOX = makeBox(0, 0, 390, 165);
  const calls = drawGrid(0);
  const opts = { cols: 4, cellW: cellWidth(390, 4, 8), cellH: 50, gapX: 8, gapY: 5, count: 1000 };
  for (const call of calls) {
    const center = { x: call.rect.x + call.rect.w / 2, y: call.rect.y + call.rect.h / 2 };
    expect(gridIndexAt(center, BOX, 0, opts), `index ${call.index} 的格心`).toBe(call.index);
  }
});
