/**
 * T38 滚轮验收（游戏路径，不是只调纯函数）：
 * `mock.emitWheel` → `platform.onWheel` → `game.ts` 的 `onWheel` → `scrollByWheel`
 * → `state.scrolls` → 布局 props，整条链路与 web 适配器完全同形
 * （web 只是多一层 deltaMode 归一，那是 `platform/wheel-utils.ts` 的事）。
 *
 * 覆盖任务书要求的三条语义：
 * 1. 滚轮落在哪个容器就滚哪个；
 * 2. 嵌套只滚最里层，内层滚到 max 后**不接力**给外层；
 * 3. 落在不可滚区域（按钮 / 空白 / 遮罩界面）什么都不发生，也不报错。
 */

import { expect, it } from 'vitest';
import { galleryContentHeight } from './gallery';
import { createGame } from './game';
import { contentHeight } from './inventory';
import { WHEEL_SPEED } from './scrollables';
import { clickAt, clickComponent, createMockOf, mockPlatform } from './test-harness';

/** 读某个容器的滚动位（缺省 = 0，与状态层口径一致）。 */
const scrollOf = (game: ReturnType<typeof createGame>, name: string): number => game.state.scrolls[name] ?? 0;

/** 发一条滚轮事件（x/y 是画布逻辑坐标）。 */
const wheel = (
  platform: ReturnType<typeof mockPlatform>,
  point: { readonly x: number; readonly y: number },
  deltaY: number,
): void => platform.emitWheel(point.x, point.y, 0, deltaY, 0);

/** 组件矩形中心（缺矩形直接抛，测试里不猜坐标）。 */
const centerOf = (game: ReturnType<typeof createGame>, name: string): { x: number; y: number } => {
  const rect = game.layout.rects[name];
  if (rect === undefined) throw new Error(`界面 ${game.state.screen} 里没有组件 ${name}`);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
};

it('WHEEL_SPEED：0.8（一格滚轮 100px → 走 80px，背包约 1.4 行）', () => {
  expect(WHEEL_SPEED).toBe(0.8);
  expect(WHEEL_SPEED).toBeGreaterThan(0);
});

it('gallery：滚 deltaY=300 → scrollTop=240（×0.8），布局 props 同步；到顶/到底都钳住', () => {
  const platform = mockPlatform();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'card0');
  expect(game.state.screen).toBe('gallery');
  expect(scrollOf(game, 'list')).toBe(0);

  const list = game.layout.rects['list'];
  if (list === undefined) throw new Error('gallery 缺 list');
  const point = { x: list.x + list.w / 2, y: list.y + list.h / 2 };

  wheel(platform, point, 300);
  expect(scrollOf(game, 'list')).toBe(240);
  // 布局 props 是渲染用的同一个值：滚轮不是「只改了状态没进渲染」
  expect(game.layout.props['list']?.['scrollTop']).toBe(240);

  // 向上滚超量 → 钳到 0，不会出现负 offset
  wheel(platform, point, -1000);
  expect(scrollOf(game, 'list')).toBe(0);

  // 向下滚超量 → 钳到「内容高 - 视口高」
  wheel(platform, point, 10000);
  const maxOffset = galleryContentHeight() - list.h;
  expect(maxOffset).toBeGreaterThan(0);
  expect(scrollOf(game, 'list')).toBeCloseTo(maxOffset, 6);
  game.stop();
});

it('inventory：滚轮走同一条链路（deltaY=140 → 112），与拖动共用 scrollClamp 口径', () => {
  const platform = mockPlatform();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'primaryButton');
  const list = game.layout.rects['list'];
  if (list === undefined) throw new Error('inventory 缺 list');
  wheel(platform, { x: list.x + list.w / 2, y: list.y + list.h / 2 }, 140);
  expect(scrollOf(game, 'list')).toBe(112);
  // 列表内容高 20×56=1120，滚到 max 后停在 内容高 - 视口高
  wheel(platform, { x: list.x + list.w / 2, y: list.y + list.h / 2 }, 10000);
  expect(scrollOf(game, 'list')).toBeCloseTo(contentHeight() - list.h, 6);
  game.stop();
});

