/**
 * 滚动交互状态机单测（T20）：12+ 条，全是**具体数值**。
 *
 * 衰减曲线是这套代码的核心手感数据，测试里把每 5 帧的 velocity/offset 钉死——
 * 以后谁改 `FRICTION` 或积分公式，曲线变了测试立刻红，而不是靠试玩觉得「好像不对」。
 */

import { describe, expect, it } from 'vitest';
import {
  IDLE_SCROLL,
  scrollClamp,
  scrollDragEnd,
  scrollDragMove,
  scrollDragStart,
  scrollTick,
} from './scroll';

/** 内容 2000 / 视口 500 → 可滚 1500。 */
const CONTENT = 2000;
const VIEW = 500;
const MAX = 1500;

describe('scrollClamp', () => {
  it('中间值原样、负数钳 0、超上限钳 max、NaN 当 0', () => {
    expect(scrollClamp(400, CONTENT, VIEW)).toBe(400);
    expect(scrollClamp(-50, CONTENT, VIEW)).toBe(0);
    expect(scrollClamp(9999, CONTENT, VIEW)).toBe(MAX);
    expect(scrollClamp(Number.NaN, CONTENT, VIEW)).toBe(0);
  });

  it('内容比视口小 → max 为 0，任何值都钳到 0', () => {
    expect(scrollClamp(100, 400, 500)).toBe(0);
    expect(scrollClamp(-100, 400, 500)).toBe(0);
  });
});

describe('拖动（跟手 + 硬钳制）', () => {
  it('拖 100px → offset 正好 100', () => {
    const dragging = scrollDragStart(IDLE_SCROLL);
    expect(scrollDragMove(dragging, 100, CONTENT, VIEW).offset).toBe(100);
  });

  it('往回拖 -50 → 0（不会变负数）', () => {
    const dragging = scrollDragMove(scrollDragStart(IDLE_SCROLL), 100, CONTENT, VIEW);
    expect(scrollDragMove(dragging, -150, CONTENT, VIEW).offset).toBe(0);
  });

  it('拖到 max + 100 → 正好停在 max', () => {
    const dragging = scrollDragStart(IDLE_SCROLL);
    expect(scrollDragMove(dragging, MAX + 100, CONTENT, VIEW).offset).toBe(MAX);
  });

  it('非拖动状态下 move 无效（原样返回同一个状态）', () => {
    expect(scrollDragMove(IDLE_SCROLL, 100, CONTENT, VIEW)).toBe(IDLE_SCROLL);
    const released = scrollDragEnd(scrollDragStart(IDLE_SCROLL));
    expect(scrollDragMove(released, 100, CONTENT, VIEW)).toBe(released);
  });

  it('dragStart 清速度、保留 offset；dragEnd 保留速度、清 dragging', () => {
    const started = scrollDragStart({ offset: 120, velocity: 800, dragging: false });
    expect(started).toEqual({ offset: 120, velocity: 0, dragging: true });
    const ended = scrollDragEnd({ offset: 120, velocity: 800, dragging: true });
    expect(ended).toEqual({ offset: 120, velocity: 800, dragging: false });
  });

  it('拖动期间 tick 不跑惯性（否则会「边拖边飘」）', () => {
    const held = scrollTick({ offset: 120, velocity: 800, dragging: true }, 1 / 60, CONTENT, VIEW);
    expect(held.offset).toBe(120);
    expect(held.velocity).toBe(0);
    expect(held.dragging).toBe(true);
  });

  it('NaN delta / NaN offset 不崩（offset 保持原值）', () => {
    const dragging = scrollDragMove(scrollDragStart(IDLE_SCROLL), 100, CONTENT, VIEW);
    expect(scrollDragMove(dragging, Number.NaN, CONTENT, VIEW).offset).toBe(100);
    expect(scrollDragMove({ offset: Number.NaN, velocity: 0, dragging: true }, 10, CONTENT, VIEW).offset).toBe(10);
  });
});

