/**
 * T35 整合验收（纯函数层）：网格背包的点击命中、任意位置提示的 at 几何、
 * 倒计时回菜单、半透明遮罩。
 *
 * 浏览器里的真实点击（CDP + page.mouse）另有脚本验证；这里保证的是
 * 「几何算得对 + 状态迁移对」，不依赖 canvas。
 */
import { expect, it } from 'vitest';
import { cellWidth } from './deps';
import { createGame } from './game';
import { createLayoutEngine } from './layout';
import { INITIAL_STATE, reduce, TIP_FRAMES } from './state';
import { clickAt, clickComponent, mockPlatform } from './test-harness';

const VIEWPORT = { width: 390, height: 844 };
const engine = createLayoutEngine();

it('bag：menu 点网格入口进背包，grid 撑满主体', () => {
  const platform = mockPlatform();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'parcelGrid');
  expect(game.state.screen).toBe('bag');

  const view = engine.compute('bag', VIEWPORT, game.state);
  expect(view.errors).toEqual([]);
  const grid = view.rects['grid'];
  expect(grid, 'bag 缺 grid 矩形').toBeDefined();
  if (grid === undefined) return;
  expect(grid.w).toBeGreaterThan(300);
  expect(grid.h).toBeGreaterThan(500);
  expect(view.props['grid']).toMatchObject({ cols: 4, cellH: 88, gapX: 6, gapY: 6, virtual: true });
});

it('bag：点第 5 格中心 → selected = 4（命中走 core 的 gridIndexAt）', () => {
  const platform = mockPlatform();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'parcelGrid');
  expect(game.state.screen).toBe('bag');

  const view = engine.compute('bag', VIEWPORT, game.state);
  const rect = view.rects['grid']!;
  // 第 5 格 = index 4 → row 1、col 0；cellW 必须用绘制同源的 cellWidth
  const cellW = cellWidth(rect.w, 4, 6);
  const x = rect.x + cellW / 2;
  const y = rect.y + (88 + 6) + 88 / 2;
  clickAt(platform, x, y);
  expect(game.state.selected).toBe(4);
});

it('bag：点「返回」回菜单', () => {
  const platform = mockPlatform();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'parcelGrid');
  clickComponent(game, platform, 'button');
  expect(game.state.screen).toBe('menu');
});

it('tip：点提示入口 —— 底层仍是 menu，提示浮层中心在 (30%, 70%)、尺寸 60%×18%', () => {
  const platform = mockPlatform();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'toast');
  // T42：tip 是浮层，不换界面；底层 menu 原样在
  expect(game.state.screen).toBe('menu');
  expect(game.state.modal).toBe('tip');

  const view = engine.compute('tip', VIEWPORT, game.state);
  expect(view.errors).toEqual([]);
  const tip = view.rects['panel'];
  expect(tip, 'tip 缺提示框矩形').toBeDefined();
  if (tip === undefined) return;
  expect(tip.x + tip.w / 2).toBeCloseTo(VIEWPORT.width * 0.3, 1);
  expect(tip.y + tip.h / 2).toBeCloseTo(VIEWPORT.height * 0.7, 1);
  expect(tip.w).toBeCloseTo(VIEWPORT.width * 0.6, 1);
  expect(tip.h).toBeCloseTo(VIEWPORT.height * 0.18, 1);
  // 文字压在同一个中心点上
  expect(view.props['label']).toMatchObject({ text: '+1 金币', align: 'center' });
  // 浮层里没有全屏背景（T42 删掉了旧的全屏 infoPanel），只有一个金色框 + 文字
  expect(Object.keys(view.rects).sort()).toEqual(['label', 'panel']);
});

it('tip：60 帧后浮层消失（只清 modal，menu 一直在）', () => {
  let state = reduce(INITIAL_STATE, { kind: 'openTip' });
  expect(state.screen).toBe('menu');
  expect(state.modal).toBe('tip');
  expect(state.tipFrames).toBe(TIP_FRAMES);
  for (let i = 0; i < TIP_FRAMES - 1; i += 1) state = reduce(state, { kind: 'tick' });
  expect(state.modal, '第 59 帧还不该消失').toBe('tip');
  state = reduce(state, { kind: 'tick' });
  expect(state.screen).toBe('menu');
  expect(state.modal).toBeNull();
  expect(state.tipFrames).toBe(0);
});

it('tip：其它界面 tick 是空操作（每一帧都会调）', () => {
  const menu = { ...INITIAL_STATE, screen: 'menu' as const };
  expect(reduce(menu, { kind: 'tick' })).toBe(menu);
  // 非 tip 浮层也不倒计时
  const sheet = { ...INITIAL_STATE, modal: 'sheet' as const };
  expect(reduce(sheet, { kind: 'tick' })).toBe(sheet);
});

it('popup：遮罩是半透明黑，盖满整屏（底层画面能透出来）', () => {
  const view = engine.compute('popup', VIEWPORT, { ...INITIAL_STATE, modal: 'popup' });
  expect(view.errors).toEqual([]);
  expect(view.props['panel']).toMatchObject({ fillColor: 'rgba(0,0,0,0.55)' });
  expect(view.rects['panel']).toEqual({ x: 0, y: 0, w: 390, h: 844 });
});

it('gallery：21 项里新增的 grid / scroll 都带数据或形态参数', () => {
  const view = engine.compute('gallery', VIEWPORT, { ...INITIAL_STATE, screen: 'gallery' });
  const items = view.data['items'] as readonly { name?: string }[];
  const names = items.map((entry) => entry.name);
  expect(names).toContain('grid');
  expect(names).toContain('scroll');
});
