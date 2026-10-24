// B 段熨烫纯逻辑：对位判定、温度三态、烫糊阈值、通关/失败迁移
import { expect, it } from 'vitest';
import { GRID } from './levels';
import {
  BURNT_FAIL_RATE,
  PLATE_CELLS,
  TEMP_BURN,
  TEMP_COOL_RATE,
  TEMP_HEAT_RATE,
  TEMP_HI,
  TEMP_LO,
  TEMP_WARN,
  allDone,
  burntRate,
  coveredCells,
  initialIron,
  ironFailed,
  ironSweep,
  snappedPlate,
  stepTemp,
  tempState,
  withAlignment,
} from './iron';
import { INITIAL_STATE, reduce } from './state';

/** 造一个已进 iron 屏的状态（直接归位第一关全部色块） */
const enterIron = () => {
  let s = reduce(INITIAL_STATE, { kind: 'startLevel', levelId: 1 });
  let guard = 300;
  while (s.screen === 'board' && guard-- > 0) {
    const p = s.pieces.find((q) => !q.placed)!;
    const idx = s.grid.findIndex((v, i) => v === p.color && !s.pieces.some((q) => q.loc.t === 'grid' && q.loc.i === i));
    s = reduce(s, { kind: 'drop', pieceId: p.id, target: { t: 'grid', i: idx } });
  }
  expect(s.screen).toBe('iron');
  return s;
};

/** 按住加热到绿窗内（不越过 TEMP_HI） */
const heatTo = (s: ReturnType<typeof enterIron>, target = TEMP_LO + 3) => {
  let cur = reduce(s, { kind: 'ironHeat', on: true });
  let guard = 200;
  while (cur.iron.plate.temp < target && cur.screen === 'iron' && guard-- > 0) {
    cur = reduce(cur, { kind: 'ironTick', dt: 0.05 });
  }
  return cur;
};

/** 把板在盘面所有位置滚一遍（温度过高就松手降温），直到全定型或离开 iron 屏 */
const sweepAll = (s: ReturnType<typeof enterIron>) => {
  let cur = s;
  let guard = 40;
  while (!allDone(cur.iron) && cur.screen === 'iron' && guard-- > 0) {
    cur = heatTo(cur);
    for (let gy = 0; gy <= GRID - PLATE_CELLS; gy += 2) {
      for (let gx = 0; gx <= GRID - PLATE_CELLS; gx += 2) {
        if (cur.screen !== 'iron') return cur;
        cur = reduce(cur, { kind: 'ironMove', gx, gy });
        cur = reduce(cur, { kind: 'ironTick', dt: 0.05 });
        if (cur.iron.plate.temp > TEMP_HI) {
          cur = reduce(cur, { kind: 'ironHeat', on: false });
          while (cur.iron.plate.temp > TEMP_LO + 3 && cur.screen === 'iron') {
            cur = reduce(cur, { kind: 'ironTick', dt: 0.1 });
          }
          break;
        }
      }
    }
  }
  return cur;
};

it('对位判定：偏差 < 0.35 格算对齐', () => {
  expect(withAlignment({ gx: 0, gy: 0, temp: 60, aligned: false }).aligned).toBe(true);
  expect(withAlignment({ gx: 0.3, gy: 0.15, temp: 60, aligned: false }).aligned).toBe(true);
  expect(withAlignment({ gx: 0.5, gy: 0, temp: 60, aligned: false }).aligned).toBe(false);
});

it('温度步进：加热升温、松手降温、钳位 [0,120]', () => {
  const base = initialIron([0]);
  const up = stepTemp({ ...base, plate: { ...base.plate, temp: 40 }, heating: true }, 1);
  expect(up.plate.temp).toBeCloseTo(40 + TEMP_HEAT_RATE, 5);
  const down = stepTemp({ ...base, plate: { ...base.plate, temp: 60 }, heating: false }, 1);
  expect(down.plate.temp).toBeCloseTo(60 - TEMP_COOL_RATE, 5);
  const hot = stepTemp({ ...base, plate: { ...base.plate, temp: 119 }, heating: true }, 5);
  expect(hot.plate.temp).toBe(120);
});

