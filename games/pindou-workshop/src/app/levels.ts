/**
 * 关卡数据：12 关像素图案。
 * 图案 = 一维数组（GRID_SIZE²），-1 = 空位（不属于图案），0..N-1 = 颜色索引。
 * 用确定性函数生成（同 seed 同图案），形状来自简单数学条件 —— 不引素材。
 */

export const GRID = 10;

/** 色块颜色表（索引 = 颜色索引；最多 6 色） */
export const CELL_TINTS = ['#e2574c', '#e8b64c', '#5aa06a', '#5178b8', '#9a6fb8', '#e08a5a'] as const;

export interface Level {
  readonly id: number;
  readonly name: string;
  readonly colors: number; // 颜色数（3..6）
  readonly grid: readonly number[]; // GRID² 
  readonly pieceCount: number; // 非空格数 = 色块总数
  readonly timeLimitSec: number;
  readonly tempSlots: number; // 临时空位数（2..3）
}

type ShapeFn = (r: number, c: number, n: number) => boolean;

/** 确定性伪随机（mulberry32） */
export const rng = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const SHAPES: readonly ShapeFn[] = [
  // 心形
  (r, c, n) => {
    const x = (c - (n - 1) / 2) / (n / 2), y = (r - n * 0.38) / (n / 2);
    return x * x + y * y * 0.86 - 0.36 < Math.abs(x) * 0.5 + 0.2 && y < 0.62;
  },
  // 圆环
  (r, c, n) => {
    const d = Math.hypot(r - (n - 1) / 2, c - (n - 1) / 2) / (n / 2);
    return d < 0.92 && d > 0.42;
  },
  // 实心圆
  (r, c, n) => Math.hypot(r - (n - 1) / 2, c - (n - 1) / 2) / (n / 2) < 0.88,
  // 菱形
  (r, c, n) => Math.abs(r - (n - 1) / 2) + Math.abs(c - (n - 1) / 2) <= n * 0.44,
  // 星形（五角近似：中心圆 + 五个尖）
  (r, c, n) => {
    const dx = c - (n - 1) / 2, dy = r - (n - 1) / 2;
    const d = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
    const spike = 0.55 + 0.4 * Math.abs(Math.cos(ang * 2.5));
    return d / (n / 2) < spike;
  },
  // 方环
  (r, c, n) => {
    const e = Math.min(r, c, n - 1 - r, n - 1 - c);
    return e <= n * 0.18;
  },
];

const makeLevel = (id: number, name: string, colors: number, shapeIdx: number, seed: number, timeLimitSec: number, tempSlots: number): Level => {
  const shape = SHAPES[shapeIdx]!;
  const rand = rng(seed);
  const grid: number[] = [];
  let pieceCount = 0;
  for (let r = 0; r < GRID; r += 1) {
    for (let c = 0; c < GRID; c += 1) {
      if (shape(r, c, GRID)) {
        grid.push(Math.floor(rand() * colors));
        pieceCount += 1;
      } else {
        grid.push(-1);
      }
    }
  }
  return { id, name, colors, grid, pieceCount, timeLimitSec, tempSlots };
};

export const LEVELS: readonly Level[] = [
  makeLevel(1, '小红心', 3, 0, 11, 90, 3),
  makeLevel(2, '圆环', 3, 1, 22, 90, 3),
  makeLevel(3, '满月', 4, 2, 33, 90, 2),
  makeLevel(4, '紫晶', 4, 3, 44, 75, 2),
  makeLevel(5, '海星', 5, 4, 55, 75, 3),
  makeLevel(6, '回纹', 6, 5, 66, 60, 2),
  // 7–12：形状循环复用，靠「颜色更多 / 时间更紧 / 临时位更少」加难度（不改引擎）
  makeLevel(7, '二心', 4, 0, 77, 75, 2),
  makeLevel(8, '重环', 4, 1, 88, 70, 3),
  makeLevel(9, '双月', 5, 2, 99, 65, 2),
  makeLevel(10, '双菱', 5, 3, 111, 60, 2),
  makeLevel(11, '双星', 6, 4, 122, 55, 3),
  makeLevel(12, '回字纹', 6, 5, 133, 50, 2),
];
