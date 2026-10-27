/**
 * `createCancel` 的契约测试：幂等、迟到注册、退订、回调隔离。
 *
 * 幂等那条不是形式主义：`request()` 的重试循环会在多个位置检查 `signal.aborted`，
 * 若一次 `abort()` 能通知多轮，取消回调会被重复触发（业务侧常在回调里弹提示）。
 */

import { describe, expect, it } from 'vitest';
import { createCancel } from './cancel';

describe('createCancel', () => {
  it('初始未取消，abort() 之后 aborted=true', () => {
    const cancel = createCancel();
    expect(cancel.signal.aborted).toBe(false);
    cancel.abort();
    expect(cancel.signal.aborted).toBe(true);
  });

  it('连续 abort() 两次 → onAbort 回调只触发一次（幂等）', () => {
    const cancel = createCancel();
    let calls = 0;
    cancel.signal.onAbort(() => {
      calls += 1;
    });
    cancel.abort();
    cancel.abort();
    cancel.abort();
    expect(calls).toBe(1);
  });

  it('已取消之后才注册 → 立刻同步通知一次（迟到注册不漏）', () => {
    const cancel = createCancel();
    cancel.abort();
    let calls = 0;
    const off = cancel.signal.onAbort(() => {
      calls += 1;
    });
    expect(calls).toBe(1);
    off();
    expect(calls).toBe(1);
  });

  it('退订之后不再收到通知', () => {
    const cancel = createCancel();
    let first = 0;
    let second = 0;
    const off = cancel.signal.onAbort(() => {
      first += 1;
    });
    cancel.signal.onAbort(() => {
      second += 1;
    });
    off();
    cancel.abort();
    expect(first).toBe(0);
    expect(second).toBe(1);
  });

  it('某个回调抛错不影响其余订阅者', () => {
    const cancel = createCancel();
    let reached = 0;
    cancel.signal.onAbort(() => {
      throw new Error('订阅者自己炸了');
    });
    cancel.signal.onAbort(() => {
      reached += 1;
    });
    cancel.abort();
    expect(reached).toBe(1);
  });

  it('同一次取消里再 abort() 不会重入通知', () => {
    const cancel = createCancel();
    let calls = 0;
    cancel.signal.onAbort(() => {
      calls += 1;
      cancel.abort(); // 回调里重复取消
    });
    cancel.abort();
    expect(calls).toBe(1);
  });
});
