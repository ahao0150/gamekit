/**
 * 小游戏端滚轮装配的契约测试（T36）。
 *
 * 守的是三条语义（wx / tt 共用同一份 `createMiniWheel`，所以只测一次）：
 * 1. 宿主没有 `onWheel` → 返回 null，适配器不暴露这个成员（成员在不在 = 能力信号）；
 * 2. **懒注册**：第一个订阅者到来才调宿主 onWheel；没人订阅时零开销；
 * 3. **引用计数退订**：最后一个订阅者解绑才调 offWheel；宿主没 offWheel 也不崩。
 *
 * 另测字段映射：缺失 / NaN 字段一律填 0，绝不让 undefined 漏进滚动计算。
 */

import { describe, expect, it } from 'vitest';
import type { WheelEvent } from './contract';
import { createMiniWheel } from './wheel-minigame';

interface RawWheel {
  readonly x?: number;
  readonly y?: number;
  readonly deltaX?: number;
  readonly deltaY?: number;
  readonly timeStamp?: number;
}

const makeSource = (opts: { readonly withOff?: boolean } = {}) => {
  const handlers: Array<(res: RawWheel) => void> = [];
  const offCalls: Array<((res: RawWheel) => void) | undefined> = [];
  const source = {
    onWheel: (cb: (res: RawWheel) => void): void => {
      handlers.push(cb);
    },
    ...(opts.withOff === true
      ? {
          offWheel: (cb?: (res: RawWheel) => void): void => {
            offCalls.push(cb);
          },
        }
      : {}),
  };
  const fire = (res: RawWheel): void => {
    for (const cb of [...handlers]) cb(res);
  };
  return { source, handlers, offCalls, fire };
};

/** 把缺失字段当 0 的映射（与 wx / tt 适配器里的实现同一套规则）。 */
const map = (res: RawWheel): WheelEvent => ({
  x: Number.isFinite(res.x) ? (res.x as number) : 0,
  y: Number.isFinite(res.y) ? (res.y as number) : 0,
  deltaX: Number.isFinite(res.deltaX) ? (res.deltaX as number) : 0,
  deltaY: Number.isFinite(res.deltaY) ? (res.deltaY as number) : 0,
  time: Number.isFinite(res.timeStamp) ? (res.timeStamp as number) : 0,
});

describe('createMiniWheel', () => {
  it('宿主没有 onWheel → 返回 null（手机端 / 老基础库）', () => {
    expect(createMiniWheel<RawWheel>({}, map)).toBeNull();
    expect(createMiniWheel<RawWheel>({ onWheel: undefined }, map)).toBeNull();
  });

  it('懒注册：没人订阅时不调宿主 onWheel，第一个订阅者来了才注册', () => {
    const fake = makeSource({ withOff: true });
    const onWheel = createMiniWheel<RawWheel>(fake.source, map);
    if (onWheel === null) throw new Error('有 onWheel 的宿主不该返回 null');

    expect(fake.handlers).toHaveLength(0);
    const off = onWheel(() => undefined);
    expect(fake.handlers).toHaveLength(1);
    // 第二个订阅者不再重复注册宿主回调（一个宿主回调扇出给所有订阅者）
    const off2 = onWheel(() => undefined);
    expect(fake.handlers).toHaveLength(1);
    off();
    off2();
  });

  it('事件转发：字段映射成契约事件，两个订阅者都收到', () => {
    const fake = makeSource({ withOff: true });
    const onWheel = createMiniWheel<RawWheel>(fake.source, map);
    if (onWheel === null) throw new Error('不该为 null');

    const got: WheelEvent[] = [];
    onWheel((e) => got.push(e));
    onWheel((e) => got.push(e));
    fake.fire({ x: 12, y: 34, deltaX: -2, deltaY: 48, timeStamp: 999 });

    expect(got).toHaveLength(2);
    expect(got[0]).toEqual({ x: 12, y: 34, deltaX: -2, deltaY: 48, time: 999 });
  });

  it('缺失 / NaN 字段填 0（不让 undefined 漏进滚动计算）', () => {
    const fake = makeSource();
    const onWheel = createMiniWheel<RawWheel>(fake.source, map);
    if (onWheel === null) throw new Error('不该为 null');
    const got: WheelEvent[] = [];
    onWheel((e) => got.push(e));
    fake.fire({ x: Number.NaN });
    expect(got[0]).toEqual({ x: 0, y: 0, deltaX: 0, deltaY: 0, time: 0 });
  });

  it('引用计数退订：还有订阅者时不 off，最后一个解绑才调 offWheel（带上宿主回调）', () => {
    const fake = makeSource({ withOff: true });
    const onWheel = createMiniWheel<RawWheel>(fake.source, map);
    if (onWheel === null) throw new Error('不该为 null');
    const off1 = onWheel(() => undefined);
    const off2 = onWheel(() => undefined);
    off1();
    expect(fake.offCalls).toHaveLength(0);
    off2();
    expect(fake.offCalls).toHaveLength(1);
    expect(fake.offCalls[0]).toBe(fake.handlers[0]);
  });

  it('宿主没有 offWheel → 退订照样安全（只清本地订阅集合）', () => {
    const fake = makeSource();
    const onWheel = createMiniWheel<RawWheel>(fake.source, map);
    if (onWheel === null) throw new Error('不该为 null');
    const got: WheelEvent[] = [];
    const off = onWheel((e) => got.push(e));
    off();
    fake.fire({ deltaY: 10 });
    expect(got).toHaveLength(0); // 解绑后不再收到
    expect(fake.handlers).toHaveLength(1); // 宿主侧回调还在（没 offWheel 可调）
  });

  it('退订后再订阅 → 重新懒注册，且旧回调自行静默（不会被投递两次）', () => {
    const fake = makeSource({ withOff: true });
    const onWheel = createMiniWheel<RawWheel>(fake.source, map);
    if (onWheel === null) throw new Error('不该为 null');
    onWheel(() => undefined)();
    const got: WheelEvent[] = [];
    onWheel((e) => got.push(e));
    // 假宿主不真的摘回调：旧的那个还在列表里，但它的代次已过期 → 不发事件
    expect(fake.handlers).toHaveLength(2);
    fake.fire({ deltaY: 1 });
    expect(got).toHaveLength(1);
  });
});
