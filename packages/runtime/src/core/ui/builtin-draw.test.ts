import { expect, it } from 'vitest';
import { DEFAULT_THEME } from './components';
import type { ComponentAssets, ComponentDef, DrawDeps, UiData } from './components';
import type { ImageAsset } from '../assets/contract';
import type { Ctx2D } from '../../platform/contract';
import type { Rect } from './contract';
import { primaryButton, secondaryButton, coinBadge, statusText, pause } from './builtin-parts';
import { parcelGrid, infoPanel, card0 } from './builtin-panel';

/** 记录 drawImage / fillRect / fillText 的假画布。 */
const spyCtx = (): {
  ctx: Ctx2D;
  images: number[][];
  fills: number[][];
  texts: { text: string; x: number; y: number; color: string }[];
} => {
  const images: number[][] = [];
  const fills: number[][] = [];
  const texts: { text: string; x: number; y: number; color: string }[] = [];
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    drawImage: (_img: unknown, ...args: number[]) => { images.push(args); },
    fillRect: (x: number, y: number, w: number, h: number) => { fills.push([x, y, w, h]); },
    fillText: (text: string, x: number, y: number) => { texts.push({ text, x, y, color: String(ctx.fillStyle) }); },
  } as unknown as Ctx2D;
  return { ctx, images, fills, texts };
};

const img = (key: string, w: number, h: number, sx = 0, sy = 0): ImageAsset => ({
  key, width: w, height: h, src: `${key}.png`, native: { kind: 'fake' }, sx, sy, sw: w, sh: h,
});
const assets = (list: readonly ImageAsset[]): ComponentAssets => ({
  get: (key: string) => list.find((i) => i.key === key) ?? null,
});
const deps = (list: readonly ImageAsset[] = [], data?: UiData): DrawDeps => ({
  assets: assets(list),
  theme: DEFAULT_THEME,
  ...(data === undefined ? {} : { data }),
});
const box = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const draw = (def: ComponentDef, r: Rect, props = {}, d: DrawDeps = deps()) => {
  const spy = spyCtx();
  def.draw(spy.ctx, r, props, d);
  return spy;
};

it('primaryButton 有素材：三段胶囊 drawImage，源切片 63 / 8 / 63，文字居中', () => {
  const spy = draw(primaryButton.def, box(19.5, 683.64, 167.7, 63.3), { label: '开始' },
    deps([img('ui/btn-primary_normal', 336, 126)]));
  expect(spy.images).toHaveLength(3);
  expect(spy.images.map((a) => a[2])).toEqual([63, 8, 63]); // sw
  expect(spy.images.map((a) => a[0])).toEqual([0, 63, 273]); // sx
  expect(spy.fills).toHaveLength(0); // 不兜底
  expect(spy.texts.map((t) => t.text)).toEqual(['开始']);
  // draw 用的就是传进来的 box：第一段 dx / dy 等于 box 的左上角
  expect(spy.images[0]?.[4]).toBe(19.5);
  expect(spy.images[0]?.[5]).toBe(683.64);
});

it('primaryButton 无素材：drawImage 0 次、回落主题主色 fillRect，文字照画', () => {
  const spy = draw(primaryButton.def, box(0, 0, 168, 63), { label: '开始' }, deps());
  expect(spy.images).toHaveLength(0);
  expect(spy.fills).toEqual([[0, 0, 168, 63]]);
  expect(spy.texts[0]?.text).toBe('开始');
  expect(spy.texts[0]?.color).toBe(DEFAULT_THEME.light);
});

it('图集帧：源矩形从帧的 sx/sy 起算，不会切到相邻帧', () => {
  const spy = draw(secondaryButton.def, box(10, 20, 168, 63), { label: '下一单' },
    deps([img('ui/btn-secondary_normal', 336, 126, 300, 200)]));
  expect(spy.images.map((a) => a[0])).toEqual([300, 363, 573]);
  expect(spy.images.map((a) => a[1])).toEqual([200, 200, 200]);
});

