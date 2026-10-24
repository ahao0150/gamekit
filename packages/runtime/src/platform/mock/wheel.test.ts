/**
 * mock 滚轮注入的契约测试（T36）。
 *
 * mock 是「可编程假平台」：测试与离线验收要能随时造一条滚轮事件，
 * 所以它**恒有** onWheel（不像 wx / tt 要看宿主）。
 */

import { describe, expect, it } from 'vitest';
import { createMockAdapter } from './index';
import type { WheelEvent } from '../contract';

describe('mock 的滚轮控制面', () => {
  it('适配器恒有 onWheel（不依赖能力集合）', () => {
    const adapter = createMockAdapter({ capabilities: [] });
    expect(adapter.onWheel).toBeDefined();
  });

  it('emitWheel 把所有字段原样发给订阅者', () => {
    const adapter = createMockAdapter();
    if (adapter.onWheel === undefined) throw new Error('mock 该有 onWheel');
    const got: WheelEvent[] = [];
    adapter.onWheel((e) => got.push(e));
    adapter.emitWheel(120, 300, -2, 48, 555);

    expect(got).toHaveLength(1);
    expect(got[0]).toEqual({ x: 120, y: 300, deltaX: -2, deltaY: 48, time: 555 });
  });

  it('time 省略时为 0（测试里不用每次造时间戳）', () => {
    const adapter = createMockAdapter();
    if (adapter.onWheel === undefined) throw new Error('mock 该有 onWheel');
    const got: WheelEvent[] = [];
    adapter.onWheel((e) => got.push(e));
    adapter.emitWheel(0, 0, 0, 100);
    expect(got[0]?.time).toBe(0);
  });

  it('退订后不再收到（订阅集合按实例隔离，互不串台）', () => {
    const a = createMockAdapter();
    const b = createMockAdapter();
    if (a.onWheel === undefined || b.onWheel === undefined) throw new Error('mock 该有 onWheel');
    const gotA: WheelEvent[] = [];
    const gotB: WheelEvent[] = [];
    const off = a.onWheel((e) => gotA.push(e));
    b.onWheel((e) => gotB.push(e));
    a.emitWheel(0, 0, 0, 10);
    off();
    a.emitWheel(0, 0, 0, 20);
    expect(gotA).toHaveLength(1);
    expect(gotB).toHaveLength(0); // 两个实例互不影响
  });
});
