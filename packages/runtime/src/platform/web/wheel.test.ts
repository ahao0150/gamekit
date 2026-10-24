/**
 * web 滚轮接线的契约测试（T36）。
 *
 * node 里没有 DOM，所以注入**假画布**（只实现 addEventListener /
 * removeEventListener / getBoundingClientRect），然后真的把事件对象喂给
 * 注册进去的监听器 —— 断言的是「浏览器里会发生什么」，不是「函数被调过」：
 *
 * 1. 真绑在 `wheel` 上，且 `passive: false`（不 passive 才能 preventDefault）；
 * 2. `preventDefault()` 必须被调用（画布铺满视口，滚页面没意义）；
 * 3. `deltaMode` 三档归一：0 原样 / 1 ×16 / 2 × 画布 CSS 高；
 * 4. 坐标走 `toCanvasPoint`：画布在页面里偏移时，x/y 要减掉偏移；
 * 5. 解绑后监听器真的从画布上摘掉。
 */

import { describe, expect, it } from 'vitest';
import { attachWheelEvents } from './events';
import type { EmitWheel } from './events';

interface FakeWheelEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly timeStamp: number;
  preventDefault(): void;
}

interface FakeCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly listeners: Map<string, Array<(e: unknown) => void>>;
  readonly options: AddEventListenerOptions[];
  readonly prevented: () => number;
  fire(type: string, event: FakeWheelEvent): void;
}

const makeCanvas = (box = { left: 0, top: 0, width: 390, height: 844 }): FakeCanvas => {
  const listeners = new Map<string, Array<(e: unknown) => void>>();
  const options: AddEventListenerOptions[] = [];
  let prevented = 0;
  const canvas = {
    getBoundingClientRect: () => box,
    addEventListener: (type: string, fn: (e: unknown) => void, opts?: AddEventListenerOptions): void => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
      if (opts !== undefined) options.push(opts);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void): void => {
      const list = listeners.get(type) ?? [];
      listeners.set(type, list.filter((each) => each !== fn));
    },
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    listeners,
    options,
    prevented: () => prevented,
    fire: (type, event) => {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
};

const wheel = (over: Partial<FakeWheelEvent> = {}): FakeWheelEvent => ({
  clientX: 100,
  clientY: 200,
  deltaX: 0,
  deltaY: 100,
  deltaMode: 0,
  timeStamp: 1234,
  preventDefault: () => {
    // 计数量在 makeCanvas 的闭包里：这里由下面的 helper 替换
  },
  ...over,
});

/** 收集一次滚轮事件的 emit 结果；同时统计 preventDefault 次数。 */
const capture = (fake: FakeCanvas, event: FakeWheelEvent): { got: number[][]; prevented: number } => {
  let prevented = 0;
  const got: number[][] = [];
  const emit: EmitWheel = (x, y, deltaX, deltaY, time) => got.push([x, y, deltaX, deltaY, time]);
  const detach = attachWheelEvents(fake.canvas, emit);
  fake.fire('wheel', {
    ...event,
    preventDefault: () => {
      prevented += 1;
    },
  });
  detach();
  return { got, prevented };
};

describe('attachWheelEvents', () => {
  it('绑在 wheel 上、passive: false，且调了 preventDefault', () => {
    const fake = makeCanvas();
    let prevented = 0;
    const emit = (): void => undefined;
    attachWheelEvents(fake.canvas, emit);
    expect(fake.listeners.get('wheel')).toHaveLength(1);
    expect(fake.options[0]).toEqual({ passive: false });
    fake.fire('wheel', { ...wheel(), preventDefault: () => { prevented += 1; } });
    expect(prevented).toBe(1);
  });

  it('deltaMode 0（像素）：原样透传，坐标减掉画布偏移', () => {
    const fake = makeCanvas({ left: 50, top: 20, width: 390, height: 844 });
    const { got, prevented } = capture(fake, wheel({ clientX: 150, clientY: 220, deltaY: 120 }));
    expect(got[0]).toEqual([100, 200, 0, 120, 1234]);
    expect(prevented).toBe(1);
  });

  it('deltaMode 1（行）：3 行 → 48px（× WHEEL_LINE_HEIGHT=16）', () => {
    const fake = makeCanvas();
    const { got } = capture(fake, wheel({ deltaY: 3, deltaMode: 1 }));
    expect(got[0]?.[3]).toBe(48);
  });

  it('deltaMode 2（页）：1 页 → 画布 CSS 高（844）', () => {
    const fake = makeCanvas({ left: 0, top: 0, width: 390, height: 844 });
    const { got } = capture(fake, wheel({ deltaY: 1, deltaMode: 2 }));
    expect(got[0]?.[3]).toBe(844);
    // 负方向也保留
    const up = capture(fake, wheel({ deltaY: -1, deltaMode: 2 }));
    expect(up.got[0]?.[3]).toBe(-844);
  });

  it('deltaX 同样归一（横向滚轮 / 触控板横滑）', () => {
    const fake = makeCanvas();
    const { got } = capture(fake, wheel({ deltaX: 2, deltaY: 0, deltaMode: 1 }));
    expect(got[0]?.[2]).toBe(32);
  });

  it('解绑后不再收到事件', () => {
    const fake = makeCanvas();
    const got: number[][] = [];
    const detach = attachWheelEvents(fake.canvas, (x, y, dx, dy, t) => got.push([x, y, dx, dy, t]));
    detach();
    expect(fake.listeners.get('wheel')).toHaveLength(0);
    fake.fire('wheel', wheel());
    expect(got).toHaveLength(0);
  });
});
