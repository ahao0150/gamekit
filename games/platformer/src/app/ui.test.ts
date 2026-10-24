/**
 * T45 验收（纯函数层）：`.ui` 的 HUD / 浮层布局、动态 props 注入、绘制与命中。
 *
 * 这里不碰真浏览器：只证明「层算得对、画得出东西、命中分得清按钮与遮罩」。
 * 真浏览器里的 HUD 数值变化、通关浮层是否压着游戏画面，另有 CDP 验收。
 */

import { expect, it } from 'vitest';
import type { Ctx2D } from './deps';
import { COINS } from './level';
import { createInitialState } from './state';
import type { GameState } from './state';
import { createUiEngine, hitLayer, IDLE_PRESSED, uiLayerNames } from './ui';

const engine = createUiEngine();
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
];

/** 造状态：只写关心的字段。 */
const stateOf = (patch: Partial<GameState>): GameState => ({ ...createInitialState(), ...patch });

/** 记录 fillRect / fillText 的假画布（组件会用到 save/restore/path 等）。 */
const spyCtx = (): {
  ctx: Ctx2D;
  fills: { x: number; y: number; w: number; h: number }[];
  texts: string[];
} => {
  const fills: { x: number; y: number; w: number; h: number }[] = [];
  const texts: string[] = [];
  const ctx = {
    fillStyle: '', font: '', textAlign: '', textBaseline: '', globalAlpha: 1,
    lineWidth: 1, strokeStyle: '', lineCap: '', lineJoin: '',
    save: () => undefined, restore: () => undefined, translate: () => undefined, scale: () => undefined,
    beginPath: () => undefined, moveTo: () => undefined, lineTo: () => undefined,
    arcTo: () => undefined, closePath: () => undefined, arc: () => undefined,
    rect: () => undefined, clip: () => undefined,
    stroke: () => undefined, setLineDash: () => undefined, fill: () => undefined,
    fillRect: (x: number, y: number, w: number, h: number) => { fills.push({ x, y, w, h }); },
    fillText: (value: string) => { texts.push(value); },
  } as unknown as Ctx2D;
  return { ctx, fills, texts };
};

it('HUD / win / gameover 两个视口绑定与布局都干净（errors 为空）', () => {
  for (const viewport of VIEWPORTS) {
    const hud = engine.hud(viewport, stateOf({}));
    expect(hud.errors, `${viewport.width} HUD 有布局错误`).toEqual([]);
    const won = engine.modal(viewport, stateOf({ phase: 'won' }));
    expect(won?.errors, `${viewport.width} win 有布局错误`).toEqual([]);
    const over = engine.modal(viewport, stateOf({ phase: 'gameover' }));
    expect(over?.errors, `${viewport.width} gameover 有布局错误`).toEqual([]);
  }
});

it('HUD：顶部信息带 12% 高，金币/生命/进度/关卡组件都在', () => {
  const viewport = VIEWPORTS[0]!;
  const hud = engine.hud(viewport, stateOf({}));
  const band = hud.rects['panel'];
  expect(band).toBeDefined();
  expect(band?.w).toBe(viewport.width);
  expect(band?.h).toBeCloseTo(viewport.height * 0.12, 1);
  expect(band?.y).toBe(0);
  for (const name of ['coinBadge', 'label', 'statusText', 'progress']) {
    expect(hud.rects[name], `HUD 缺 ${name}`).toBeDefined();
  }
  // HUD 只显示不抢输入：四个节点都 hit none
  for (const name of ['panel', 'coinBadge', 'label', 'statusText', 'progress']) {
    expect(hud.paintOrder).toContain(name);
  }
});

it('动态 props：金币 / 生命 / 进度 / 关卡文字每帧从 state 注入', () => {
  const viewport = VIEWPORTS[0]!;
  const hud = engine.hud(viewport, stateOf({ coins: 3, lives: 2 }));
  expect(hud.props['coinBadge']).toMatchObject({ label: '金币 3' });
  expect(hud.props['label']).toMatchObject({ text: '生命 ×2' });
  expect(hud.props['progress']).toMatchObject({ value: 3, max: COINS.length });
  expect(hud.props['statusText']).toMatchObject({ label: '关卡 1/1' });
  // 换一份 state，props 跟着变（不是静态的）
  const changed = engine.hud(viewport, stateOf({ coins: 5, lives: 1 }));
  expect(changed.props['coinBadge']).toMatchObject({ label: '金币 5' });
  expect(changed.props['label']).toMatchObject({ text: '生命 ×1' });
  expect(changed.props['progress']).toMatchObject({ value: 5 });
});

it('浮层选择：play/dead 没有浮层，won 是 win，gameover 是 gameover', () => {
  const viewport = VIEWPORTS[0]!;
  expect(engine.modal(viewport, stateOf({ phase: 'play' }))).toBeNull();
  expect(engine.modal(viewport, stateOf({ phase: 'dead' }))).toBeNull();
  expect(engine.modal(viewport, stateOf({ phase: 'won' }))?.name).toBe('win');
  expect(engine.modal(viewport, stateOf({ phase: 'gameover' }))?.name).toBe('gameover');
  expect(uiLayerNames(stateOf({ phase: 'play' }))).toEqual(['controls', 'hud']);
  expect(uiLayerNames(stateOf({ phase: 'won' }))).toEqual(['controls', 'hud', 'win']);
  expect(uiLayerNames(stateOf({ phase: 'gameover' }))).toEqual(['controls', 'hud', 'gameover']);
});

