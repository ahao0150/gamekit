/**
 * 轮播吸附状态机单测（T21）：五种松手情形 + 吸附帧序列 + loop 回绕。
 *
 * 关键口径（写进测试也写进实现注释）：`offset` 是**相对 index 的偏移**，翻页时
 * release 立即更新 index 并换算 offset，保证「换算前后视觉位置不变」
 *（`旧 index×pageW + 旧 offset === 新 index×pageW + 新 offset`），
 * 这样 tick 只需把 offset 收敛到 0，吸附中途不会跳页。
 */

import { describe, expect, it } from 'vitest';
import {
  IDLE_CAROUSEL,
  carouselDragEnd,
  carouselDragMove,
  carouselDragStart,
  carouselNext,
  carouselPrev,
  carouselRelease,
  carouselTick,
} from './carousel';

/** 页宽 390，翻页阈值 = 390/3 = 130。 */
const PAGE = 390;
const COUNT = 5;

/** 视觉位置：当前画面相对内容原点的偏移。 */
const visual = (index: number, offset: number): number => index * PAGE + offset;

describe('拖动（跟手 + 硬钳制）', () => {
  it('IDLE_CAROUSEL 是零值常量', () => {
    expect(IDLE_CAROUSEL).toEqual({ index: 0, offset: 0, dragging: false, velocity: 0 });
  });

  it('dragStart：dragging=true、速度清零、保留 index/offset', () => {
    expect(carouselDragStart({ index: 2, offset: 30, dragging: false, velocity: 900 })).toEqual({
      index: 2,
      offset: 30,
      dragging: true,
      velocity: 0,
    });
  });

  it('拖动跟手并硬钳到 [-pageW, pageW]：+100 / +500 / -500', () => {
    const held = carouselDragStart(IDLE_CAROUSEL);
    expect(carouselDragMove(held, 100, PAGE, COUNT).offset).toBe(100);
    expect(carouselDragMove(held, 500, PAGE, COUNT).offset).toBe(PAGE);
    expect(carouselDragMove(held, -500, PAGE, COUNT).offset).toBe(-PAGE);
  });

  it('非拖动状态 move 无效（原样返回同一个状态）', () => {
    expect(carouselDragMove(IDLE_CAROUSEL, 100, PAGE, COUNT)).toBe(IDLE_CAROUSEL);
  });

  it('只有一页时 offset 恒 0；dragEnd 关 dragging 并清速度', () => {
    expect(carouselDragMove(carouselDragStart(IDLE_CAROUSEL), 200, PAGE, 1).offset).toBe(0);
    expect(carouselDragEnd({ index: 1, offset: 50, dragging: true, velocity: 700 })).toEqual({
      index: 1,
      offset: 50,
      dragging: false,
      velocity: 0,
    });
  });
});

describe('松手吸附：五种情形', () => {
  it('① offset 100（阈值 130 以内）→ 回弹当前页', () => {
    const released = carouselRelease({ index: 0, offset: 100, dragging: false, velocity: 0 }, 0, PAGE, COUNT);
    expect(released).toEqual({ index: 0, offset: 100, dragging: false, velocity: 0 });
  });

  it('② offset 200（超阈值）→ 翻到下一页，offset 换算后视觉位置连续', () => {
    const released = carouselRelease({ index: 0, offset: 200, dragging: false, velocity: 0 }, 0, PAGE, COUNT);
    expect(released.index).toBe(1);
    expect(released.offset).toBe(-190); // 200 + (0-1)×390
    expect(visual(1, released.offset)).toBe(200); // 换算前后画面不跳
    expect(visual(0, 200)).toBe(200);
  });

  it('③ velocity 800（快速轻扫）→ 下一页，即使 offset 为 0', () => {
    const released = carouselRelease({ index: 2, offset: 0, dragging: false, velocity: 0 }, 800, PAGE, COUNT);
    expect(released.index).toBe(3);
    expect(released.offset).toBe(-PAGE); // 0 + (2-3)×390
    expect(visual(3, released.offset)).toBe(visual(2, 0));
  });

  it('④ velocity -800 → 上一页', () => {
    const released = carouselRelease({ index: 2, offset: 0, dragging: false, velocity: 0 }, -800, PAGE, COUNT);
    expect(released.index).toBe(1);
    expect(released.offset).toBe(PAGE);
  });

  it('⑤ offset 200 + velocity -800 → **速度优先**：吞掉位移、回上一页', () => {
    const released = carouselRelease({ index: 2, offset: 200, dragging: false, velocity: 0 }, -800, PAGE, COUNT);
    expect(released.index).toBe(1); // 按速度回上一页，而不是按位移去下一页
    expect(released.offset).toBe(590); // 200 + (2-1)×390
    expect(visual(1, released.offset)).toBe(visual(2, 200));
  });

  it('到边界：offset 方向超界回弹、速度方向超界也不动（release 不带 loop）', () => {
    const first = carouselRelease({ index: 0, offset: -200, dragging: false, velocity: 0 }, 0, PAGE, COUNT);
    expect(first.index).toBe(0);
    expect(first.offset).toBe(-200);
    const last = carouselRelease({ index: 4, offset: 0, dragging: false, velocity: 0 }, 800, PAGE, COUNT);
    expect(last.index).toBe(4);
    expect(last.offset).toBe(0);
  });

  it('velocity 刚好 500 不触发快速翻页（阈值是「大于」）', () => {
    expect(carouselRelease({ index: 2, offset: 0, dragging: false, velocity: 0 }, 500, PAGE, COUNT).index).toBe(2);
    expect(carouselRelease({ index: 2, offset: 0, dragging: false, velocity: 0 }, 501, PAGE, COUNT).index).toBe(3);
  });
});

