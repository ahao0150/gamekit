import { describe, expect, it } from 'vitest';
import type { FrameScheduler, TickState } from './contract';
import { createLoop, DEFAULT_MAX_FRAME_TIME, DEFAULT_MAX_SUB_STEPS, DEFAULT_STEP, tick } from './index';

const loose = { step: 0.1, maxFrameTime: 1, maxSubSteps: 10 };

function makeScheduler(): { schedule: FrameScheduler; queue: Array<(t: number) => void> } {
  const queue: Array<(t: number) => void> = [];
  const schedule: FrameScheduler = (cb) => {
    queue.push(cb);
    return () => {
      const i = queue.indexOf(cb);
      if (i >= 0) queue.splice(i, 1);
    };
  };
  return { schedule, queue };
}

function take(queue: Array<(t: number) => void>): (t: number) => void {
  const cb = queue.shift();
  if (!cb) throw new Error('没有排队中的帧');
  return cb;
}

describe('tick（纯函数）', () => {
  it('首帧只记录时间，不更新', () => {
    const r = tick({ acc: 0, prev: null }, 1000, loose);
    expect(r.steps).toBe(0);
    expect(r.frameTime).toBe(0);
    expect(r.alpha).toBe(0);
    expect(r.state.prev).toBe(1000);
    expect(r.state.acc).toBe(0);
  });

  it('恰好一个步长 → 1 步、余数 0', () => {
    const r = tick({ acc: 0, prev: 0 }, 100, loose);
    expect(r.steps).toBe(1);
    expect(r.state.acc).toBeCloseTo(0, 10);
    expect(r.alpha).toBeCloseTo(0, 10);
  });

  it('半个步长的余数留给插值', () => {
    const r = tick({ acc: 0, prev: 0 }, 50, loose);
    expect(r.steps).toBe(0);
    expect(r.alpha).toBeCloseTo(0.5, 10);
  });

  it('累积两帧余数凑出一步', () => {
    const r1 = tick({ acc: 0, prev: 0 }, 50, loose);
    const r2 = tick(r1.state, 100, loose);
    expect(r1.steps).toBe(0);
    expect(r2.steps).toBe(1);
    expect(r2.alpha).toBeCloseTo(0, 10);
  });

  it('不修改传入的 state（纯函数）', () => {
    const state: TickState = { acc: 0, prev: 0 };
    tick(state, 50, loose);
    expect(state).toEqual({ acc: 0, prev: 0 });
  });

  it('补步上限：1 秒只补 3 步，不是 60 步', () => {
    const r = tick({ acc: 0, prev: 0 }, 1000, { step: 1 / 60, maxFrameTime: 1, maxSubSteps: 3 });
    expect(r.steps).toBe(3);
    expect(r.state.acc).toBeGreaterThanOrEqual(0);
    expect(r.state.acc).toBeLessThan(1 / 60);
    expect(r.alpha).toBeLessThan(1);
  });

  it('连续大跳帧不会累积欠账（不雪崩）', () => {
    let state: TickState = { acc: 0, prev: 0 };
    let total = 0;
    for (let i = 1; i <= 5; i += 1) {
      const r = tick(state, i * 1000, { step: 1 / 60, maxFrameTime: 1, maxSubSteps: 3 });
      state = r.state;
      total += r.steps;
      expect(r.steps).toBe(3);
    }
    expect(total).toBe(15);
  });

  it('单帧最大间隔钳制', () => {
    const r = tick({ acc: 0, prev: 0 }, 10000, { step: 0.05, maxFrameTime: 0.25, maxSubSteps: 100 });
    expect(r.frameTime).toBeCloseTo(0.25, 10);
    expect(r.steps).toBe(5);
  });

  it('时间倒退按 0 处理', () => {
    const r = tick({ acc: 0, prev: 1000 }, 500, loose);
    expect(r.frameTime).toBe(0);
    expect(r.steps).toBe(0);
    expect(r.state.prev).toBe(500);
  });

  it('非法时间戳不污染累加器', () => {
    const state: TickState = { acc: 0.03, prev: 1000 };
    const r1 = tick(state, Number.NaN, loose);
    const r2 = tick(state, Number.POSITIVE_INFINITY, loose);
    expect(r1.steps).toBe(0);
    expect(r1.state).toBe(state);
    expect(r2.state).toBe(state);
  });

  it('非法步长回落到默认值', () => {
    const r = tick({ acc: 0, prev: 0 }, 1000, { step: 0, maxSubSteps: 100 });
    // 0.25s 钳制 ÷ 1/60 步长 = 15 步（不是 60：1s 被 maxFrameTime 默认值 0.25 钳掉了）
    expect(r.steps).toBe(Math.floor(DEFAULT_MAX_FRAME_TIME / DEFAULT_STEP + 1e-9));
  });

  it('默认参数：step 1/60、最多补 3 步', () => {
    const r = tick({ acc: 0, prev: 0 }, 1000);
    expect(r.steps).toBe(DEFAULT_MAX_SUB_STEPS);
  });
});

describe('createLoop', () => {
  it('首帧不 update 不 render，第二帧按步长 update', () => {
    const updates: number[] = [];
    const renders: number[] = [];
    const { schedule, queue } = makeScheduler();
    const loop = createLoop({
      update: (dt) => updates.push(dt),
      render: (a) => renders.push(a),
      step: 0.1,
      schedule,
    });
    loop.start();
    expect(loop.running).toBe(true);
    expect(queue.length).toBe(1);

    take(queue)(1000);
    expect(updates.length).toBe(0);
    expect(renders.length).toBe(0);
    expect(queue.length).toBe(1);

    take(queue)(1100);
    expect(updates).toEqual([0.1]);
    expect(renders.length).toBe(1);
    expect(renders[0]).toBeCloseTo(0, 10);
  });

  it('stop 取消排帧且幂等，start 重置累加器', () => {
    const updates: number[] = [];
    const { schedule, queue } = makeScheduler();
    const loop = createLoop({ update: () => updates.push(1), render: () => undefined, step: 0.1, schedule });
    loop.start();
    take(queue)(1000);
    loop.stop();
    expect(loop.running).toBe(false);
    expect(queue.length).toBe(0);
    loop.stop();
    expect(loop.running).toBe(false);

    let state: TickState = loop.state;
    expect(state.prev).toBe(1000);
    loop.start();
    state = loop.state;
    expect(state.prev).toBeNull();
    expect(state.acc).toBe(0);
  });

  it('frame 手动推进返回本帧步数', () => {
    const { schedule } = makeScheduler();
    const loop = createLoop({ update: () => undefined, render: () => undefined, step: 0.1, schedule });
    expect(loop.frame(1000)).toBe(0);
    expect(loop.frame(1050)).toBe(0);
    expect(loop.frame(1100)).toBe(1);
    expect(loop.params.step).toBeCloseTo(0.1, 10);
  });

  it('大跳帧只补上限步数', () => {
    const updates: number[] = [];
    const loop = createLoop({
      update: () => updates.push(1),
      render: () => undefined,
      step: 1 / 60,
      maxSubSteps: 3,
      schedule: () => () => undefined,
    });
    loop.frame(0);
    expect(loop.frame(5000)).toBe(3);
    expect(updates.length).toBe(3);
  });
});
