/**
 * 胶囊避让单测（T49）：`platform.screen.menuButton`（微信/抖音右上角系统胶囊）
 * 如何影响 HUD 布局，以及 **web（无胶囊）布局逐像素不变** 这条回归判据。
 *
 * 做法是「layout 之后整体下移」而不是改 `.ui`：`.ui` 是静态布局，窄屏收窄宽度会
 * 直接让 HUD 行溢出（实测 320 宽时 coinBadge+label 需要 230px，胶囊左侧只剩 203px）。
 * 真机上的渲染对比在 CDP 验收里（截图 + 矩形数字）。
 */

import { expect, it } from 'vitest';
import { createInitialState } from './state';
import { createUiEngine, HUD_MENU_GAP, hudOffsetFor } from './ui';

const engine = createUiEngine();
const state = createInitialState();
const FULL = { width: 390, height: 844 };

/** 微信 390×844 真机胶囊尺寸（T47 采样）。 */
const CAPSULE = { x: 281, y: 26, w: 87, h: 32 };

/** 矩形重叠判定（与验收脚本同一个判据；同一函数保证「说没压住」可复核）。 */
const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

it('web / 桌面（没有 menuButton）→ 偏移为 0，HUD 矩形与改造前逐像素相同', () => {
  expect(hudOffsetFor(FULL)).toEqual({ x: 0, y: 0 });
  const hud = engine.hud(FULL, state, hudOffsetFor(FULL));
  const baseline = engine.hud(FULL, state);
  expect(hud.rects).toEqual(baseline.rects);
  expect(hud.errors).toEqual([]);
});

it('有胶囊 → 整体下移到胶囊底边 + 间隙（不是收窄、不是硬编码）', () => {
  const offset = hudOffsetFor({ height: 844, menuButton: CAPSULE });
  expect(offset).toEqual({ x: 0, y: CAPSULE.y + CAPSULE.h + HUD_MENU_GAP });
  expect(offset.y).toBe(66);
});

it('390×844 + 胶囊：「生命」矩形与胶囊不重叠，且整条 HUD 带都在胶囊下方', () => {
  const hud = engine.hud(FULL, state, hudOffsetFor({ height: 844, menuButton: CAPSULE }));
  expect(hud.errors).toEqual([]);
  const label = hud.rects['label'];
  const band = hud.rects['panel'];
  expect(label).toBeDefined();
  expect(band).toBeDefined();
  if (label === undefined || band === undefined) return;
  // 断言数字（报告里也贴这组）：label 在胶囊下方，横向重叠也无所谓
  expect(overlaps(label, CAPSULE)).toBe(false);
  expect(label.y).toBeGreaterThanOrEqual(CAPSULE.y + CAPSULE.h);
  expect(band.y).toBe(offsetOfBand());
  expect(band.y).toBeGreaterThan(CAPSULE.y + CAPSULE.h);
  // 其他右上角元素（进度条）同样在胶囊下方
  const progress = hud.rects['progress'];
  if (progress !== undefined) expect(overlaps(progress, CAPSULE)).toBe(false);
});

it('320×568 + 窄屏胶囊 → 宽度不变（不会行溢出），HUD 不消失', () => {
  const screen = { width: 320, height: 568 };
  const capsule = { x: 211, y: 24, w: 87, h: 32 };
  const hud = engine.hud(screen, state, hudOffsetFor({ height: 568, menuButton: capsule }));
  expect(hud.errors).toEqual([]);
  const label = hud.rects['label'];
  const band = hud.rects['panel'];
  expect(label).toBeDefined();
  expect(band?.w).toBe(320);
  if (label === undefined) return;
  expect(overlaps(label, capsule)).toBe(false);
  expect(label.w).toBeGreaterThan(0);
});

it('坏胶囊数据（h<=0 / 偏移超过屏高 25%）→ 退回零偏移，绝不把 HUD 挪出屏幕', () => {
  expect(hudOffsetFor({ height: 844, menuButton: { x: 281, y: 26, w: 87, h: 0 } })).toEqual({ x: 0, y: 0 });
  expect(hudOffsetFor({ height: 568, menuButton: { x: 211, y: 800, w: 87, h: 32 } })).toEqual({ x: 0, y: 0 });
  const hud = engine.hud({ width: 320, height: 568 }, state, hudOffsetFor({ height: 568, menuButton: { x: 211, y: 800, w: 87, h: 32 } }));
  const label = hud.rects['label'];
  expect(label?.y).toBeLessThan(568);
});

it('绘制也真的跟着平移（不是只改数据）：HUD 带的 fillRect.y = 66，文字仍画出来', () => {
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
  };
  const offset = hudOffsetFor({ height: 844, menuButton: CAPSULE });
  engine.draw(ctx as never, engine.hud(FULL, state, offset));
  expect(fills.some((fill) => Math.abs(fill.y - 66) < 0.01 && Math.abs(fill.w - 390) < 0.01)).toBe(true);
  expect(texts).toContain('生命 ×3');
  expect(texts).toContain('金币 0');
  expect(texts).toContain('关卡 1/1');
});

/** HUD 带（12% 高）在胶囊下的期望 y。 */
function offsetOfBand(): number {
  return CAPSULE.y + CAPSULE.h + HUD_MENU_GAP;
}