it('温度三态：冷 / 接近边缘 / 绿窗 / 超温，边界值归到正确的一档', () => {
  expect(tempState(0)).toBe('cold');
  expect(tempState(TEMP_WARN - 1)).toBe('cold');
  expect(tempState(TEMP_WARN)).toBe('warn');
  expect(tempState(TEMP_LO - 0.1)).toBe('warn');
  expect(tempState(TEMP_LO)).toBe('ok');
  expect(tempState(TEMP_HI)).toBe('ok');
  expect(tempState(TEMP_HI + 0.1)).toBe('warn');
  expect(tempState(TEMP_BURN)).toBe('warn');
  expect(tempState(TEMP_BURN + 0.1)).toBe('hot');
  expect(tempState(Number.NaN)).toBe('cold');
});

it('稳定道具：steadySec 期间温度锁窗中央且倒计时递减', () => {
  const base = { ...initialIron([0]), plate: { ...initialIron([0]).plate, temp: 10 }, steadySec: 2 };
  const s = stepTemp(base, 1);
  expect(s.plate.temp).toBeCloseTo((TEMP_LO + TEMP_HI) / 2, 5);
  expect(s.steadySec).toBeCloseTo(1, 5);
});

it('覆盖格：板 4×4、越界裁剪', () => {
  const cells = coveredCells({ gx: GRID - 2, gy: GRID - 2, temp: 60, aligned: true });
  expect(cells.length).toBe(2 * 2);
  expect(coveredCells({ gx: 0, gy: 0, temp: 60, aligned: true })).toHaveLength(16);
});

it('对位 + 温度窗内扫过 → 定型；过热 / 错位 → 烫糊；太凉扫过无变化', () => {
  const targets = [0, 1, GRID, GRID + 1];
  let s = { ...initialIron(targets), plate: { gx: 0, gy: 0, temp: (TEMP_LO + TEMP_HI) / 2, aligned: true } };
  s = ironSweep(s);
  expect(s.cells.every((c) => c === 1)).toBe(true);
  const burnt = ironSweep({ ...initialIron(targets), plate: { gx: 0, gy: 0, temp: TEMP_BURN + 5, aligned: true } });
  expect(burnt.cells.every((c) => c === 2)).toBe(true);
  const mis = ironSweep({ ...initialIron(targets), plate: { gx: 0.5, gy: 0, temp: 60, aligned: false } });
  expect(mis.cells.some((c) => c === 2)).toBe(true);
  const cold = ironSweep({ ...initialIron(targets), plate: { gx: 0, gy: 0, temp: TEMP_LO - 1, aligned: true } });
  expect(cold.cells).toEqual(initialIron(targets).cells);
});

it('已定型格不会被后续过热扫过烫糊（进度只增不减）', () => {
  const targets = [0, 1];
  const done = { ...initialIron(targets), cells: [1, 1] as const };
  const after = ironSweep({ ...done, cells: [1, 0] as unknown as readonly (0 | 1 | 2)[], plate: { gx: 0, gy: 0, temp: 110, aligned: true } });
  expect(after.cells[0]).toBe(1); // 已定型保留
  expect(after.cells[1]).toBe(2); // 未定型被烫糊
});

it('烫糊率与失败阈值（> 30%）', () => {
  const targets = [0, 1, 2, 3, 4];
  const oneBurnt = { ...initialIron(targets), cells: [1, 1, 1, 1, 2] as readonly (1 | 2)[] };
  expect(burntRate(oneBurnt)).toBeCloseTo(0.2, 5);
  expect(ironFailed(oneBurnt)).toBe(false);
  const twoBurnt = { ...initialIron(targets), cells: [1, 1, 1, 2, 2] as readonly (1 | 2)[] };
  expect(burntRate(twoBurnt) > BURNT_FAIL_RATE).toBe(true);
  expect(ironFailed(twoBurnt)).toBe(true);
});

