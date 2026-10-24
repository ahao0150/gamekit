/**
 * 背包界面（T13d，T38 拆分）：通用 list + scrollbar + 真实拖动/点击。
 *
 * 从 game.test.ts 拆出来的原因：单文件 ≤300 行（AGENTS 铁律 2）。
 * 共用助手在 test-harness.ts。
 */

import { expect, it } from 'vitest';
import { createGame } from './game';
import { ITEM_H, ITEMS } from './inventory';
import { clickAt, clickComponent, dragBy, mockPlatform } from './test-harness';

const mock = mockPlatform;

// ---------------------------------------------------------------------------
// T13d：背包（通用 list + scrollbar + press/scroll 两个状态机）
// ---------------------------------------------------------------------------

it('inventory：menu 点「打开背包」进入，列表与滚动条都在布局里', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'primaryButton');
  expect(game.state.screen).toBe('inventory');
  expect(game.layout.errors).toEqual([]);
  expect(game.layout.rects['list']).toBeDefined();
  expect(game.layout.rects['scrollbar']).toBeDefined();
  // 进来是干净的
  expect(game.state.scrolls['list'] ?? 0).toBe(0);
  expect(game.state.selected).toBeNull();
  game.stop();
});

it('inventory：真实拖动 200px → scrollTop 变成 200（scroll.ts 状态机）', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'primaryButton');
  const list = game.layout.rects['list'];
  if (list === undefined) throw new Error('inventory 缺 list');
  const x = list.x + list.w / 2;
  const y = list.y + list.h / 2;
  // 手指上滑 200px（dy 为负）→ 内容上移 200px
  dragBy(platform, x, y, -200);
  expect(game.state.scrolls['list'] ?? 0).toBeCloseTo(200, 0);
  // 松手后手势结束：再 move 不会再滚（拖动状态是局部的，不残留）
  const settled = game.state.scrolls['list'] ?? 0;
  platform.emitPointer('move', x, y - 300);
  expect(game.state.scrolls['list'] ?? 0).toBe(settled);
  // 界面上「选中的东西」没有被拖动误触发
  expect(game.state.selected).toBeNull();
  game.stop();
});

it('inventory：拖动后点击第 3 项 → selected = 2（下标走几何换算）', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'primaryButton');
  const list = game.layout.rects['list'];
  if (list === undefined) throw new Error('inventory 缺 list');
  // 第 3 项（下标 2）中心：列表顶 + 2.5 个项高
  clickAt(platform, list.x + list.w / 2, list.y + ITEM_H * 2 + ITEM_H / 2);
  expect(game.state.selected).toBe(2);
  expect(ITEMS[2]?.name).toBe('物品 03');
  game.stop();
});

it('inventory：滚动后再点同一位置，选中的是滚动后的那一项（拖 200 → 点顶 → 下标 3）', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'primaryButton');
  const list = game.layout.rects['list'];
  if (list === undefined) throw new Error('inventory 缺 list');
  dragBy(platform, list.x + list.w / 2, list.y + list.h / 2, -200);
  // 滚了 200px：列表顶 + 10px → local = 210 → floor(210/56) = 3（物品 04）
  clickAt(platform, list.x + list.w / 2, list.y + 10);
  expect(game.state.selected).toBe(3);
  game.stop();
});

it('inventory：拖动过程中的 up 不当作点击（不会误选列表项）', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'primaryButton');
  const list = game.layout.rects['list'];
  if (list === undefined) throw new Error('inventory 缺 list');
  dragBy(platform, list.x + list.w / 2, list.y + list.h / 2, -120);
  expect(game.state.selected).toBeNull();
  game.stop();
});

it('inventory：滚动不越界（拖 10000px 也只到最大滚动位）', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'primaryButton');
  const list = game.layout.rects['list'];
  if (list === undefined) throw new Error('inventory 缺 list');
  dragBy(platform, list.x + list.w / 2, list.y + list.h / 2, -10000);
  const maxOffset = ITEMS.length * ITEM_H - list.h;
  expect(maxOffset).toBeGreaterThan(0);
  expect(game.state.scrolls['list'] ?? 0).toBeCloseTo(maxOffset, 0);
  game.stop();
});

it('inventory：返回按钮回 menu，且交互状态被清空', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'primaryButton');
  const list = game.layout.rects['list'];
  if (list === undefined) throw new Error('inventory 缺 list');
  dragBy(platform, list.x + list.w / 2, list.y + list.h / 2, -200);
  // 滚 200px 后点列表顶 + 半项：local = 200 + 28 = 228 → floor(228/56) = 4
  clickAt(platform, list.x + list.w / 2, list.y + ITEM_H / 2);
  expect(game.state.selected).toBe(4);

  clickComponent(game, platform, 'button');
  expect(game.state.screen).toBe('menu');
  expect(game.state.scrolls['list'] ?? 0).toBe(0);
  expect(game.state.selected).toBeNull();
  game.stop();
});

