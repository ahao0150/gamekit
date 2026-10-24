/**
 * 拖拽状态机单测（T22）：阈值、多点、松手结果、坏输入。
 *
 * 手感规则必须逐条断言：≤8px 算点击、>8px 算拖拽、**active 后不回退**（手指抖回去
 * 仍是拖拽）——这三条在真机上很难测出来，只能靠单测锁住。
 */

import { describe, expect, it } from 'vitest';
import type { HitEntry } from './hit';
import type { Rect } from './contract';
import { DRAG_THRESHOLD, IDLE_DRAG, dragEnd, dragMove, dragStart } from './drag';

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const entry = (name: string, box: Rect, index: number): HitEntry => ({
  name,
  rect: box,
  hit: 'self',
  layer: 0,
  index,
});

/** 底板盖满屏、卡牌在上（index 更大 → pickHit 优先卡牌）。 */
const bg = entry('bg', rect(0, 0, 400, 800), 0);
const card = entry('card', rect(100, 100, 80, 120), 1);
const entries = [bg, card];
/** 卡牌中心。 */
const onCard = { x: 140, y: 160 };
/** 底板空白处。 */
const onBg = { x: 350, y: 600 };

describe('按下（dragStart）', () => {
  it('白名单内按下 → 记下元素名、指针、按下点，dx/dy=0、active=false', () => {
    expect(dragStart(IDLE_DRAG, entries, onCard, 1, ['card'])).toEqual({
      target: 'card',
      pointerId: 1,
      startX: 140,
      startY: 160,
      dx: 0,
      dy: 0,
      active: false,
    });
  });

  it('元素不在白名单 → IDLE_DRAG（白名单外的按下不产生拖拽）', () => {
    expect(dragStart(IDLE_DRAG, entries, onCard, 1, [])).toBe(IDLE_DRAG);
    expect(dragStart(IDLE_DRAG, entries, onBg, 1, ['card'])).toBe(IDLE_DRAG);
  });

  it('按在空白处（没有任何元素）→ IDLE_DRAG', () => {
    expect(dragStart(IDLE_DRAG, [], onCard, 1, ['card'])).toBe(IDLE_DRAG);
  });

  it('多点：已经按住时第二个指针按下被忽略', () => {
    const held = dragStart(IDLE_DRAG, entries, onCard, 1, ['card']);
    expect(dragStart(held, entries, onCard, 2, ['card'])).toBe(held);
  });

  it('NaN 坐标 / NaN pointerId 的按下被忽略', () => {
    expect(dragStart(IDLE_DRAG, entries, { x: Number.NaN, y: 160 }, 1, ['card'])).toBe(IDLE_DRAG);
    expect(dragStart(IDLE_DRAG, entries, onCard, Number.NaN, ['card'])).toBe(IDLE_DRAG);
  });
});

describe('移动（dragMove）：阈值与不回退', () => {
  const held = dragStart(IDLE_DRAG, entries, onCard, 1, ['card']);

  it('移动 5px → active 仍 false（这还是点击）', () => {
    const moved = dragMove(held, { x: 145, y: 160 });
    expect(moved.dx).toBe(5);
    expect(moved.active).toBe(false);
  });

  it('移动 9px → active=true', () => {
    expect(dragMove(held, { x: 149, y: 160 }).active).toBe(true);
  });

  it('恰好 8px 仍是点击（阈值是「大于」），8.1px 才算拖拽', () => {
    expect(dragMove(held, { x: 148, y: 160 }).active).toBe(false);
    expect(dragMove(held, { x: 148.1, y: 160 }).active).toBe(true);
  });

  it('斜着拖 6+6px（欧氏 8.49）也算拖拽', () => {
    const moved = dragMove(held, { x: 146, y: 166 });
    expect(moved.active).toBe(true);
    expect(Math.hypot(moved.dx, moved.dy)).toBeCloseTo(8.49, 1);
  });

  it('active 之后再抖回 2px → 仍 active（不回退）', () => {
    const active = dragMove(held, { x: 160, y: 160 });
    expect(active.active).toBe(true);
    const back = dragMove(active, { x: 142, y: 160 });
    expect(back.dx).toBe(2); // 位移跟着手指
    expect(back.active).toBe(true); // 但「这是拖拽」的判定不回退
  });

  it('空闲状态 / 坏坐标的移动原样返回', () => {
    expect(dragMove(IDLE_DRAG, { x: 200, y: 200 })).toBe(IDLE_DRAG);
    expect(dragMove(held, { x: Number.NaN, y: 160 })).toBe(held);
  });

  it('阈值可覆盖（threshold=0 → 一动就算拖拽）', () => {
    expect(dragMove(held, { x: 141, y: 160 }, 0).active).toBe(true);
  });
});

describe('松开（dragEnd）', () => {
  it('拖拽松手：交回 dx/dy/point/active，状态回 IDLE', () => {
    const held = dragStart(IDLE_DRAG, entries, onCard, 1, ['card']);
    const moved = dragMove(held, { x: 180, y: 200 });
    const { state, result } = dragEnd(moved);
    expect(state).toBe(IDLE_DRAG);
    expect(result).toEqual({ target: 'card', dx: 40, dy: 40, active: true, point: { x: 180, y: 200 } });
  });

  it('没越过阈值就松手：**仍然返回 result**，但 active=false（这其实是点击）', () => {
    const held = dragStart(IDLE_DRAG, entries, onCard, 1, ['card']);
    const moved = dragMove(held, { x: 143, y: 160 });
    const { result } = dragEnd(moved);
    expect(result).toEqual({ target: 'card', dx: 3, dy: 0, active: false, point: { x: 143, y: 160 } });
  });

  it('up 的 pointerId 不匹配 → 无效（状态保持，result=null），正确的 id 仍能结束', () => {
    const held = dragStart(IDLE_DRAG, entries, onCard, 1, ['card']);
    const wrong = dragEnd(held, 2);
    expect(wrong.result).toBeNull();
    expect(wrong.state).toBe(held);
    const right = dragEnd(wrong.state, 1);
    expect(right.result?.target).toBe('card');
    expect(right.state).toBe(IDLE_DRAG);
  });

  it('空闲时 up 是空操作', () => {
    expect(dragEnd(IDLE_DRAG)).toEqual({ state: IDLE_DRAG, result: null });
  });
});

describe('异常与完整链路', () => {
  it('元素从布局消失后 move / up 不崩（状态机不查布局）', () => {
    const held = dragStart(IDLE_DRAG, entries, onCard, 1, ['card']);
    expect(() => dragMove(held, { x: 300, y: 300 })).not.toThrow();
    expect(dragEnd(dragMove(held, { x: 300, y: 300 })).result?.dx).toBe(160);
  });

  it('默认阈值常量是 8', () => {
    expect(DRAG_THRESHOLD).toBe(8);
  });

  it('完整链路：按下 → 拖 40px → 松手 → 再按下 → 轻移 3px 松手（第二次 active=false）', () => {
    const first = dragStart(IDLE_DRAG, entries, onCard, 1, ['card']);
    const dragged = dragEnd(dragMove(first, { x: 180, y: 160 })).result;
    expect(dragged?.active).toBe(true);

    const second = dragStart(IDLE_DRAG, entries, onCard, 1, ['card']);
    const tapped = dragEnd(dragMove(second, { x: 143, y: 160 })).result;
    expect(tapped?.active).toBe(false);
  });
});