it('嵌套：内层 list 的矩形真的被外层 scroll 容器包住（几何嵌套成立）', () => {
  const platform = mockPlatform();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'coinBadge');
  expect(game.state.screen).toBe('nest');
  const outer = game.layout.rects['scroll'];
  const inner = game.layout.rects['list'];
  if (outer === undefined || inner === undefined) throw new Error('nest 缺 scroll / list');
  expect(inner.x).toBeGreaterThanOrEqual(outer.x);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y);
  expect(inner.x + inner.w).toBeLessThanOrEqual(outer.x + outer.w);
  expect(inner.y + inner.h).toBeLessThanOrEqual(outer.y + outer.h);
  // 内层之后声明（overlay）→ 绘制序在后 = 命中优先
  expect(game.layout.paintOrder.indexOf('list')).toBeGreaterThan(game.layout.paintOrder.indexOf('scroll'));
  game.stop();
});

it('嵌套：滚轮落在内层上 → 只有内层 offset 变，外层一点不动', () => {
  const platform = mockPlatform();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'coinBadge');
  const inner = game.layout.rects['list'];
  if (inner === undefined) throw new Error('nest 缺 list');
  wheel(platform, { x: inner.x + inner.w / 2, y: inner.y + inner.h / 2 }, 100);
  expect(scrollOf(game, 'list')).toBe(80);
  expect(scrollOf(game, 'scroll')).toBe(0);
  game.stop();
});

it('嵌套：滚轮落在外层（不被内层覆盖的左上角）→ 只有外层 offset 变', () => {
  const platform = mockPlatform();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'coinBadge');
  const outer = game.layout.rects['scroll'];
  if (outer === undefined) throw new Error('nest 缺 scroll');
  wheel(platform, { x: outer.x + 4, y: outer.y + 4 }, 100);
  expect(scrollOf(game, 'scroll')).toBe(80);
  expect(scrollOf(game, 'list')).toBe(0);
  game.stop();
});

it('嵌套：内层滚到 max 后继续滚 → 内层停在 max、外层 offset 完全不变（不接力）', () => {
  const platform = mockPlatform();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'coinBadge');
  const inner = game.layout.rects['list'];
  if (inner === undefined) throw new Error('nest 缺 list');
  const point = { x: inner.x + inner.w / 2, y: inner.y + inner.h / 2 };

  wheel(platform, point, 10000);
  const innerMax = scrollOf(game, 'list');
  const outerBefore = scrollOf(game, 'scroll');
  // 内层 20×48=960、视口 253.2 → max = 706.8
  expect(innerMax).toBeCloseTo(960 - inner.h, 6);
  expect(innerMax).toBeGreaterThan(0);
  expect(outerBefore).toBe(0);

  wheel(platform, point, 10000);
  expect(scrollOf(game, 'list')).toBe(innerMax); // 还是 max
  expect(scrollOf(game, 'scroll')).toBe(outerBefore); // 外层一点都不动
  game.stop();
});

it('空白处 / 按钮上滚：所有容器 offset 不变，errors 为空', () => {
  // 1) menu：整屏没有可滚容器
  const menuPlatform = mockPlatform();
  const menuGame = createGame(menuPlatform);
  menuGame.start();
  wheel(menuPlatform, { x: 195, y: 422 }, 300);
  expect(menuGame.state.scrolls).toEqual({});
  expect(menuGame.layout.errors).toEqual([]);
  menuGame.stop();

  // 2) bag：按钮在网格外面，滚轮落在按钮上不滚网格
  const bagPlatform = mockPlatform();
  const bagGame = createGame(bagPlatform);
  bagGame.start();
  clickComponent(bagGame, bagPlatform, 'parcelGrid');
  wheel(bagPlatform, centerOf(bagGame, 'button'), 300);
  expect(bagGame.state.scrolls).toEqual({});
  expect(bagGame.layout.errors).toEqual([]);
  bagGame.stop();
});