it('allDone：全部定型才通关', () => {
  const targets = [0, 1];
  expect(allDone({ ...initialIron(targets), cells: [1, 1] })).toBe(true);
  expect(allDone({ ...initialIron(targets), cells: [1, 0] })).toBe(false);
});

it('流程：绿窗内扫满 → result / win', () => {
  const cur = sweepAll(enterIron());
  expect(ironFailed(cur.iron)).toBe(false);
  expect(cur.screen).toBe('result');
  expect(cur.outcome).toBe('win');
  expect(cur.toast).toContain('熨烫完成');
});

it('流程：一直加到超温再扫 → 烫糊超阈 → result / fail', () => {
  let cur = reduce(enterIron(), { kind: 'ironHeat', on: true });
  let guard = 200;
  while (cur.iron.plate.temp <= TEMP_BURN && guard-- > 0) cur = reduce(cur, { kind: 'ironTick', dt: 0.1 });
  for (let gx = 0; gx <= GRID - PLATE_CELLS && cur.screen === 'iron'; gx += 2) {
    for (let gy = 0; gy <= GRID - PLATE_CELLS && cur.screen === 'iron'; gy += 2) {
      cur = reduce(cur, { kind: 'ironMove', gx, gy });
      cur = reduce(cur, { kind: 'ironTick', dt: 0.05 });
    }
  }
  expect(cur.screen).toBe('result');
  expect(cur.outcome).toBe('fail');
});
it('iron：板落在 2.999999999999999 这种浮点位置，覆盖的仍是 3–6 行（不能少算一行）', () => {
  // 真浏览器里拖拽算出的 gx/gy 常常是 2.999999999999999（浮点除法的下巴）。
  // 只按 floor 取覆盖格会把它当第 2 行 → 板明明盖住 3–6 行却只标记 2–5 行，
  // 最后那几格玩家怎么烫都烫不完（T63 实测踩到，熨烫永远收不了尾）。
  const targets: number[] = [];
  for (let r = 3; r < 3 + PLATE_CELLS; r += 1) {
    for (let c = 0; c < PLATE_CELLS; c += 1) targets.push(r * GRID + c);
  }
  const base = initialIron(targets);
  const plate = withAlignment({ ...base.plate, gx: 0, gy: 2.999999999999999, temp: TEMP_LO + 5 });
  expect(plate.aligned, '这点偏差应该算对位').toBe(true);
  expect(snappedPlate(plate).gy, '对位后应吸附到整数格 3').toBe(3);
  expect([...coveredCells(snappedPlate(plate))].sort((a, b) => a - b)).toEqual([...targets].sort((a, b) => a - b));
  const swept = ironSweep({ ...base, plate });
  expect(swept.cells.every((c) => c === 1), '浮点偏移把 3–6 行算成了 2–5 行').toBe(true);
});
it('iron：烫糊是终态 —— 绿温再扫一遍不会把糊掉的格「熨回来」', () => {
  const targets = [0, 1, 2, 3];
  const base = initialIron(targets);
  // 先用超温烫糊整排
  const hot = ironSweep({ ...base, plate: withAlignment({ ...base.plate, gx: 0, gy: 0, temp: TEMP_BURN + 6 }) });
  expect(hot.cells.every((c) => c === 2), '超温应全部烫糊').toBe(true);
  // 再用绿窗温度扫同一排：糊掉的格必须原样留着
  const green = ironSweep({ ...hot, plate: withAlignment({ ...hot.plate, gx: 0, gy: 0, temp: TEMP_LO + 5 }) });
  expect(green.cells.every((c) => c === 2), '绿温把烫糊格熨回来了（烫糊必须不可逆）').toBe(true);
  expect(burntRate(green)).toBe(1);
});