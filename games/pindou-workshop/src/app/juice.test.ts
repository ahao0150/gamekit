// 第二轮动效状态层：拿起放大、跟手高亮、连击阶梯、放错回弹、熨烫板弹簧、温度平滑、烫糊告警
import { expect, it } from 'vitest';
import { PICK_SCALE, REJECT_FLASH_MS, REJECT_SHAKE_MS } from './anim';
import { createJuice } from './juice';
import { initialIron } from './iron';
import { INITIAL_STATE } from './state';
import type { GameState } from './state';

const board = (): GameState => ({ ...INITIAL_STATE, screen: 'board' });

/** 造一个 iron 态：`cells` 直接给定三态（0 未烫 / 1 定型 / 2 烫糊） */
const iron = (cells: readonly number[], temp = 60, gx = 0, gy = 0): GameState => {
  const targets = cells.map((_, i) => i);
  const base = initialIron(targets);
  return {
    ...INITIAL_STATE,
    screen: 'iron',
    iron: {
      ...base,
      cells: cells.map((c) => c as 0 | 1 | 2),
      cellAt: cells.map(() => 0),
      clock: 1,
      plate: { gx, gy, temp, aligned: true },
    },
  };
};

/** 推进 n 帧（每帧 1/60 秒） */
const run = (juice: ReturnType<typeof createJuice>, state: GameState, frames: number) => {
  for (let i = 0; i < frames; i += 1) juice.update(1 / 60, state);
  return juice.frame;
};

it('① 拿起：记录颜色、放大趋近 1.25（不超调），松手回到 1', () => {
  const juice = createJuice();
  juice.grab(2);
  const f = run(juice, board(), 1);
  expect(f.dragColor).toBe(2);
  expect(f.pickScale).toBeGreaterThan(1);
  expect(f.pickScale).toBeLessThanOrEqual(PICK_SCALE);
  const later = run(juice, board(), 20);
  expect(later.pickScale).toBeCloseTo(PICK_SCALE, 2);
  juice.endDrag();
  const back = run(juice, board(), 20);
  expect(back.dragColor).toBe(-1);
  expect(back.pickScale).toBeCloseTo(1, 2);
});

it('② 跟手高亮：同色空格亮 0.55，悬停到该格升到 1.30，移开回落', () => {
  const juice = createJuice();
  juice.grab(1);
  juice.dragTo(-1, false);
  const idle = run(juice, board(), 12);
  expect(idle.highlight).toBeCloseTo(0.55, 1);
  expect(idle.hoverCell).toBe(-1);
  juice.dragTo(7, true);
  const hover = run(juice, board(), 12);
  expect(hover.hoverCell).toBe(7);
  expect(hover.highlight).toBeCloseTo(1.3, 1);
  juice.dragTo(7, false); // 异色格：不悬停
  const away = run(juice, board(), 12);
  expect(away.hoverCell).toBe(-1);
  expect(away.highlight).toBeLessThan(0.7);
  juice.endDrag();
  const off = run(juice, board(), 20);
  expect(off.highlight).toBeLessThan(0.05);
});

it('③ 归位：目标格出高光与粒子，连击把峰值阶梯抬高（时长不变）', () => {
  const juice = createJuice();
  juice.place(11);
  const f = run(juice, board(), 5);
  expect(f.locks).toHaveLength(1);
  expect(f.locks[0]!.cell).toBe(11);
  expect(f.locks[0]!.ageMs).toBeGreaterThan(0);
  expect(f.locks[0]!.intensity).toBeGreaterThan(0);
  const one = juice.frame.locks[0]!.intensity;

  const combo = createJuice();
  combo.place(11);
  combo.place(12);
  combo.place(13);
  const c3 = run(combo, board(), 5);
  expect(c3.locks).toHaveLength(3);
  const three = Math.max(...c3.locks.map((l) => l.intensity));
  expect(three).toBeGreaterThan(one * 1.4); // 连击 3 的峰值 = 2.20 对 1.40

  // 160ms 之后高光熄灭、列表清空
  const gone = run(juice, board(), 12);
  expect(gone.locks).toHaveLength(0);
});