describe('惯性（指数衰减）', () => {
  it('已经贴底时 tick：位移不会越界，velocity 立刻清零', () => {
    const atBottom = scrollTick({ offset: MAX, velocity: 2000, dragging: false }, 1 / 60, CONTENT, VIEW);
    expect(atBottom.offset).toBe(MAX);
    expect(atBottom.velocity).toBe(0);
  });

  it('松手速度 2000：每 5 帧的 velocity / offset 落在预期曲线', () => {
    let state = { offset: 0, velocity: 2000, dragging: false };
    const expected: readonly (readonly [number, number, number])[] = [
      [5, 1318.16, 142.05],
      [10, 868.78, 235.67],
      [20, 377.39, 338.04],
      [40, 71.21, 401.83],
      [60, 13.44, 413.87],
    ];
    let frame = 0;
    for (const [target, velocity, offset] of expected) {
      while (frame < target) {
        state = scrollTick(state, 1 / 60, CONTENT, VIEW);
        frame += 1;
      }
      expect(state.velocity, `第 ${target} 帧 velocity`).toBeCloseTo(velocity, 1);
      expect(state.offset, `第 ${target} 帧 offset`).toBeCloseTo(offset, 1);
    }
  });

  it('一直 tick 到停：72 帧内停下，总位移约 415.6px，最终 velocity=0', () => {
    let state = { offset: 0, velocity: 2000, dragging: false };
    let frames = 0;
    while (state.velocity !== 0 && frames < 600) {
      state = scrollTick(state, 1 / 60, CONTENT, VIEW);
      frames += 1;
    }
    expect(frames).toBe(72);
    expect(state.velocity).toBe(0);
    expect(state.offset).toBeCloseTo(415.64, 1);
    // 总位移有上界：v/60/(1-0.92) ≈ 416.7（这就是「dt 再大也不跳飞」的数学保证）
    expect(state.offset).toBeLessThan(416.7);
  });

  it('dt = 1 秒不跳飞：结果与「跑 60 帧」完全一致（指数衰减对 dt 可加）', () => {
    const oneShot = scrollTick({ offset: 0, velocity: 2000, dragging: false }, 1, CONTENT, VIEW);
    let perFrame = { offset: 0, velocity: 2000, dragging: false };
    for (let i = 0; i < 60; i += 1) perFrame = scrollTick(perFrame, 1 / 60, CONTENT, VIEW);
    expect(oneShot.offset).toBeCloseTo(perFrame.offset, 6);
    expect(oneShot.velocity).toBeCloseTo(perFrame.velocity, 6);
    expect(oneShot.offset).toBeLessThan(420); // 上界 416.7，不会因为 dt 大而飞到天上
  });

  it('dt = 1/600 秒（半步）：位移约 3.46，不退化成整帧', () => {
    const half = scrollTick({ offset: 0, velocity: 2000, dragging: false }, 1 / 600, CONTENT, VIEW);
    expect(half.offset).toBeCloseTo(3.46, 1);
    expect(half.velocity).toBeCloseTo(1983.39, 1);
  });

  it('dt 非法（0 / 负数 / NaN）不推进，状态被规范化', () => {
    for (const dt of [0, -0.1, Number.NaN]) {
      const state = scrollTick({ offset: 100, velocity: 2000, dragging: false }, dt, CONTENT, VIEW);
      expect(state.offset).toBe(100);
      expect(state.velocity).toBe(2000);
    }
  });

  it('contentSize <= viewSize 时所有操作 offset 恒 0', () => {
    const dragging = scrollDragStart(IDLE_SCROLL);
    expect(scrollDragMove(dragging, 300, 400, 500).offset).toBe(0);
    expect(scrollTick({ offset: 0, velocity: 2000, dragging: false }, 1 / 60, 400, 500)).toEqual({
      offset: 0,
      velocity: 0,
      dragging: false,
    });
  });

  it('IDLE_SCROLL 是零值常量', () => {
    expect(IDLE_SCROLL).toEqual({ offset: 0, velocity: 0, dragging: false });
  });
});
