/**
 * 多点按压状态机单测（T48）：每条规则一条测试，断言的是**状态迁移**（纯函数）。
 *
 * 核心回归：`press.ts` 的多点保护（第二个 pointer 被忽略）对 UI 按钮是对的，
 * 对游戏虚拟按键是错的 —— 用户真机反馈「按住左移再按跳，左移被打断」。
 * 这里逐条锁住「各 pointer 独立绑定、互不打断」的新语义。
 */

import { describe, expect, it } from 'vitest';
import type { HitEntry, HitMode } from './hit';
import type { Rect } from './contract';
import { EMPTY_MULTI_PRESS, isPressed, multiDown, multiMove, multiUp, pressedNames } from './multi-press';

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

const entry = (name: string, box: Rect, hit: HitMode = 'self', index = 0, layer = 0): HitEntry => ({
  name,
  rect: box,
  hit,
  layer,
  index,
});

/** 左下角的左移键、右下角的跳跃键（互不重叠）。 */
const leftButton = entry('leftButton', rect(0, 700, 80, 80));
const jumpButton = entry('jumpButton', rect(300, 700, 80, 80), 'self', 1);
/** 两个键都在其中的按钮。 */
const ENTRIES = [leftButton, jumpButton];
/** 盖住整个屏幕的遮罩（block，层更高 → 画在上面）。 */
const mask = entry('mask', rect(0, 0, 400, 800), 'block', 0, 1);
/** 叠在左移键上但穿透的装饰（none）。 */
const ghost = entry('ghost', rect(0, 700, 80, 80), 'none', 2, 1);
/** 两个键中心与一块空白。 */
const atLeft = { x: 40, y: 740 };
const atJump = { x: 340, y: 740 };
const blank = { x: 200, y: 200 };
const NaNPoint = { x: Number.NaN, y: Number.NaN };

describe('按下（multiDown）', () => {
  it('两个 pointer 同时按两个不同元素 → 两个都算被按着', () => {
    const state = multiDown(multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1), ENTRIES, atJump, 2);
    expect(state.get(1)).toBe('leftButton');
    expect(state.get(2)).toBe('jumpButton');
    expect(pressedNames(state)).toEqual(['leftButton', 'jumpButton']);
  });

  it('按住 A 再按 B → A 不被打断（本次核心 bug 的回归）', () => {
    const holdingLeft = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1);
    const both = multiDown(holdingLeft, ENTRIES, atJump, 2);
    // A 的绑定原样保留，B 是新增的，不是「覆盖」或「忽略」
    expect(isPressed(both, 'leftButton')).toBe(true);
    expect(isPressed(both, 'jumpButton')).toBe(true);
    expect(both.get(1)).toBe('leftButton');
  });

  it('同一 pointer 重复 down → 幂等，不产生重复绑定', () => {
    const first = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1);
    expect(multiDown(first, ENTRIES, atLeft, 1)).toBe(first);
    expect(first.size).toBe(1);
  });

  it('同一 pointer 在别处再 down → 不改绑（仍是第一个元素）', () => {
    const first = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1);
    const again = multiDown(first, ENTRIES, atJump, 1);
    expect(again).toBe(first);
    expect(isPressed(again, 'jumpButton')).toBe(false);
  });

  it('按在空白处 → 不产生绑定', () => {
    expect(multiDown(EMPTY_MULTI_PRESS, ENTRIES, blank, 1)).toBe(EMPTY_MULTI_PRESS);
  });

  it('按在 block 遮罩上 → 遮罩吃掉按下、不产生绑定', () => {
    expect(multiDown(EMPTY_MULTI_PRESS, [leftButton, mask], atLeft, 1)).toBe(EMPTY_MULTI_PRESS);
  });

  it('遮罩只吃掉落在它上面的那个 pointer，其他 pointer 不受影响', () => {
    const holding = multiDown(EMPTY_MULTI_PRESS, [leftButton, jumpButton], atJump, 2);
    const blocked = multiDown(holding, [leftButton, jumpButton, mask], atLeft, 1);
    expect(blocked).toBe(holding);
    expect(isPressed(blocked, 'jumpButton')).toBe(true);
  });

  it('按在 none 装饰上 → 穿透到下面的元素', () => {
    const state = multiDown(EMPTY_MULTI_PRESS, [leftButton, ghost], atLeft, 1);
    expect(state.get(1)).toBe('leftButton');
  });

  it('坏坐标 / NaN pointerId / 空表 → 原样返回，不崩', () => {
    expect(multiDown(EMPTY_MULTI_PRESS, ENTRIES, NaNPoint, 1)).toBe(EMPTY_MULTI_PRESS);
    expect(multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, Number.NaN)).toBe(EMPTY_MULTI_PRESS);
    expect(multiDown(EMPTY_MULTI_PRESS, [], atLeft, 1)).toBe(EMPTY_MULTI_PRESS);
  });

  it('pointerId 0 是合法 id（不能用真值判断）', () => {
    const state = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 0);
    expect(state.get(0)).toBe('leftButton');
  });

  it('不改入参：down 之后原状态仍是空的', () => {
    const state = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1);
    expect(EMPTY_MULTI_PRESS.size).toBe(0);
    expect(state.size).toBe(1);
  });
});