it('disabled 按钮：用 disabled 素材，缺失时回落 disabled 主题色', () => {
  const spy = draw(primaryButton.def, box(0, 0, 168, 63), { label: '开始', disabled: true },
    deps([img('ui/btn-primary_disabled', 336, 126)]));
  expect(spy.images).toHaveLength(3);
  const fallback = draw(primaryButton.def, box(0, 0, 168, 63), { label: '开始', disabled: true }, deps());
  expect(fallback.fills).toEqual([[0, 0, 168, 63]]);
});

it('coinBadge：图标 drawImage 1 次 + 数值文字；无图标时只画文字', () => {
  const withIcon = draw(coinBadge.def, box(200, 30, 80, 24), { label: '128' },
    deps([img('icons/icon-coin', 128, 128)]));
  expect(withIcon.images).toHaveLength(1);
  expect(withIcon.texts[0]?.text).toBe('128');
  const noIcon = draw(coinBadge.def, box(200, 30, 80, 24), { label: '128' }, deps());
  expect(noIcon.images).toHaveLength(0);
  expect(noIcon.texts[0]?.text).toBe('128');
});

it('statusText：居中文字；tone=light 用浅色，默认用深墨', () => {
  const ink = draw(statusText.def, box(19.5, 75.96, 351, 36), { label: '剩余 90 秒' });
  expect(ink.texts).toHaveLength(1);
  expect(ink.texts[0]?.color).toBe(DEFAULT_THEME.ink);
  expect(ink.texts[0]?.x).toBeCloseTo(19.5 + 351 / 2, 6);
  const light = draw(statusText.def, box(0, 0, 100, 24), { label: '配送完成', tone: 'light' });
  expect(light.texts[0]?.color).toBe(DEFAULT_THEME.light);
});

it('pause：两条竖杠（2 次 fillRect），位置围绕 box 中心', () => {
  const spy = draw(pause.def, box(320, 20, 44, 44), {});
  expect(spy.fills).toHaveLength(2);
  const [left, right] = spy.fills as [number[], number[]];
  expect(left[0]! + left[2]!).toBeLessThan(right[0]!);
  expect(left[1]).toBeGreaterThan(20);
  expect(left[2]).toBeGreaterThan(0);
});

it('parcelGrid：按 cols×rows 画格子，格距从 box 反推；cols/rows 优先读数据快照', () => {
  const spy = draw(parcelGrid.def, box(31.2, 211, 327.6, 218.4), {}, deps([], { cols: 3, rows: 2 }));
  expect(spy.fills).toHaveLength(6);
  const first = spy.fills[0]!;
  expect(first[0]).toBeCloseTo(31.2, 6);
  expect(first[1]).toBeCloseTo(211, 6);
  expect(first[2]).toBeCloseTo((327.6 / 3) * 0.96, 6);
  expect(first[3]).toBeCloseTo((218.4 / 2) * 0.96, 6);
  const four = draw(parcelGrid.def, box(0, 0, 320, 320), { cols: 4, rows: 4 }, deps());
  expect(four.fills).toHaveLength(16);
});

it('infoPanel：有九宫格素材画 9 段，无素材回落面板色', () => {
  const spy = draw(infoPanel.def, box(19.5, 75.96, 351, 109.72), { label: '装箱说明' },
    deps([img('panel/panel-info', 720, 560)]));
  expect(spy.images).toHaveLength(9);
  expect(spy.texts[0]?.text).toBe('装箱说明');
  const fallback = draw(infoPanel.def, box(0, 0, 351, 110), {}, deps());
  expect(fallback.fills).toEqual([[0, 0, 351, 110]]);
});

it('card0：九宫格卡片 + 默认编号文字', () => {
  const spy = draw(card0.def, box(19.5, 514.84, 167.7, 67.52), {}, deps([img('card/card-parcel_normal', 168, 135)]));
  expect(spy.images).toHaveLength(9);
  expect(spy.texts.map((t) => t.text)).toEqual(['1']);
  const custom = draw(card0.def, box(0, 0, 168, 68), { label: '包裹 A' }, deps([img('card/card-parcel_normal', 168, 135)]));
  expect(custom.texts.map((t) => t.text)).toEqual(['包裹 A']);
});
