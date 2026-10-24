import { expect, it } from 'vitest';
import { BUILTIN_COMPONENTS, createBuiltinRegistry } from './builtin';
import { parcelGrid, infoPanel, card0, card1 } from './builtin-panel';
import { primaryButton, secondaryButton, coinBadge, statusText, pause } from './builtin-parts';
import type { MeasureEnv, ComponentDef } from './components';
import type { Rect } from './contract';

const env = (width: number, height: number, data: Record<string, unknown> = {}): MeasureEnv => ({
  viewport: { width, height },
  data,
});
const box = (w: number, h: number): Rect => ({ x: 0, y: 0, w, h });
const measure = (def: ComponentDef, e: MeasureEnv, b: Rect = box(e.viewport.width, e.viewport.height), props = {}) =>
  def.measure(e, b, props);

it('内置注册表装好 9 个组件，且每个组件都有 assert', () => {
  const registry = createBuiltinRegistry();
  expect(registry.names()).toEqual([
    'primaryButton', 'secondaryButton', 'coinBadge', 'statusText', 'pause', 'parcelGrid', 'infoPanel', 'card0', 'card1',
  ]);
  for (const comp of BUILTIN_COMPONENTS) {
    expect(comp.def.assert, `${comp.name} 缺 assert`).toBeTypeOf('function');
    expect(registry.get(comp.name)).toBe(comp.def);
  }
});

it('parcelGrid measure = min(W*.84/cols, H*.32/rows)：390×844 与 320×568 的实测值', () => {
  const big = measure(parcelGrid.def, env(390, 844, { cols: 3, rows: 2 }));
  expect(big.w).toBeCloseTo(327.6, 6);
  expect(big.h).toBeCloseTo(218.4, 6);
  const small = measure(parcelGrid.def, env(320, 568, { cols: 3, rows: 2 }));
  expect(small.w).toBeCloseTo(268.8, 6);
  expect(small.h).toBeCloseTo(179.2, 6);
  // 高度驱动的情况：cols 少时被 H*.32/rows 卡住
  const square = measure(parcelGrid.def, env(390, 844, { cols: 1, rows: 1 }));
  expect(square.w).toBeCloseTo(270.08, 6);
  expect(square.h).toBeCloseTo(270.08, 6);
});

it('parcelGrid：props 覆盖游戏数据，缺数据时回落 3×2', () => {
  const four = measure(parcelGrid.def, env(390, 844, { cols: 3, rows: 2 }), box(390, 844), { cols: 4, rows: 3 });
  // 4×3：cell = min(327.6/4, 270.08/3) = 81.9
  expect(four.w).toBeCloseTo(327.6, 6);
  expect(four.h).toBeCloseTo(245.7, 6);
  // 无 props 无 data：3×2
  const fallback = measure(parcelGrid.def, env(390, 844));
  expect(fallback.w).toBeCloseTo(327.6, 6);
  expect(fallback.h).toBeCloseTo(218.4, 6);
});

it('parcelGrid assert：cols 非法、格子太小都要报中文问题', () => {
  expect(parcelGrid.def.assert?.(box(327.6, 218.4), {})).toEqual([]);
  expect(parcelGrid.def.assert?.(box(327.6, 218.4), { cols: 0 })?.join(' ')).toContain('1..12 的整数');
  expect(parcelGrid.def.assert?.(box(327.6, 218.4), { rows: 2.5 })?.join(' ')).toContain('1..12 的整数');
  // 6 列 4 行塞进 300×200：格子 50×50 > 12 没问题；缩小到 60×40 就报太小
  expect(parcelGrid.def.assert?.(box(60, 40), { cols: 6, rows: 4 })?.join(' ')).toContain('格子边长');
});

it('infoPanel / card0 / card1 的 measure 按视口比例', () => {
  const info = measure(infoPanel.def, env(390, 844));
  expect(info.w).toBeCloseTo(351, 6);
  expect(info.h).toBeCloseTo(109.72, 6);
  expect(measure(card0.def, env(390, 844)).w).toBeCloseTo(167.7, 6);
  expect(measure(card1.def, env(390, 844)).h).toBeCloseTo(67.52, 6);
  expect(card0.def.defaultSize).toEqual({ w: 168, h: 68 });
});

it('infoPanel / card assert：太窄太矮会报九宫格被压扁', () => {
  expect(infoPanel.def.assert?.(box(351, 109.72), {})).toEqual([]);
  expect(infoPanel.def.assert?.(box(100, 40), {})?.length).toBe(2);
  expect(card0.def.assert?.(box(167.7, 67.52), {})).toEqual([]);
  expect(card0.def.assert?.(box(167.7, 20), {})?.join(' ')).toContain('源边距');
});

it('按钮 measure：短 label 取最小宽，长 label 按文字宽 + 左右留白', () => {
  expect(measure(primaryButton.def, env(390, 844), box(168, 63), { label: '开始' })).toEqual({ w: 96, h: 63 });
  const wide = measure(primaryButton.def, env(390, 844), box(168, 63), { label: '开始配送这个很长的按钮' });
  expect(wide.w).toBeGreaterThan(200);
  expect(wide.h).toBe(63);
  expect(measure(secondaryButton.def, env(390, 844), box(168, 63), { label: '下一单' })).toEqual({ w: 117, h: 63 });
});

it('按钮 assert：label 超 8 字、宽小于高都要报', () => {
  expect(primaryButton.def.assert?.(box(168, 63), { label: '开始' })).toEqual([]);
  expect(primaryButton.def.assert?.(box(168, 63), { label: '十二个字的按钮标签放不下' })?.join(' ')).toContain('超过 8 字');
  expect(primaryButton.def.assert?.(box(60, 63), { label: '开始' })?.join(' ')).toContain('中段拼不出来');
});

it('coinBadge / statusText / pause 的 measure 与 assert', () => {
  expect(measure(coinBadge.def, env(390, 844), box(100, 24), { label: '128' }).h).toBe(24);
  expect(coinBadge.def.assert?.(box(100, 24), { label: '128' })).toEqual([]);
  expect(coinBadge.def.assert?.(box(100, 24), { label: '12345678901' })?.join(' ')).toContain('撑出容器');

  expect(measure(statusText.def, env(390, 844), box(351, 24), { label: '剩余 90 秒' }).h).toBe(24);
  expect(statusText.def.assert?.(box(351, 24), { label: '' })?.join(' ')).toContain('需要 label');
  expect(statusText.def.assert?.(box(351, 24), { label: '这是一行特别特别长的状态文字，用来测试溢出情况到底会不会被报出来' })?.join(' ')).toContain('建议拆成多行');

  expect(measure(pause.def, env(390, 844), box(44, 44))).toEqual({ w: 44, h: 44 });
  expect(pause.def.assert?.(box(44, 44), {})).toEqual([]);
  expect(pause.def.assert?.(box(80, 44), {})?.join(' ')).toContain('建议正方形');
});
