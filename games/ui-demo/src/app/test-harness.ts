/**
 * ui-demo 测试共用的小工具（不是测试文件本身，不带断言）。
 *
 * 抽出来的原因：`game.test.ts` 已经 300 行上限告急，再往里加 gallery / inventory
 * 用例就超了。助手放一份，测试文件按「界面分片」拆开，各自只保留断言。
 *
 * 所有助手都走 `emitPointer` 的**真实 pointer 事件**，不直接调 `reduce` ——
 * 这样才验证「点得到 / 拖得动」，而不是「函数签名对」。
 */

import { createMockAdapter } from '../../../../packages/runtime/src/platform/mock/index';
import type { MockAdapter } from '../../../../packages/runtime/src/platform/mock/index';
import type { Game } from './game';

/** 造任意视口的 mock 平台。 */
export const createMockOf = (screen: { width: number; height: number }): MockAdapter =>
  createMockAdapter({ screen });

/** 造一个 390×844 的 mock 平台（与真实手机视口一致）。 */
export const mockPlatform = (): MockAdapter => createMockOf({ width: 390, height: 844 });

/** 点当前界面里某个组件的中心（坐标来自 `game.layout` 的真实矩形）。 */
export const clickComponent = (game: Game, platform: MockAdapter, name: string): void => {
  const rect = game.layout.rects[name];
  if (rect === undefined) throw new Error(`界面 ${game.state.screen} 里没有组件 ${name}`);
  const x = rect.x + rect.w / 2;
  const y = rect.y + rect.h / 2;
  platform.emitPointer('down', x, y);
  platform.emitPointer('up', x, y);
};

/** 点**浮层**里某个组件的中心（T42：浮层矩形在 `game.overlay`，与底层分开）。 */
export const clickOverlay = (game: Game, platform: MockAdapter, name: string): void => {
  const overlay = game.overlay;
  if (overlay === null) throw new Error(`当前没有浮层，点不到 ${name}`);
  const rect = overlay.rects[name];
  if (rect === undefined) throw new Error(`浮层 ${overlay.screen} 里没有组件 ${name}`);
  const x = rect.x + rect.w / 2;
  const y = rect.y + rect.h / 2;
  platform.emitPointer('down', x, y);
  platform.emitPointer('up', x, y);
};

/** 点任意坐标（走真实 pointer 事件）。 */
export const clickAt = (platform: MockAdapter, x: number, y: number): void => {
  platform.emitPointer('down', x, y);
  platform.emitPointer('up', x, y);
};

/** 真实拖动：down → `steps` 次 move（每步 dy/steps）→ up。 */
export const dragBy = (
  platform: MockAdapter,
  x: number,
  y: number,
  dy: number,
  steps = 10,
): { from: number; to: number } => {
  platform.emitPointer('down', x, y);
  for (let i = 1; i <= steps; i += 1) platform.emitPointer('move', x, y + (dy * i) / steps);
  platform.emitPointer('up', x, y + dy);
  return { from: y, to: y + dy };
};
