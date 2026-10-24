/**
 * 熨烫段纯函数（不碰 canvas）。
 *
 * 盘面 GRID×GRID 每格三态：0 未烫 / 1 已定型 / 2 烫糊。
 * 熨烫板 plate：网格坐标（gx,gy = 板左上角所在格），边长 PLATE_CELLS 格。
 * 对位 = 板左上角与格原点偏差 < ALIGN_TOL 格。
 *
 * 温度语义（T63 按 pindou-juice-spec §3⑥ 三态化）：
 * - `cold`  < 49：烫不动（扫过不标记）
 * - `warn`  49–55 / 70–76：能烫（琥珀，接近边缘）
 * - `ok`    55–70：绿窗（最稳）
 * - `hot`   > 76：扫过**烫糊**（朱砂）
 * 只有「对位 + 温度 ≤ TEMP_BURN」才定型；`hot` 或错位 → 烫糊。
 *
 * 已定型（=1）的格子**不会再被烫糊**：定型就是定型，否则玩到一半发现做好的格
 * 被自己烫黑，只会让人觉得「这游戏随机惩罚我」。烫糊只发生在还没定的格子上。
 */

import { GRID } from './levels';

export const PLATE_CELLS = 4;
export const ALIGN_TOL = 0.35; // 格
/** 绿窗上下沿（spec §3⑥） */
export const TEMP_LO = 55;
export const TEMP_HI = 70;
/** 接近边缘的下沿（琥珀带起点） */
export const TEMP_WARN = 49;
/** 超过它就烫糊（spec §3⑥ 的「超温 > 76」） */
export const TEMP_BURN = 76;
/** 每秒加温 / 降温（T63 调过：原 34/22 在一个按住周期里只剩 0.4 秒绿窗，人类玩不了） */
export const TEMP_HEAT_RATE = 18;
export const TEMP_COOL_RATE = 14;
export const TEMP_MAX = 120;
/** 烫糊率超过它就判失败（spec §3⑦：> 30%） */
export const BURNT_FAIL_RATE = 0.3;

export type CellState = 0 | 1 | 2;
export type TempState = 'cold' | 'warn' | 'ok' | 'hot';

/** 温度三态（纯函数，渲染与 HUD 共用；不要在两处各写一遍阈值） */
export const tempState = (temp: number): TempState => {
  if (!Number.isFinite(temp)) return 'cold';
  if (temp > TEMP_BURN) return 'hot';
  if (temp >= TEMP_LO && temp <= TEMP_HI) return 'ok';
  if (temp >= TEMP_WARN) return 'warn';
  return 'cold';
};

export interface Plate {
  /** 板左上角浮点格坐标（拖拽像素 / 格尺寸得到） */
  readonly gx: number;
  readonly gy: number;
  readonly temp: number;
  /** 对位（|偏移| < ALIGN_TOL） */
  readonly aligned: boolean;
}

export interface IronState {
  /** 需要熨烫的格子集合（= 图案非空格下标） */
  readonly targets: readonly number[];
  readonly cells: readonly CellState[];
  /** 每格最近一次状态变化的时刻（秒，用于 120ms 着色 / 480ms 溶解动画） */
  readonly cellAt: readonly number[];
  /** 熨烫段累计时钟（秒）：所有动画的时间基准 */
  readonly clock: number;
  readonly plate: Plate;
  /** 按住加温 */
  readonly heating: boolean;
  /** 温度稳定道具剩余秒数 */
  readonly steadySec: number;
}

export const initialIron = (targets: readonly number[]): IronState => ({
  targets,
  cells: targets.map(() => 0 as CellState),
  cellAt: targets.map(() => 0),
  clock: 0,
  plate: { gx: 0, gy: 0, temp: 30, aligned: true },
  heating: false,
  steadySec: 0,
});

/** 板覆盖的格下标集合（与图案格交集） */
export const coveredCells = (plate: Plate): readonly number[] => {
  const out: number[] = [];
  const c0 = Math.floor(plate.gx);
  const r0 = Math.floor(plate.gy);
  for (let r = r0; r < r0 + PLATE_CELLS; r += 1) {
    for (let c = c0; c < c0 + PLATE_CELLS; c += 1) {
      if (r < 0 || c < 0 || r >= GRID || c >= GRID) continue;
      out.push(r * GRID + c);
    }
  }
  return out;
};

/** 温度更新：按住加温、松手降温；稳定道具把温度锁在窗中央；clock 永远前进 */
export const stepTemp = (state: IronState, dt: number): IronState => {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  let temp = state.plate.temp;
  let { steadySec } = state;
  if (steadySec > 0) {
    steadySec = Math.max(0, steadySec - step);
    temp = (TEMP_LO + TEMP_HI) / 2;
  } else {
    temp += state.heating ? TEMP_HEAT_RATE * step : -TEMP_COOL_RATE * step;
    temp = Math.max(0, Math.min(TEMP_MAX, temp));
  }
  return { ...state, clock: state.clock + step, plate: { ...state.plate, temp }, steadySec };
};

/**
 * 板扫过：覆盖格按「对位 + 温度」定型/烫糊。
 * - 太凉（< TEMP_LO）扫过什么都不发生；
 * - 超温（> TEMP_BURN）或错位 → 烫糊（只烫糊还没定型的格）；
 * - 否则 → 定型。
 */
export const ironSweep = (state: IronState): IronState => {
  const t = state.plate.temp;
  if (t < TEMP_LO) return state;
  const plate = snappedPlate(state.plate);
  const burn = t > TEMP_BURN || !plate.aligned;
  const cells = [...state.cells];
  const cellAt = [...state.cellAt];
  const targetSet = new Set(state.targets);
  let changed = false;
  for (const i of coveredCells(plate)) {
    if (!targetSet.has(i)) continue;
    const at = state.targets.indexOf(i);
    // 1 与 2 都是**终态**：定型不会再糊；已经糊的也不能被绿温「熨回来」——
    // 否则玩家一直扫就能把烫糊率压到 0，`burntRate > 30%` 这条失败线永远触发不了。
    if (cells[at] === 1 || cells[at] === 2) continue;
    const next: CellState = burn ? 2 : 1;
    cells[at] = next;
    cellAt[at] = state.clock;
    changed = true;
  }
  return changed ? { ...state, cells, cellAt } : state;
};

export const burntRate = (state: IronState): number => {
  if (state.targets.length === 0) return 0;
  return state.cells.filter((c) => c === 2).length / state.targets.length;
};

export const allDone = (state: IronState): boolean => state.cells.every((c) => c === 1);

export const ironFailed = (state: IronState): boolean => burntRate(state) > BURNT_FAIL_RATE;

/**
 * 对位时把板吸附到最近整数格（渲染 / 扫格都该用吸附后的位置）。
 *
 * 为什么需要：板位置来自「指针像素 / 格边长」，即使玩家把板拖到正对格子，
 * 得到的也是 2.999999999999999 这类值。视觉上看不出差别，但 `Math.floor`
 * 会把它算成第 2 行 —— 板明明盖住 3–6 行，却只标记 2–5 行，最后几格永远烫不完。
 */
export const snappedPlate = (plate: Plate): Plate =>
  plate.aligned ? { ...plate, gx: Math.round(plate.gx), gy: Math.round(plate.gy) } : plate;

/** 对位判定：板左上角相对最近格原点的偏差 */
export const withAlignment = (plate: Plate): Plate => {
  const dx = plate.gx - Math.round(plate.gx);
  const dy = plate.gy - Math.round(plate.gy);
  return { ...plate, aligned: Math.hypot(dx, dy) < ALIGN_TOL };
};