it('tip / popup / sheet / half 浮层：没有可滚容器，滚轮完全不影响（底层也不被滚）', () => {
  // 入口 → 期望的浮层名（T42：打开浮层不换底层界面，screen 一直是 menu）
  const entries: readonly (readonly [string, string])[] = [
    ['toast', 'tip'],
    ['secondaryButton', 'popup'],
    ['card1', 'sheet'],
    ['infoPanel', 'half'],
  ];
  for (const [entry, modal] of entries) {
    const platform = mockPlatform();
    const game = createGame(platform);
    game.start();
    clickComponent(game, platform, entry);
    expect(game.state.modal).toBe(modal);
    wheel(platform, { x: 195, y: 422 }, 400);
    expect(game.state.scrolls, `${modal} 不该被滚`).toEqual({});
    expect(game.state.screen, `${modal} 打开时底层仍是 menu`).toBe('menu');
    expect(game.overlay?.errors ?? [], `${modal} 浮层布局有错`).toEqual([]);
    expect(game.layout.errors, `${modal} 底层布局有错`).toEqual([]);
    game.stop();
  }
});

it('bag@320×568：滚到 max=77.76，最后一行完整落在网格可视区里（且点得到）', () => {
  const platform = createMockOf({ width: 320, height: 568 });
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'parcelGrid');
  const grid = game.layout.rects['grid'];
  if (grid === undefined) throw new Error('bag 缺 grid');
  // 内容 5 行 × 88 + 4 × 6 = 464；视口 386.24 → 必须能滚
  const content = 5 * 88 + 4 * 6;
  const maxOffset = content - grid.h;
  expect(maxOffset).toBeCloseTo(77.76, 1);
  expect(scrollOf(game, 'grid')).toBe(0);

  wheel(platform, { x: grid.x + 10, y: grid.y + 10 }, 10000);
  expect(scrollOf(game, 'grid')).toBeCloseTo(maxOffset, 6);

  // 第 5 行顶边（内容坐标 4×(88+6)=376）→ 滚到底后在屏幕上的 y
  const lastRowY = grid.y + 4 * (88 + 6) - maxOffset;
  expect(lastRowY).toBeCloseTo(389.12, 1);
  expect(lastRowY + 88).toBeCloseTo(grid.y + grid.h, 1); // 最后一行底边 = 网格底边

  // 点最后一行第一格中心 → selected = 16（命中同取 props.scrollTop，不看鼠标位置的历史）
  const cellW = (grid.w - 6 * 3) / 4;
  clickAt(platform, grid.x + cellW / 2, lastRowY + 44);
  expect(game.state.selected).toBe(16);
  game.stop();
});

it('stop 后滚轮解绑：再发事件不再改状态（不会在页面销毁后还滚）', () => {
  const platform = mockPlatform();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'card0');
  const list = game.layout.rects['list'];
  if (list === undefined) throw new Error('gallery 缺 list');
  wheel(platform, { x: list.x + 10, y: list.y + 10 }, 100);
  const before = scrollOf(game, 'list');
  expect(before).toBe(80);
  game.stop();
  wheel(platform, { x: list.x + 10, y: list.y + 10 }, 100);
  expect(scrollOf(game, 'list')).toBe(before);
});

it('平台没有 onWheel（可选成员缺省，如手机小游戏）时不崩，其余输入照常', () => {
  const mock = mockPlatform();
  // 模拟「没有滚轮能力」的平台：可选成员直接不实现
  const noWheel = { ...mock, onWheel: undefined };
  const game = createGame(noWheel);
  game.start();
  clickComponent(game, mock, 'primaryButton');
  expect(game.state.screen).toBe('inventory');
  game.stop();
});
