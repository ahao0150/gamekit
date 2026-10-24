/**
 * 组件总览（T27）的游戏路径测试：从 menu 进 gallery、真实拖动、返回。
 *
 * 与 `game.test.ts` 分开的原因：单文件 ≤300 行（AGENTS 铁律 2）——
 * 按界面分片，各自只保留自己的断言；共用助手在 `test-harness.ts`。
 */

import { expect, it } from 'vitest';
import { GALLERY_ENTRIES, GALLERY_ITEM_H } from './gallery';
import { createGame } from './game';
import { clickComponent, dragBy, mockPlatform } from './test-harness';

const mock = mockPlatform;

/** 进入 gallery 并返回列表矩形（缺了就抛，测试里不猜）。 */
const enterGallery = (game: ReturnType<typeof createGame>, platform: ReturnType<typeof mockPlatform>) => {
  clickComponent(game, platform, 'card0');
  expect(game.state.screen).toBe('gallery');
  const list = game.layout.rects['list'];
  if (list === undefined) throw new Error('gallery 缺 list');
  return list;
};

it('gallery：menu 点「组件总览」进入，列表与滚动条都在布局里', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  enterGallery(game, platform);
  expect(game.layout.errors).toEqual([]);
  expect(game.layout.rects['scrollbar']).toBeDefined();
  // 布局层的 data 就是 19 条总览项（渲染层与布局层同一份快照）
  expect(game.layout.data['items']).toHaveLength(GALLERY_ENTRIES.length);
  game.stop();
});

it('gallery：真实拖动 300px → scrollTop = 300（与背包同一套 scroll 状态机）', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  const list = enterGallery(game, platform);
  dragBy(platform, list.x + list.w / 2, list.y + list.h / 2, -300);
  expect(game.state.scrolls['list'] ?? 0).toBeCloseTo(300, 0);
  // 松手后手势结束：再 move 不会再滚（拖动状态是局部的，不残留）
  const settled = game.state.scrolls['list'] ?? 0;
  platform.emitPointer('move', list.x + list.w / 2, list.y + list.h / 2 - 300);
  expect(game.state.scrolls['list'] ?? 0).toBe(settled);
  // gallery 不选中任何东西（只有背包有 selected）
  expect(game.state.selected).toBeNull();
  game.stop();
});

it('gallery：拖到底部不越界（19×88 内容 - 视口高；用错背包的 20×56 会少滚 552px）', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  const list = enterGallery(game, platform);
  dragBy(platform, list.x + list.w / 2, list.y + list.h / 2, -10000);
  const maxOffset = GALLERY_ENTRIES.length * GALLERY_ITEM_H - list.h;
  expect(maxOffset).toBeGreaterThan(0);
  expect(game.state.scrolls['list'] ?? 0).toBeCloseTo(maxOffset, 0);
  game.stop();
});

it('gallery：点「返回」回 menu，滚动位清空', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  const list = enterGallery(game, platform);
  dragBy(platform, list.x + list.w / 2, list.y + list.h / 2, -200);
  expect(game.state.scrolls['list'] ?? 0).toBeGreaterThan(0);
  clickComponent(game, platform, 'button');
  expect(game.state.screen).toBe('menu');
  expect(game.state.scrolls['list'] ?? 0).toBe(0);
  game.stop();
});

it('T42：gallery 滚到 300 后开 / 关浮层，scrollTop 仍是 300（浮层不再 goTo 清状态）', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  const list = enterGallery(game, platform);
  dragBy(platform, list.x + list.w / 2, list.y + list.h / 2, -300);
  expect(game.state.scrolls['list'] ?? 0).toBeCloseTo(300, 0);

  // gallery 工具行的「弹窗」入口 → 抽屉浮层（底层仍是 gallery）
  clickComponent(game, platform, 'secondaryButton');
  expect(game.state.screen).toBe('gallery');
  expect(game.state.modal).toBe('sheet');
  expect(game.state.scrolls['list'] ?? 0).toBeCloseTo(300, 0);

  // 关浮层（点抽屉里的关闭按钮），底层状态原样
  const overlay = game.overlay;
  if (overlay === null) throw new Error('sheet 浮层没建出来');
  const button = overlay.rects['primaryButton'];
  if (button === undefined) throw new Error('sheet 浮层缺关闭按钮');
  platform.emitPointer('down', button.x + button.w / 2, button.y + button.h / 2);
  platform.emitPointer('up', button.x + button.w / 2, button.y + button.h / 2);

  expect(game.state.modal).toBeNull();
  expect(game.state.screen).toBe('gallery');
  expect(game.state.scrolls['list'] ?? 0).toBeCloseTo(300, 0);
  game.stop();
});