describe('吸附推进（carouselTick）', () => {
  it('从 release 后的 offset -190 收敛到严格 0：72 帧，index 保持 +1', () => {
    let state = carouselRelease({ index: 0, offset: 200, dragging: false, velocity: 0 }, 0, PAGE, COUNT);
    expect(state.index).toBe(1);
    const frames: number[] = [];
    let frame = 0;
    while (state.offset !== 0 && frame < 600) {
      state = carouselTick(state, 1 / 60, PAGE, COUNT);
      frame += 1;
      if (frame % 10 === 0) frames.push(state.offset);
    }
    expect(frame).toBe(72);
    expect(state.offset).toBe(0); // 严格 0，不是「接近 0」
    expect(state.index).toBe(1);
    expect(frames[0]).toBeCloseTo(-82.53, 1); // 第 10 帧 = -190 × 0.92¹⁰
    // 单调收敛（不会来回摆）
    for (let i = 1; i < frames.length; i += 1) expect(frames[i]!).toBeGreaterThan(frames[i - 1]!);
  });

  it('dt = 1 秒与跑 60 帧结果一致（同一套指数衰减，不另写 easing）', () => {
    const start = { index: 1, offset: -190, dragging: false, velocity: 0 };
    const oneShot = carouselTick(start, 1, PAGE, COUNT);
    let perFrame = start;
    for (let i = 0; i < 60; i += 1) perFrame = carouselTick(perFrame, 1 / 60, PAGE, COUNT);
    expect(oneShot.offset).toBeCloseTo(perFrame.offset, 10);
  });

  it('已经对齐时 tick 不动；拖动中 tick 不吸附', () => {
    expect(carouselTick(IDLE_CAROUSEL, 1 / 60, PAGE, COUNT)).toEqual(IDLE_CAROUSEL);
    const held = { index: 1, offset: 120, dragging: true, velocity: 0 };
    expect(carouselTick(held, 1 / 60, PAGE, COUNT)).toEqual(held);
  });

  it('dt 非法不推进；NaN offset 不崩', () => {
    const state = { index: 1, offset: 100, dragging: false, velocity: 0 };
    expect(carouselTick(state, Number.NaN, PAGE, COUNT).offset).toBe(100);
    expect(carouselTick({ ...state, offset: Number.NaN }, 1 / 60, PAGE, COUNT).offset).toBe(0);
  });
});

describe('按钮翻页（carouselNext / carouselPrev）', () => {
  it('loop：最后一页 next → 0，第一页 prev → count-1', () => {
    const last = { index: 4, offset: 0, dragging: false, velocity: 0 };
    expect(carouselNext(last, COUNT, true).index).toBe(0);
    const first = { index: 0, offset: 0, dragging: false, velocity: 0 };
    expect(carouselPrev(first, COUNT, true).index).toBe(4);
  });

  it('非 loop：到边界不动', () => {
    expect(carouselNext({ index: 4, offset: 0, dragging: false, velocity: 0 }, COUNT).index).toBe(4);
    expect(carouselPrev({ index: 0, offset: 0, dragging: false, velocity: 0 }, COUNT).index).toBe(0);
  });

  it('翻页后 offset 归零；只有一页时索引恒 0', () => {
    expect(carouselNext({ index: 1, offset: 120, dragging: false, velocity: 0 }, COUNT, true)).toEqual({
      index: 2,
      offset: 0,
      dragging: false,
      velocity: 0,
    });
    expect(carouselNext({ index: 0, offset: 0, dragging: false, velocity: 0 }, 1, true).index).toBe(0);
  });
});
