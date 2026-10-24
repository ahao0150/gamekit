/**
 * 美术接入的契约测试（不碰 DOM、不碰构建注入）。
 *
 * 守三件曾经出过事的东西：
 * 1. **死资源**（T68 的 `btn.png`）：`assets/` 里每个媒体文件都必须在 `ART_KEYS` 里，
 *    反过来 `ART_KEYS` 也不能登记不存在的文件 —— 两边一致才算「每张图都有落点」。
 * 2. **浅底对比度**：主文字 / 危险色 / 珠子 rim 必须过 WCAG 线（配色改动时钉住）。
 * 3. **缺图回退不是空白**：没有 `AssetService` 时 `drawBead` 必须画出等价实体。
 */

import { readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { ART_KEYS, BEAD_KEYS } from './assets';
import { CELL_TINTS } from './levels';
import { mixColor } from './anim';
import { beanFallback, drawBead } from './render-art';
import { BG, HINT_STROKE, INK, RIM_DARK, TEMP_HOT_COLOR, THEME_PANEL } from './skin';
import { DEFAULT_THEME, primaryButton } from './deps';
import type { Ctx2D, DrawDeps, ImageAsset } from './deps';

const ASSETS_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'assets');
const MEDIA = new Set(['.png', '.webp', '.jpg', '.jpeg']);

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (MEDIA.has(extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
};

/** 文件路径 → 资源 key（相对 assets/、去扩展名、正斜杠） */
const keyOf = (file: string): string => relative(ASSETS_DIR, file).replace(/\\/g, '/').replace(/\.[^.]+$/, '');

/** WCAG 2.1 相对亮度（sRGB） */
const luminance = (hex: string): number => {
  const v = Number.parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
};
const contrast = (fg: string, bg: string): number => {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

it('assets/ 里每个文件都登记在 ART_KEYS（防死资源 / 防漏登记）', () => {
  const onDisk = walk(ASSETS_DIR).map(keyOf).sort();
  const declared = [...ART_KEYS].sort();
  expect(onDisk).toEqual(declared);
});

it('珠子 key 与 CELL_TINTS 一一对应（6 色，顺序一致）', () => {
  expect(BEAD_KEYS.length).toBe(CELL_TINTS.length);
  expect(BEAD_KEYS.every((k) => k.startsWith('beads/'))).toBe(true);
});

it('主文字 on HUD 磨砂底 ≥ 4.5:1（正文 AA）', () => {
  expect(contrast(INK, THEME_PANEL)).toBeGreaterThanOrEqual(4.5);
});

it('危险文字 on HUD 底 ≥ 4.5:1（原来的 #C2543F 只有 4.13，浅底上不合规）', () => {
  expect(contrast(TEMP_HOT_COLOR, THEME_PANEL)).toBeGreaterThanOrEqual(4.5);
});

it('黄珠 rim vs 背景 ≥ 3:1（WCAG 1.4.11 UI 组件下限，6 色里最差的一档）', () => {
  const yellowRim = mixColor(CELL_TINTS[1] ?? '#EFC54B', RIM_DARK, 0.5);
  expect(contrast(yellowRim, BG)).toBeGreaterThanOrEqual(3);
});

it('金色提示描边 vs 背景 ≥ 3:1（浅底上原 #E8A33D 会糊掉）', () => {
  expect(contrast(HINT_STROKE, BG)).toBeGreaterThanOrEqual(3);
});

it('缺图时 drawBead 画出等价实体（不是空白）', () => {
  const calls: string[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    beginPath: () => calls.push('beginPath'),
    moveTo: () => undefined,
    arcTo: () => undefined,
    closePath: () => undefined,
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    fillRect: () => calls.push('fillRect'),
  } as unknown as Ctx2D;
  drawBead(ctx, 0, 0, 20, 0, null);
  expect(calls.filter((c) => c === 'fill').length).toBeGreaterThanOrEqual(2); // 色块 + 高光
  expect(calls).toContain('stroke'); // 描边也在
});

it('beanFallback 用的是当前那套回退画法（圆角块 + 描边 + 高光）', () => {
  const calls: string[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    beginPath: () => calls.push('beginPath'),
    moveTo: () => undefined,
    arcTo: () => undefined,
    closePath: () => undefined,
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
  } as unknown as Ctx2D;
  beanFallback(ctx, 0, 0, 18, 2);
  expect(calls.filter((c) => c === 'fill')).toHaveLength(2);
  expect(calls).toContain('stroke');
});

// ---------------------------------------------------------------------------
// 「素材到位了但组件没画出来」—— 只校验清单一致是抓不到的（T73 踩过）
// ---------------------------------------------------------------------------

interface FakeCtx {
  readonly ctx: Ctx2D;
  readonly calls: string[];
}

const fakeCtx = (): FakeCtx => {
  const calls: string[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    globalAlpha: 1,
    drawImage: () => calls.push('drawImage'),
    fillRect: () => calls.push('fillRect'),
    strokeRect: () => calls.push('strokeRect'),
    fillText: () => calls.push('fillText'),
    measureText: (text: string) => ({ width: text.length * 12 }),
  };
  return { ctx: ctx as unknown as Ctx2D, calls };
};

const imgOf = (width: number, height: number): ImageAsset => ({
  key: 'k',
  width,
  height,
  src: 'test',
  native: {},
  sx: 0,
  sy: 0,
  sw: width,
  sh: height,
});

const depsWith = (image: ImageAsset | null): DrawDeps => ({
  assets: { get: () => image },
  theme: DEFAULT_THEME,
  data: {},
});

it('胶囊按钮在真实绘制路径上用素材画三段（素材 336×126 → 3 次 drawImage，不回落 fillRect）', () => {
  const { ctx, calls } = fakeCtx();
  primaryButton.def.draw(ctx, { x: 0, y: 0, w: 296, h: 56 }, { label: '继续拼豆' }, depsWith(imgOf(336, 126)));
  expect(calls.filter((c) => c === 'drawImage')).toHaveLength(3);
  expect(calls).not.toContain('fillRect');
});

it('素材尺寸与胶囊规格不符时必须回落纯色（禁止静默画错）', () => {
  const { ctx, calls } = fakeCtx();
  primaryButton.def.draw(ctx, { x: 0, y: 0, w: 296, h: 56 }, { label: '继续拼豆' }, depsWith(imgOf(200, 80)));
  expect(calls.filter((c) => c === 'drawImage')).toHaveLength(0);
  expect(calls).toContain('fillRect');
});

it('缺图时胶囊按钮回落纯色（回退分支不是空白）', () => {
  const { ctx, calls } = fakeCtx();
  primaryButton.def.draw(ctx, { x: 0, y: 0, w: 296, h: 56 }, { label: '继续拼豆' }, depsWith(null));
  expect(calls).toContain('fillRect');
  expect(calls.filter((c) => c === 'drawImage')).toHaveLength(0);
});