describe('移动（multiMove）', () => {
  it('A 的 pointer 移出 A → A 解绑，B 不受影响', () => {
    const both = multiDown(multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1), ENTRIES, atJump, 2);
    const moved = multiMove(both, ENTRIES, blank, 1);
    expect(isPressed(moved, 'leftButton')).toBe(false);
    expect(isPressed(moved, 'jumpButton')).toBe(true);
    expect(moved.get(2)).toBe('jumpButton');
  });

  it('指针在元素内部移动 → 绑定保持（同一引用）', () => {
    const holding = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1);
    expect(multiMove(holding, ENTRIES, { x: 10, y: 710 }, 1)).toBe(holding);
  });

  it('滑到另一个元素上 → 解绑原元素，且不改绑到新元素', () => {
    const holding = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1);
    const moved = multiMove(holding, ENTRIES, atJump, 1);
    expect(moved.size).toBe(0);
    expect(isPressed(moved, 'jumpButton')).toBe(false);
  });

  it('移出后再移回来 → 不恢复（标准按钮手感）', () => {
    const holding = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1);
    const away = multiMove(holding, ENTRIES, blank, 1);
    expect(multiMove(away, ENTRIES, atLeft, 1)).toBe(away);
  });

  it('坏坐标 move → 只解绑出问题的 pointer，其他 pointer 不动', () => {
    const both = multiDown(multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1), ENTRIES, atJump, 2);
    const moved = multiMove(both, ENTRIES, NaNPoint, 1);
    expect(isPressed(moved, 'leftButton')).toBe(false);
    expect(isPressed(moved, 'jumpButton')).toBe(true);
  });

  it('未绑定的 pointer / 未知 id 的 move 是空操作（动不了别人的绑定）', () => {
    const holding = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1);
    expect(multiMove(holding, ENTRIES, blank, 9)).toBe(holding);
    expect(multiMove(holding, ENTRIES, blank, Number.NaN)).toBe(holding);
  });

  it('绑定元素从布局里消失 → 该 pointer 安全解绑，其他不动', () => {
    const both = multiDown(multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1), ENTRIES, atJump, 2);
    const moved = multiMove(both, [jumpButton], atLeft, 1);
    expect(isPressed(moved, 'leftButton')).toBe(false);
    expect(isPressed(moved, 'jumpButton')).toBe(true);
  });
});

