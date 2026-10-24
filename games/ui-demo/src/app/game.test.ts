import { expect, it } from 'vitest';
import { createGame } from './game';
import { clickAt, clickComponent, clickOverlay, mockPlatform } from './test-harness';

const mock = mockPlatform;

it('真实指针路径：menu → play → 点目标 3 次 → result → 再来一次 → menu', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  expect(game.state).toMatchObject({ screen: 'menu', hits: 0 });

  clickComponent(game, platform, 'button');
  expect(game.state).toMatchObject({ screen: 'play', hits: 0 });

  clickComponent(game, platform, 'tapTarget');
  expect(game.state).toMatchObject({ screen: 'play', hits: 1 });
  clickComponent(game, platform, 'tapTarget');
  clickComponent(game, platform, 'tapTarget');
  expect(game.state).toMatchObject({ screen: 'result', hits: 3 });

  clickComponent(game, platform, 'primaryButton');
  expect(game.state).toMatchObject({ screen: 'menu', hits: 0 });
  game.stop();
});

it('点空白处不改状态（坐标在视口内但不在任何组件上）', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  platform.emitPointer('down', 1, 840);
  platform.emitPointer('up', 1, 840);
  expect(game.state).toMatchObject({ screen: 'menu', hits: 0 });
  game.stop();
});

it('play 里点「放弃」回主菜单，命中数清零', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'button');
  clickComponent(game, platform, 'tapTarget');
  expect(game.state.hits).toBe(1);
  clickComponent(game, platform, 'secondaryButton');
  expect(game.state).toMatchObject({ screen: 'menu', hits: 0 });
  game.stop();
});

it('只有 up 触发动作：按下只进 pressed，松手才迁移界面', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  const rect = game.layout.rects['button'];
  if (rect === undefined) throw new Error('menu 缺 button');
  const x = rect.x + rect.w / 2;
  const y = rect.y + rect.h / 2;
  platform.emitPointer('down', x, y);
  expect(game.state.screen).toBe('menu'); // 还没触发
  expect(game.state.press.pressed).toBe('button'); // 但已经按下（三态）
  platform.emitPointer('up', x, y);
  expect(game.state.screen).toBe('play');
  expect(game.state.press.pressed).toBeNull(); // 松手清空
  game.stop();
});

it('按下后滑出按钮：pressed 取消，松手不触发（标准按钮手感）', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  const rect = game.layout.rects['button'];
  if (rect === undefined) throw new Error('menu 缺 button');
  const x = rect.x + rect.w / 2;
  const y = rect.y + rect.h / 2;
  platform.emitPointer('down', x, y);
  expect(game.state.press.pressed).toBe('button');
  platform.emitPointer('move', x, y + 200); // 滑出按钮
  expect(game.state.press.pressed).toBeNull();
  platform.emitPointer('up', x, y + 200);
  expect(game.state.screen).toBe('menu'); // 滑出后松手不触发
  game.stop();
});

it('切界面后 layout 立刻是新界面的组件矩形（不是上一屏的）', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  expect(Object.keys(game.layout.rects)).toContain('button');
  clickComponent(game, platform, 'button');
  expect(Object.keys(game.layout.rects)).toContain('tapTarget');
  expect(game.layout.errors).toEqual([]);
  game.stop();
});

// ---------------------------------------------------------------------------
// T13c：层级 + 命中的真实点击验收（popup 界面）
// ---------------------------------------------------------------------------

it('popup：menu 上打开浮层 —— screen 仍是 menu，浮层单独一层', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'secondaryButton');
  // T42：不再换界面。底层 menu 原样在，浮层记在 modal 里
  expect(game.state.screen).toBe('menu');
  expect(game.state.modal).toBe('popup');
  expect(game.overlay?.screen).toBe('popup');
  // 底层布局仍然完整（menu 的 13 个组件都在）
  expect(Object.keys(game.layout.rects).length).toBeGreaterThanOrEqual(10);

  // meta 来自 layout()：遮罩 hit block、按钮 hit self
  expect(game.overlay?.meta['panel']).toMatchObject({ hit: 'block', layer: 'overlay' });
  expect(game.overlay?.meta['primaryButton']).toMatchObject({ hit: 'self', layer: 'overlay' });
  game.stop();
});

it('popup：点遮罩空白处被吃掉，浮层仍在、底层没动作', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'secondaryButton');
  // 左上角在遮罩（panel）上、面板之外
  clickAt(platform, 5, 5);
  expect(game.state.modal).toBe('popup');
  expect(game.state.screen).toBe('menu');
  game.stop();
});