it('触屏按键：任何视口下都完整落在画布内（T80 回归）', () => {
  for (const viewport of VIEWPORTS) {
    const controls = engine.controls(viewport, stateOf({ phase: 'play' }), IDLE_PRESSED);
    for (const node of ['touchLeft', 'touchRight', 'touchJump']) {
      const rect = controls.rects[node]!;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(viewport.width);
      expect(rect.y + rect.h).toBeLessThanOrEqual(viewport.height);
    }
  }
});

it('触屏按键：按下态注入到 props（画与状态同源）', () => {
  const controls = engine.controls(VIEWPORTS[0]!, stateOf({ phase: 'play' }), {
    left: true, right: false, jump: true,
  });
  expect(controls.props['touchLeft']).toMatchObject({ pressed: true });
  expect(controls.props['touchRight']).toMatchObject({ pressed: false });
  expect(controls.props['touchJump']).toMatchObject({ pressed: true });
});

it('浮层：遮罩盖满整屏且半透明，按钮在面板内部', () => {
  const viewport = VIEWPORTS[0]!;
  const won = engine.modal(viewport, stateOf({ phase: 'won' }))!;
  const mask = won.rects['panel'];
  expect(mask).toEqual({ x: 0, y: 0, w: viewport.width, h: viewport.height });
  expect(won.props['panel']).toMatchObject({ fillColor: 'rgba(0,0,0,0.55)' });
  const button = won.rects['primaryButton'];
  const panel = won.rects['infoPanel'];
  expect(button).toBeDefined();
  expect(panel).toBeDefined();
  if (button === undefined || panel === undefined) return;
  expect(button.x).toBeGreaterThanOrEqual(panel.x - 0.01);
  expect(button.x + button.w).toBeLessThanOrEqual(panel.x + panel.w + 0.01);
  expect(button.y).toBeGreaterThanOrEqual(panel.y - 0.01);
  expect(button.y + button.h).toBeLessThanOrEqual(panel.y + panel.h + 0.01);
});

it('命中：按钮中心 → primaryButton；遮罩空白 → panel（block，不会误触发重开）', () => {
  const viewport = VIEWPORTS[0]!;
  const won = engine.modal(viewport, stateOf({ phase: 'won' }))!;
  const button = won.rects['primaryButton']!;
  expect(hitLayer(won, button.x + button.w / 2, button.y + button.h / 2)).toBe('primaryButton');
  // 左上角在遮罩上（面板之外）：命中的是 panel，不是按钮
  expect(hitLayer(won, 5, 5)).toBe('panel');
  // 面板区域内但不在按钮上：命中的是 infoPanel / label，也不是按钮
  const panel = won.rects['infoPanel']!;
  expect(hitLayer(won, panel.x + 6, panel.y + 6)).not.toBe('primaryButton');
});

it('绘制：HUD 真的画出文字，且没有任何「清屏级」全屏 fillRect（不盖住游戏画面）', () => {
  const viewport = VIEWPORTS[0]!;
  const spy = spyCtx();
  engine.draw(spy.ctx, engine.hud(viewport, stateOf({ coins: 4, lives: 2 })));
  expect(spy.texts).toContain('金币 4');
  expect(spy.texts).toContain('生命 ×2');
  expect(spy.texts).toContain('关卡 1/1');
  // HUD 唯一允许的大块填充是顶部 12% 的带子；不能出现整屏 fillRect
  for (const fill of spy.fills) {
    expect(fill.w <= viewport.width + 0.01).toBe(true);
    expect(fill.h <= viewport.height * 0.12 + 0.01, `HUD 出现整屏填充 ${JSON.stringify(fill)}`).toBe(true);
  }
});

it('绘制：win 浮层画出标题/统计/按钮，遮罩是整屏半透明（这里只验组件绘制，不清屏）', () => {
  const viewport = VIEWPORTS[0]!;
  const won = engine.modal(viewport, stateOf({ phase: 'won', coins: 2, lives: 1 }))!;
  const spy = spyCtx();
  engine.draw(spy.ctx, won);
  expect(spy.texts).toContain('到达终点！');
  expect(spy.texts.join('|')).toContain('金币 2/6');
  expect(spy.texts).toContain('再来一次');
  // 遮罩本身就是整屏那块（半透明黑），除此之外组件不该再画第二块整屏
  const full = spy.fills.filter((fill) => fill.w >= viewport.width - 0.01 && fill.h >= viewport.height - 0.01);
  expect(full).toHaveLength(1);
});

it('gameover 浮层：文案与按钮都是「重新开始」', () => {
  const viewport = VIEWPORTS[0]!;
  const over = engine.modal(viewport, stateOf({ phase: 'gameover', coins: 1 }))!;
  expect(over.props['label']).toMatchObject({ text: '生命用完' });
  expect(over.props['statusText']).toMatchObject({ label: expect.stringContaining('按按钮重开') });
  const spy = spyCtx();
  engine.draw(spy.ctx, over);
  expect(spy.texts).toContain('生命用完');
  expect(spy.texts).toContain('重新开始');
});