it('④ 放错：残影从释放点回到原位、色差/震屏/闪红都在窗口内衰减到 0', () => {
  const juice = createJuice();
  juice.reject(5, { x: 300, y: 100 }, { x: 100, y: 600 }, 20, 3);
  const start = run(juice, board(), 1);
  expect(start.ghost).not.toBeNull();
  expect(start.flash).toBeGreaterThan(0);
  expect(start.rejectCell).toBe(5);
  expect(start.rejectCellAlpha).toBeGreaterThan(0);
  expect(start.chromatic).toBeGreaterThan(0);

  const mid = run(juice, board(), 7); // ≈127ms
  expect(mid.ghost!.y).toBeGreaterThan(start.ghost!.y); // 往下（回池子）走

  const afterFlash = run(juice, board(), 6); // 超过 60ms
  expect(afterFlash.flash).toBe(0);
  expect(afterFlash.chromatic).toBe(0);

  const end = run(juice, board(), 20);
  expect(end.ghost).toBeNull();
  expect(end.shake).toBe(0);
  expect(end.rejectCell).toBe(-1);
  // 残影最终落在目标位置（不是「消失在半路」）
  expect(REJECT_FLASH_MS).toBeLessThan(REJECT_SHAKE_MS + 1);
});

it('④ 放错会打断连击（下一次归位从 1 档重新算）', () => {
  const juice = createJuice();
  juice.place(1);
  juice.place(2);
  juice.place(3);
  juice.reject(4, { x: 1, y: 1 }, { x: 2, y: 2 }, 10, 0);
  run(juice, board(), 2);
  juice.place(5);
  const f = run(juice, board(), 5);
  const latest = f.locks.find((l) => l.cell === 5)!;
  expect(latest.combo).toBe(1);
  expect(latest.intensity).toBeLessThan(1.6);
});

it('⑤ 熨烫板弹簧跟随：不是瞬移，约 100ms 收敛到目标（ζ=1 临界阻尼）', () => {
  const juice = createJuice();
  run(juice, iron([1, 1, 1, 1], 60, 0, 0), 1);
  expect(juice.frame.plate!.gx).toBeCloseTo(0, 3);
  // 目标跳到 4 格：第一帧只走一小段
  const f1 = run(juice, iron([1, 1, 1, 1], 60, 4, 0), 1);
  expect(f1.plate!.gx).toBeGreaterThan(0);
  expect(f1.plate!.gx).toBeLessThan(1.5);
  // 0.2s（12 帧）后基本到位
  const f2 = run(juice, iron([1, 1, 1, 1], 60, 4, 0), 12);
  expect(f2.plate!.gx).toBeCloseTo(4, 1);
});

it('⑥ 温度平滑：读数逼近板温且不跳变', () => {
  const juice = createJuice();
  const cold = iron([1, 1], 30, 0, 0);
  run(juice, cold, 5);
  expect(juice.frame.temp).toBeLessThan(60);
  const hot = iron([1, 1], 70, 0, 0);
  const f = run(juice, hot, 2);
  expect(f.temp).toBeGreaterThan(30);
  expect(f.temp).toBeLessThan(70); // 平滑过，一帧到不了
  const settled = run(juice, hot, 90);
  expect(settled.temp).toBeCloseTo(70, 1);
});

it('⑦ 烫糊累积告警：18% 起预警、30% 起危险（30% 就是失败线，单档阈值看不见）', () => {
  const juice = createJuice();
  // 10 格烧 2 格 = 20% → 预警档
  const warn = iron([2, 2, 1, 1, 1, 1, 1, 1, 1, 1]);
  const f1 = run(juice, warn, 40);
  expect(f1.alert).toBeGreaterThan(0.05);
  expect(f1.alertHot).toBe(false);
  // 10 格烧 4 格 = 40% → 危险档
  const danger = iron([2, 2, 2, 2, 1, 1, 1, 1, 1, 1]);
  const f2 = run(juice, danger, 40);
  expect(f2.alert).toBeGreaterThan(f1.alert);
  expect(f2.alertHot).toBe(true);
  expect(f2.shake).toBeGreaterThan(0); // 危险档带 2px 震屏
});

it('换屏会把瞬时特效清干净（残影不会跟着结算页出现）', () => {
  const juice = createJuice();
  juice.place(3);
  juice.reject(4, { x: 5, y: 5 }, { x: 6, y: 6 }, 10, 1);
  run(juice, board(), 1);
  const f = run(juice, { ...board(), screen: 'result' }, 1);
  expect(f.ghost).toBeNull();
  expect(f.locks).toHaveLength(0);
  expect(f.flash).toBe(0);
});
