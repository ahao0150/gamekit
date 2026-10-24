/**
 * T15 绘制测试：八个通用组件「真实绘制发生过」。
 *
 * 假 ctx 记录 fillRect / fillText / drawImage / arc / clip / scale / globalAlpha，
 * 断言：次数 > 0、坐标有限且落在 box 内、关键形态（进度填充宽、三态 scale/offset/alpha 不同、
 * 头像真的调了 clip）。
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../components';
import { avatar } from './avatar';
import { badge } from './badge';
import { button } from './button';
import { divider } from './divider';
import { icon } from './icon';
import { label } from './label';
import { panel } from './panel';
import { progress } from './progress';
import { expectInside, makeBox, makeDeps, makeImage, render } from './test-helpers';

const nativeKey = (native: unknown): string => (native as { key?: string }).key ?? '';

describe('progress：填充宽度 = value/max × 轨道宽', () => {
  it('track + fill 两次 fillRect，颜色走主题', () => {
    const spy = render(progress, makeBox(10, 20, 200, 12), { value: 25, max: 100 });
    expect(spy.fills).toHaveLength(2);
    expect(spy.fills[0]?.args).toEqual([10, 20, 200, 12]);
    expect(spy.fills[1]?.args).toEqual([10, 20, 50, 12]);
    expect(spy.fills[0]?.color).toBe(DEFAULT_THEME.panel);
    expect(spy.fills[1]?.color).toBe(DEFAULT_THEME.primary);
    expectInside(spy.fills[1]!.args, makeBox(10, 20, 200, 12), 'progress 填充');
  });

  it('value 超范围钳制：150 → 100%、-5 → 0%', () => {
    const full = render(progress, makeBox(0, 0, 200, 12), { value: 150 });
    expect(full.fills[1]?.args).toEqual([0, 0, 200, 12]);
    const empty = render(progress, makeBox(0, 0, 200, 12), { value: -5 });
    expect(empty.fills).toHaveLength(1); // 只有轨道，没有零宽填充
  });

  it('vertical：填充从底部向上', () => {
    const spy = render(progress, makeBox(10, 20, 12, 120), { value: 50, direction: 'vertical' });
    expect(spy.fills[1]?.args).toEqual([10, 80, 12, 60]);
  });

  it('showText 显示百分比；radius > 0 走圆角路径', () => {
    const spy = render(progress, makeBox(0, 0, 200, 12), { value: 50, showText: true, radius: 6 });
    expect(spy.texts[0]?.text).toBe('50%');
    expect(spy.texts[0]?.x).toBe(100);
    expect(spy.pathFills).toBe(2);
    expect(spy.fills).toHaveLength(0);
  });
});

describe('button：三态视觉同时生效', () => {
  const box = makeBox(20, 100, 296, 56);

  it('normal：主题主色底 + 文字，scale / alpha 不动', () => {
    const spy = render(button, box, { text: '开始' });
    expect(spy.fills[0]?.args).toEqual([20, 100, 296, 56]);
    expect(spy.fills[0]?.color).toBe(DEFAULT_THEME.primary);
    expect(spy.scales).toEqual([]);
    expect(spy.alphas).toEqual([]);
    expect(spy.texts[0]?.text).toBe('开始');
  });

  it('pressed：scale 0.96 + 下移 2px', () => {
    const spy = render(button, box, { state: 'pressed', text: '开始' });
    expect(spy.scales).toEqual([[0.96, 0.96]]);
    expect(spy.translates).toHaveLength(2); // 平移到中心 + 平移回来
    expect(spy.fills[0]?.args).toEqual([20, 102, 296, 56]);
    expect(spy.alphas).toEqual([]);
  });

  it('disabled：alpha 0.45 + 主题 disabled 色', () => {
    const spy = render(button, box, { state: 'disabled', text: '开始' });
    expect(spy.alphas).toContain(0.45);
    expect(spy.fills[0]?.color).toBe(DEFAULT_THEME.disabled);
    expect(spy.scales).toEqual([]);
  });

  it('贴图切换：pressed 用 pressedImage，缺省回落 image；缺失回落纯色', () => {
    const deps = makeDeps([makeImage('ui/normal', 100, 56), makeImage('ui/pressed', 100, 56)]);
    const pressed = render(button, makeBox(0, 0, 296, 56), { state: 'pressed', image: 'ui/normal', pressedImage: 'ui/pressed' }, deps);
    expect(pressed.images).toHaveLength(1);
    expect(nativeKey(pressed.images[0]?.native)).toBe('ui/pressed');
    const fallback = render(button, makeBox(0, 0, 296, 56), { state: 'pressed', image: 'ui/normal' }, deps);
    expect(nativeKey(fallback.images[0]?.native)).toBe('ui/normal');
    const none = render(button, makeBox(0, 0, 296, 56), { state: 'disabled', disabledImage: 'missing' }, deps);
    expect(none.images).toHaveLength(0);
    expect(none.fills).toHaveLength(1);
  });

  it('text 空串：不画文字，也不崩', () => {
    const spy = render(button, box, { text: '' });
    expect(spy.texts).toHaveLength(0);
    expect(spy.fills).toHaveLength(1);
  });
});

describe('panel：九宫格复用 + 缺图兜底', () => {
  it('有图画 9 段 drawImage，源切片从帧起算', () => {
    const deps = makeDeps([makeImage('ui/panel', 400, 300, 10, 20)]);
    const spy = render(panel, makeBox(0, 0, 320, 200), { image: 'ui/panel', slice: 60 }, deps);
    expect(spy.images).toHaveLength(9);
    expect(spy.images[0]?.args.slice(0, 2)).toEqual([10, 20]);
  });

  it('无图 / 素材太小：回落主题面板色', () => {
    const noImage = render(panel, makeBox(0, 0, 320, 200), { image: 'ui/panel' });
    expect(noImage.images).toHaveLength(0);
    expect(noImage.fills[0]?.color).toBe(DEFAULT_THEME.panel);
    // 源图 100×100 < 2×slice(60)：九宫格切片越界 → 回落
    const tooSmall = render(panel, makeBox(0, 0, 320, 200), { slice: 60 }, makeDeps([makeImage('ui/panel', 100, 100)]));
    expect(tooSmall.images).toHaveLength(0);
    expect(tooSmall.fills).toHaveLength(1);
  });
});

describe('label：对齐 / 省略号 / 空串', () => {
  it('left / center / right 的 fillText 锚点不同', () => {
    const box = makeBox(10, 10, 100, 20);
    expect(render(label, box, { text: 'ABC', align: 'left' }).texts[0]?.x).toBe(10);
    expect(render(label, box, { text: 'ABC', align: 'center' }).texts[0]?.x).toBe(60);
    expect(render(label, box, { text: 'ABC', align: 'right' }).texts[0]?.x).toBe(110);
  });

  it('超 maxWidth 加省略号，空串不画', () => {
    const long = render(label, makeBox(0, 0, 60, 20), { text: '这是一段很长的文字', fontSize: 16, maxWidth: 60 });
    expect(long.texts[0]?.text.endsWith('…')).toBe(true);
    expect(long.texts[0]?.text.length).toBeLessThan(10);
    expect(render(label, makeBox(0, 0, 60, 20), { text: '' }).texts).toHaveLength(0);
  });
});

describe('icon / badge / divider / avatar', () => {
  it('icon：等比缩放居中；缺图画占位方块', () => {
    const deps = makeDeps([makeImage('i', 64, 64)]);
    const spy = render(icon, makeBox(10, 10, 32, 32), { image: 'i', size: 32 }, deps);
    expect(spy.images).toHaveLength(1);
    expect(spy.images[0]?.args).toEqual([0, 0, 64, 64, 10, 10, 32, 32]);
    const wide = render(icon, makeBox(10, 10, 32, 32), { image: 'w', size: 32 }, makeDeps([makeImage('w', 64, 32)]));
    expect(wide.images[0]?.args.slice(4)).toEqual([10, 18, 32, 16]);
    const missing = render(icon, makeBox(10, 10, 32, 32));
    expect(missing.images).toHaveLength(0);
    expect(missing.fills).toHaveLength(1);
    expectInside(missing.fills[0]!.args, makeBox(10, 10, 32, 32), 'icon 占位');
  });

  it('badge：空 text 画圆点（右上角内缩 2px），有 text 画胶囊 + 文字', () => {
    const dot = render(badge, makeBox(100, 50, 24, 24), { dotSize: 10 });
    expect(dot.arcs).toHaveLength(1);
    expect(dot.arcs[0]?.[0]).toBeCloseTo(117, 6);
    expect(dot.arcs[0]?.[1]).toBeCloseTo(57, 6);
    expect(dot.arcs[0]?.[2]).toBe(5);
    expect(dot.pathFills).toBe(1);
    expect(dot.texts).toHaveLength(0);
    const withText = render(badge, makeBox(100, 50, 24, 24), { text: '3' });
    // 有文字时是圆角胶囊：走路径填充（radius = h/2 > 0），不是 fillRect
    expect(withText.pathFills).toBe(1);
    expect(withText.texts[0]?.text).toBe('3');
  });

  it('divider：水平/垂直各一次 fillRect，厚度生效', () => {
    const h = render(divider, makeBox(10, 100, 200, 5), { direction: 'horizontal', thickness: 1 });
    expect(h.fills[0]?.args).toEqual([10, 102, 200, 1]);
    expect(h.fills[0]?.color).toBe(DEFAULT_THEME.gridLine);
    const v = render(divider, makeBox(10, 100, 5, 200), { direction: 'vertical', thickness: 3 });
    expect(v.fills[0]?.args).toEqual([11, 100, 3, 200]);
  });

  it('avatar：圆形真裁切（save/clip/restore），有图画图、无图占位', () => {
    const plain = render(avatar, makeBox(0, 0, 64, 64), { shape: 'circle' });
    expect(plain.saves).toBe(1);
    expect(plain.clips).toBe(1);
    expect(plain.restores).toBe(1);
    expect(plain.arcs).toHaveLength(1);
    expect(plain.fills).toHaveLength(1);
    const withImage = render(avatar, makeBox(0, 0, 64, 64), { image: 'a', shape: 'circle' }, makeDeps([makeImage('a', 128, 128)]));
    expect(withImage.images).toHaveLength(1);
    expect(withImage.clips).toBe(1);
    const rounded = render(avatar, makeBox(0, 0, 64, 64), { shape: 'rounded', radius: 12 });
    expect(rounded.clips).toBe(1);
    expect(rounded.saves).toBe(1);
  });
});
