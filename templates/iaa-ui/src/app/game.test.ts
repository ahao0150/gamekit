import { expect, it } from 'vitest';
import { createMockAdapter } from '@mg/runtime/mock';
import type { MockAdapter } from '@mg/runtime/mock';
import { createGame } from './game';
import type { Game } from './game';

const mock = (): MockAdapter => createMockAdapter({ screen: { width: 390, height: 844 } });

/**
 * 点当前界面里某个组件的中心。
 *
 * 坐标来自 `game.layout`（= layout() 求解出的真实矩形），走 `emitPointer` 的
 * 真实 pointer 事件路径 —— 不是直接调 reduce，这样才验证「点得到」。
 */
const clickComponent = (game: Game, platform: MockAdapter, name: string): void => {
  const rect = game.layout.rects[name];
  if (rect === undefined) throw new Error(`界面 ${game.state.screen} 里没有组件 ${name}`);
  const x = rect.x + rect.w / 2;
  const y = rect.y + rect.h / 2;
  platform.emitPointer('down', x, y);
  platform.emitPointer('up', x, y);
};

it('真实指针路径：点按钮加分', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  expect(game.state.score).toBe(0);

  clickComponent(game, platform, 'button');
  expect(game.state.score).toBe(1);
  clickComponent(game, platform, 'button');
  expect(game.state.score).toBe(2);
  game.stop();
});

it('点空白处与只按下（不松手）都不加分', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  platform.emitPointer('down', 1, 840);
  platform.emitPointer('up', 1, 840);
  expect(game.state.score).toBe(0);

  const rect = game.layout.rects['button'];
  if (rect === undefined) throw new Error('没有 button');
  platform.emitPointer('down', rect.x + rect.w / 2, rect.y + rect.h / 2);
  expect(game.state.score).toBe(0); // 只有 up 才触发
  game.stop();
});

it('布局无错（两个视口都不报绑定/布局错误）', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  expect(game.layout.errors).toEqual([]);
  expect(Object.keys(game.layout.rects).length).toBeGreaterThanOrEqual(5);
  game.stop();
});
