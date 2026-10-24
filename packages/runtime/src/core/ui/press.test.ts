/**
 * 按下状态机单测（T17）：每条规则一条测试，断言的是**状态迁移**（纯函数）。
 *
 * 这里不画任何东西，所以不涉及「真实绘制」；但每个用例都写清「按了什么 → 期望什么」，
 * 手感规则（移出取消、移回不恢复、多点忽略）必须能被逐条断言，而不是靠试玩。
 */

import { describe, expect, it } from 'vitest';
import type { HitEntry, HitMode } from './hit';
import type { Rect } from './contract';
import { IDLE_PRESS, pressDown, pressMove, pressUp } from './press';

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

const entry = (name: string, box: Rect, hit: HitMode = 'self', index = 0, layer = 0): HitEntry => ({
  name,
  rect: box,
  hit,
  layer,
  index,
});

/** 一个 100×50 的按钮。 */
const button = entry('playButton', rect(100, 100, 100, 50));
/** 盖住整个屏幕的遮罩（block，层更高 → 画在上面）。 */
const mask = entry('mask', rect(0, 0, 400, 800), 'block', 0, 1);
/** 叠在按钮上但穿透的装饰（none）。 */
const ghost = entry('ghost', rect(100, 100, 100, 50), 'none', 1, 1);
/** 按钮中心。 */
const inside = { x: 150, y: 125 };
/** 远离按钮的空白。 */
const outside = { x: 350, y: 700 };

describe('按下（pressDown）', () => {
  it('命中 self 元素 → 进入 pressed，记下 pointerId', () => {
    const next = pressDown(IDLE_PRESS, [button], inside, 1);
    expect(next).toEqual({ pressed: 'playButton', pointerId: 1 });
  });

  it('按在空白处 → 仍是 IDLE', () => {
    expect(pressDown(IDLE_PRESS, [button], outside, 1)).toBe(IDLE_PRESS);
  });

  it('按在 block 遮罩上 → 不产生 pressed（遮罩吃点击但没动作）', () => {
    expect(pressDown(IDLE_PRESS, [button, mask], inside, 1)).toEqual(IDLE_PRESS);
  });

  it('按在 none 装饰上 → 穿透到下面的按钮', () => {
    const next = pressDown(IDLE_PRESS, [button, ghost], inside, 1);
    expect(next.pressed).toBe('playButton');
  });

  it('已经按住时第二个指针按下被忽略（多点保护）', () => {
    const held = pressDown(IDLE_PRESS, [button], inside, 1);
    const second = pressDown(held, [button], inside, 2);
    expect(second).toBe(held);
  });

  it('NaN 坐标 / NaN pointerId 的按下被忽略，不产生半截状态', () => {
    expect(pressDown(IDLE_PRESS, [button], { x: Number.NaN, y: 125 }, 1)).toBe(IDLE_PRESS);
    expect(pressDown(IDLE_PRESS, [button], inside, Number.NaN)).toBe(IDLE_PRESS);
  });
});

describe('移动（pressMove）', () => {
  it('按住期间移出原元素 → 取消', () => {
    const held = pressDown(IDLE_PRESS, [button], inside, 1);
    expect(pressMove(held, [button], outside)).toBe(IDLE_PRESS);
  });

  it('移出后再移回来 → 不恢复（标准按钮手感）', () => {
    const held = pressDown(IDLE_PRESS, [button], inside, 1);
    const away = pressMove(held, [button], outside);
    const back = pressMove(away, [button], inside);
    expect(away).toBe(IDLE_PRESS);
    expect(back).toBe(IDLE_PRESS);
  });

  it('按住期间指针滑到盖在上面的遮罩上 → 取消（不算还在按按钮）', () => {
    const held = pressDown(IDLE_PRESS, [button], inside, 1);
    expect(pressMove(held, [button, mask], inside)).toBe(IDLE_PRESS);
  });

  it('按住期间坐标变成 NaN → 按取消处理（不崩、不留半截状态）', () => {
    const held = pressDown(IDLE_PRESS, [button], inside, 1);
    expect(pressMove(held, [button], { x: Number.NaN, y: Number.NaN })).toBe(IDLE_PRESS);
  });

  it('空闲时移动是空操作', () => {
    expect(pressMove(IDLE_PRESS, [button], inside)).toBe(IDLE_PRESS);
  });
});

describe('松开（pressUp）', () => {
  it('松手点仍在元素内 → 激活该元素，状态回 IDLE', () => {
    const held = pressDown(IDLE_PRESS, [button], inside, 1);
    expect(pressUp(held, [button], inside, 1)).toEqual({ state: IDLE_PRESS, activated: 'playButton' });
  });

  it('松手点在别处 → 不激活（滑出取消）', () => {
    const held = pressDown(IDLE_PRESS, [button], inside, 1);
    expect(pressUp(held, [button], outside, 1)).toEqual({ state: IDLE_PRESS, activated: null });
  });

  it('pointerId 不匹配 → 状态不变、不激活（别的指针的 up 不能打断按住）', () => {
    const held = pressDown(IDLE_PRESS, [button], inside, 1);
    const wrong = pressUp(held, [button], inside, 2);
    expect(wrong).toEqual({ state: held, activated: null });
    // 正确的那个指针随后松开仍然能激活
    expect(pressUp(wrong.state, [button], inside, 1).activated).toBe('playButton');
  });

  it('pressed 元素从布局里消失 → up 安全，不激活', () => {
    const held = pressDown(IDLE_PRESS, [button], inside, 1);
    expect(pressUp(held, [], inside, 1)).toEqual({ state: IDLE_PRESS, activated: null });
  });

  it('元素消失后 move 也安全（退化成 IDLE）', () => {
    const held = pressDown(IDLE_PRESS, [button], inside, 1);
    expect(pressMove(held, [], inside)).toBe(IDLE_PRESS);
  });

  it('空闲时 up 是空操作', () => {
    expect(pressUp(IDLE_PRESS, [button], inside, 1)).toEqual({ state: IDLE_PRESS, activated: null });
  });
});

describe('完整链路', () => {
  it('按下 → 移出 → 移回 → 松开：不激活', () => {
    let state = pressDown(IDLE_PRESS, [button], inside, 1);
    state = pressMove(state, [button], outside);
    state = pressMove(state, [button], inside);
    expect(pressUp(state, [button], inside, 1)).toEqual({ state: IDLE_PRESS, activated: null });
  });

  it('按下 → 松开 → 再按下 → 松开：两次都能激活（状态可重复使用）', () => {
    const first = pressUp(pressDown(IDLE_PRESS, [button], inside, 1), [button], inside, 1);
    const second = pressUp(pressDown(first.state, [button], inside, 1), [button], inside, 1);
    expect(first.activated).toBe('playButton');
    expect(second.activated).toBe('playButton');
  });
});