it('popup：点底层按钮自己的位置也不触发（遮罩挡住，不穿透）', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'secondaryButton');
  // 这个坐标落在底层 menu 的 primaryButton 上（它绑的是「打开背包」）：
  // 浮层开着时命中的是遮罩，所以 screen 仍是 menu（穿透的话会变成 inventory）
  const baseRect = game.layout.rects['primaryButton'];
  if (baseRect === undefined) throw new Error('menu 缺 primaryButton');
  clickAt(platform, baseRect.x + baseRect.w / 2, baseRect.y + baseRect.h / 2);
  expect(game.state.modal).toBe('popup');
  expect(game.state.screen).toBe('menu');
  game.stop();
});

it('popup：点面板里的确认按钮触发 closePopup，只清浮层', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'secondaryButton');
  clickOverlay(game, platform, 'primaryButton');
  expect(game.state.modal).toBeNull();
  expect(game.state.screen).toBe('menu');
  expect(game.overlay).toBeNull();
  game.stop();
});

// ---------------------------------------------------------------------------
// T32 + T42：两个「半屏浮层」（底部抽屉 45% / 中间半屏 58%）叠加在真 menu 上
// ---------------------------------------------------------------------------

it('sheet：menu 上打开抽屉 —— 底层 menu 仍在，抽屉压在下半屏、遮罩是 hit block', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'card1');
  expect(game.state.screen).toBe('menu');
  expect(game.state.modal).toBe('sheet');

  const overlay = game.overlay;
  if (overlay === null) throw new Error('sheet 浮层没建出来');
  expect(overlay.meta['panel']).toMatchObject({ hit: 'block', layer: 'overlay' });
  expect(overlay.meta['primaryButton']).toMatchObject({ hit: 'self', layer: 'overlay' });
  // 抽屉从底部起、占 45% 高（不是全屏、也不是居中）
  const panel = overlay.rects['infoPanel'];
  if (panel === undefined) throw new Error('sheet 缺 infoPanel');
  const { height } = platform.screen;
  expect(panel.h).toBeCloseTo(height * 0.45, 1);
  expect(panel.y + panel.h).toBeCloseTo(height, 1);
  // 遮罩盖住整屏（抽屉之外的区域都由它吃点击）
  expect(overlay.rects['panel']?.h).toBeCloseTo(height, 1);
  game.stop();
});

it('sheet：点遮罩（含底层按钮位置）不穿透，浮层仍在', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'card1');
  clickAt(platform, 5, 5);
  expect(game.state.modal).toBe('sheet');
  // 底层 menu 的 primaryButton 绑「打开背包」：穿透的话 screen 会变成 inventory
  const baseRect = game.layout.rects['primaryButton'];
  if (baseRect === undefined) throw new Error('menu 缺 primaryButton');
  clickAt(platform, baseRect.x + baseRect.w / 2, baseRect.y + baseRect.h / 2);
  expect(game.state.modal).toBe('sheet');
  expect(game.state.screen).toBe('menu');
  game.stop();
});

it('sheet：点抽屉里的「关闭」只清浮层', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'card1');
  clickOverlay(game, platform, 'primaryButton');
  expect(game.state.modal).toBeNull();
  expect(game.state.screen).toBe('menu');
  game.stop();
});

it('half：menu 上打开半屏 —— 浮层面板 58% 高、左右各留 8%、竖直居中', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'infoPanel');
  expect(game.state.screen).toBe('menu');

  const overlay = game.overlay;
  if (overlay === null) throw new Error('half 浮层没建出来');
  expect(overlay.screen).toBe('half');
  const panel = overlay.rects['infoPanel'];
  if (panel === undefined) throw new Error('half 缺 infoPanel');
  const { width, height } = platform.screen;
  expect(panel.h).toBeCloseTo(height * 0.58, 1);
  expect(panel.w).toBeCloseTo(width * 0.84, 1);
  // 居中：上下留白相等、左右各 8%
  expect(panel.y).toBeCloseTo((height - panel.h) / 2, 1);
  expect(panel.x).toBeCloseTo(width * 0.08, 1);
  game.stop();
});

it('half：点面板外的遮罩不穿透；点「关闭」只清浮层', () => {
  const platform = mock();
  const game = createGame(platform);
  game.start();
  clickComponent(game, platform, 'infoPanel');
  clickAt(platform, 5, 5);
  expect(game.state.modal).toBe('half');
  // 底层 menu 的 primaryButton 绑「打开背包」：穿透的话 screen 会变成 inventory
  const baseRect = game.layout.rects['primaryButton'];
  if (baseRect === undefined) throw new Error('menu 缺 primaryButton');
  clickAt(platform, baseRect.x + baseRect.w / 2, baseRect.y + baseRect.h / 2);
  expect(game.state.modal).toBe('half');
  expect(game.state.screen).toBe('menu');

  clickOverlay(game, platform, 'primaryButton');
  expect(game.state.modal).toBeNull();
  expect(game.state.screen).toBe('menu');
  game.stop();
});