describe('松开（multiUp）', () => {
  it('松手点仍在原元素 → 激活该元素，绑定移除', () => {
    const holding = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1);
    expect(multiUp(holding, ENTRIES, atLeft, 1)).toEqual({ state: EMPTY_MULTI_PRESS, activated: 'leftButton' });
  });

  it('松手点在别的元素上 → 不激活（但仍移除绑定）', () => {
    const holding = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1);
    const result = multiUp(holding, ENTRIES, atJump, 1);
    expect(result.activated).toBeNull();
    expect(result.state.size).toBe(0);
  });

  it('松手点在空白处 / 遮罩上 → 不激活', () => {
    const holding = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1);
    expect(multiUp(holding, ENTRIES, blank, 1).activated).toBeNull();
    expect(multiUp(holding, [leftButton, mask], atLeft, 1).activated).toBeNull();
  });

  it('up 一个 pointer → 另一个仍按着', () => {
    const both = multiDown(multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1), ENTRIES, atJump, 2);
    const result = multiUp(both, ENTRIES, atJump, 2);
    expect(result.activated).toBe('jumpButton');
    expect(isPressed(result.state, 'leftButton')).toBe(true);
    expect(isPressed(result.state, 'jumpButton')).toBe(false);
  });

  it('同一元素被两根手指按住 → pressedNames 去重，抬一根仍按着', () => {
    const both = multiDown(multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1), ENTRIES, atLeft, 2);
    expect(pressedNames(both)).toEqual(['leftButton']);
    const one = multiUp(both, ENTRIES, atLeft, 1);
    expect(isPressed(one.state, 'leftButton')).toBe(true);
    expect(pressedNames(one.state)).toEqual(['leftButton']);
    expect(isPressed(multiUp(one.state, ENTRIES, atLeft, 2).state, 'leftButton')).toBe(false);
  });

  it('未知 pointerId / NaN pointerId 的 up → 状态不变、不激活', () => {
    const holding = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1);
    expect(multiUp(holding, ENTRIES, atLeft, 9)).toEqual({ state: holding, activated: null });
    expect(multiUp(holding, ENTRIES, atLeft, Number.NaN)).toEqual({ state: holding, activated: null });
    expect(holding.size).toBe(1);
  });

  it('绑定元素从布局消失后 up → 安全、不激活、解绑', () => {
    const holding = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1);
    expect(multiUp(holding, [], atLeft, 1)).toEqual({ state: EMPTY_MULTI_PRESS, activated: null });
  });

  it('坏坐标 up → 不激活但解绑（不留半截状态）', () => {
    const holding = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1);
    const result = multiUp(holding, ENTRIES, NaNPoint, 1);
    expect(result.activated).toBeNull();
    expect(result.state.size).toBe(0);
  });
});

describe('完整链路（真机 bug 场景）', () => {
  it('按住左移 → 按跳 → 松跳 → 左移仍按着 → 松左移 → 全空', () => {
    let state = multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1);
    state = multiDown(state, ENTRIES, atJump, 2);
    expect(pressedNames(state)).toEqual(['leftButton', 'jumpButton']);
    state = multiUp(state, ENTRIES, atJump, 2).state;
    expect(pressedNames(state)).toEqual(['leftButton']);
    expect(multiUp(state, ENTRIES, atLeft, 1).activated).toBe('leftButton');
  });

  it('松开后状态可重复使用：再按一次仍能激活', () => {
    const first = multiUp(multiDown(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1), ENTRIES, atLeft, 1);
    const second = multiUp(multiDown(first.state, ENTRIES, atLeft, 1), ENTRIES, atLeft, 1);
    expect(first.activated).toBe('leftButton');
    expect(second.activated).toBe('leftButton');
  });

  it('空状态下所有查询/操作都安全', () => {
    expect(pressedNames(EMPTY_MULTI_PRESS)).toEqual([]);
    expect(isPressed(EMPTY_MULTI_PRESS, 'leftButton')).toBe(false);
    expect(multiMove(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1)).toBe(EMPTY_MULTI_PRESS);
    expect(multiUp(EMPTY_MULTI_PRESS, ENTRIES, atLeft, 1)).toEqual({ state: EMPTY_MULTI_PRESS, activated: null });
  });
});
