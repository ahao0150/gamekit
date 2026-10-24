/**
 * 输入状态机单测（T49）：键盘 + 多点触控合并。
 *
 * 核心回归：「按住左移再按跳，左移被打断」—— 旧实现把第二根手指的 down 当成
 * 「重算整个三键快照」，顺手把左键发了一次 false。现在每个 pointerId 独立绑定，
 * 这里逐条锁住「第二根手指按下只会让新键变 true，不会让旧键变 false」。
 */

import { expect, it } from 'vitest';
import {
  createInput, effectiveKeys, IDLE_INPUT, TOUCH_ENTRIES, withKey, withPointer,
} from './input';
import { TOUCH } from './render';

/** 三个按钮中心（与 render 同源）。 */
const at = (rect: { x: number; y: number; w: number; h: number }): { x: number; y: number } => ({
  x: rect.x + rect.w / 2,
  y: rect.y + rect.h / 2,
});
const LEFT = at(TOUCH.left);
const RIGHT = at(TOUCH.right);
const JUMP = at(TOUCH.jump);
const BLANK = { x: 195, y: 400 }; // 屏幕中间，不落在任何按钮上
const NaN_POINT = { x: Number.NaN, y: Number.NaN };

/** 记录 createInput 回调（断言「只发变化了的键」）。 */
const recorder = (): { events: [string, boolean][]; onChange: (key: string, down: boolean) => void } => {
  const events: [string, boolean][] = [];
  return { events, onChange: (key, down) => events.push([key, down]) };
};

it('触屏表与 render 同源：三个按钮、名字与矩形一一对应', () => {
  expect(TOUCH_ENTRIES.map((e) => e.name)).toEqual(['left', 'right', 'jump']);
  expect(TOUCH_ENTRIES[0]?.rect).toEqual(TOUCH.left);
  expect(TOUCH_ENTRIES.every((e) => e.hit === 'self')).toBe(true);
});

it('两根手指同时按左 + 跳 → 两个都生效（多点触控落地）', () => {
  let state = withPointer(IDLE_INPUT, 'down', LEFT, 1);
  state = withPointer(state, 'down', JUMP, 2);
  expect(effectiveKeys(state)).toEqual({ left: true, right: false, jump: true });
});

it('按住左再按跳：左继续被按着（本次核心 bug 的回归）', () => {
  const holdingLeft = withPointer(IDLE_INPUT, 'down', LEFT, 1);
  expect(effectiveKeys(holdingLeft).left).toBe(true);
  const both = withPointer(holdingLeft, 'down', JUMP, 2);
  // 两个都还在，左没有被「重算快照」顺手松开
  expect(effectiveKeys(both)).toEqual({ left: true, right: false, jump: true });
});

it('松开跳键：跳关闭、左仍按着', () => {
  let state = withPointer(IDLE_INPUT, 'down', LEFT, 1);
  state = withPointer(state, 'down', JUMP, 2);
  state = withPointer(state, 'up', JUMP, 2);
  expect(effectiveKeys(state)).toEqual({ left: true, right: false, jump: false });
});

it('松开左键、跳仍按着：左关闭、跳不受影响（不误判）', () => {
  let state = withPointer(IDLE_INPUT, 'down', LEFT, 1);
  state = withPointer(state, 'down', JUMP, 2);
  state = withPointer(state, 'up', LEFT, 1);
  expect(effectiveKeys(state)).toEqual({ left: false, right: false, jump: true });
});

it('同一根手指滑出按钮 → 只解绑它自己的按键', () => {
  let state = withPointer(IDLE_INPUT, 'down', LEFT, 1);
  state = withPointer(state, 'down', JUMP, 2);
  state = withPointer(state, 'move', BLANK, 1);
  expect(effectiveKeys(state)).toEqual({ left: false, right: false, jump: true });
});

it('pointercancel → 只解绑这一根手指（不给激活、不影响其他）', () => {
  let state = withPointer(IDLE_INPUT, 'down', LEFT, 1);
  state = withPointer(state, 'down', JUMP, 2);
  state = withPointer(state, 'cancel', LEFT, 1);
  expect(effectiveKeys(state)).toEqual({ left: false, right: false, jump: true });
});

it('按在空白处 / NaN 坐标 / 未知 pointerId 的 up → 不产生也不影响绑定', () => {
  expect(effectiveKeys(withPointer(IDLE_INPUT, 'down', BLANK, 1))).toEqual({
    left: false, right: false, jump: false,
  });
  expect(effectiveKeys(withPointer(IDLE_INPUT, 'down', NaN_POINT, 1))).toEqual({
    left: false, right: false, jump: false,
  });
  const holding = withPointer(IDLE_INPUT, 'down', LEFT, 1);
  expect(withPointer(holding, 'up', LEFT, 99)).toBe(holding);
});

it('同一只手指重复按同一个按钮 → 幂等（不产生重复绑定）', () => {
  const first = withPointer(IDLE_INPUT, 'down', LEFT, 1);
  expect(withPointer(first, 'down', LEFT, 1)).toBe(first);
});

it('键盘与触屏取并集：键盘右 + 触屏左同时生效；键盘松开不影响触屏', () => {
  let state = withPointer(IDLE_INPUT, 'down', LEFT, 1);
  state = withKey(state, 'right', true);
  expect(effectiveKeys(state)).toEqual({ left: true, right: true, jump: false });
  state = withKey(state, 'right', false);
  expect(effectiveKeys(state)).toEqual({ left: true, right: false, jump: false });
});

it('createInput：第二根手指按下跳 → 回调只会发 jump=true，不会发 left=false（核心断言）', () => {
  const { events, onChange } = recorder();
  const input = createInput(onChange);
  input.handlePointer('down', LEFT, 1);
  expect(events).toEqual([['left', true]]);
  input.handlePointer('down', JUMP, 2);
  // 旧实现这里会是 [['left', false], ['jump', true]] —— 左移被打断的根因
  expect(events).toEqual([['left', true], ['jump', true]]);
  expect(input.effective).toEqual({ left: true, right: false, jump: true });
  input.handlePointer('up', JUMP, 2);
  expect(events[events.length - 1]).toEqual(['jump', false]);
  expect(input.effective).toEqual({ left: true, right: false, jump: false });
  input.handlePointer('up', LEFT, 1);
  expect(events).toEqual([['left', true], ['jump', true], ['jump', false], ['left', false]]);
});

it('createInput：同一状态重复事件不重复回调（键盘长按不会重复触发）', () => {
  const { events, onChange } = recorder();
  const input = createInput(onChange);
  input.handleKey('jump', true);
  input.handleKey('jump', true);
  input.handleKey('left', true);
  expect(events).toEqual([['jump', true], ['left', true]]);
});
