/**
 * `toast` 组件测试（T17）：真实绘制断言（背景 + 文字坐标在框内 + 图标位置 + 透明度）。
 *
 * toast 不管自己出现在屏幕哪里（那是 `.ui` overlay region 的事），所以这里只断言
 * 「在给定 box 里画的东西对不对」。
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, estimateTextWidth } from '../components';
import { bindComponents } from '../bind';
import { layout } from '../layout';
import { parse } from '../parse';
import { createWidgetRegistry } from './index';
import { toast } from './toast';
import { expectInside, makeBox, makeDeps, makeEnv, makeImage, render } from './test-helpers';

/** 一块 240×44 的 toast（高固定 44）。 */
const box = makeBox(20, 300, 240, 44);
const nativeKey = (native: unknown): string => (native as { key?: string }).key ?? '';

describe('measure：宽随内容长，高固定 44', () => {
  it('无图标：宽 = 文字估算宽 + 左右 padding', () => {
    const text = '已送达';
    const expected = Math.ceil(16 * 2 + estimateTextWidth(text, 16));
    expect(toast.def.measure({ viewport: { width: 390, height: 844 }, data: {} }, box, { text })).toEqual({
      w: expected,
      h: 44,
    });
  });

  it('有图标：宽再加上图标 24 + 间距 8', () => {
    const plain = toast.def.measure({ viewport: { width: 390, height: 844 }, data: {} }, box, { text: '已送达' });
    const withIcon = toast.def.measure({ viewport: { width: 390, height: 844 }, data: {} }, box, {
      text: '已送达',
      icon: 'icons/star',
    });
    expect(withIcon.w).toBe(plain.w + 24 + 8);
  });

  it('textSize 影响文字宽（16 → 24 变宽），高不变', () => {
    const small = toast.def.measure({ viewport: { width: 390, height: 844 }, data: {} }, box, { text: '已送达', textSize: 16 });
    const big = toast.def.measure({ viewport: { width: 390, height: 844 }, data: {} }, box, { text: '已送达', textSize: 24 });
    expect(big.w).toBeGreaterThan(small.w);
    expect(big.h).toBe(44);
  });
});

describe('draw：背景与文字', () => {
  it('默认 radius=8 走圆角路径填充，并 save/restore 包住透明度', () => {
    const spy = render(toast, box, { text: '已送达' });
    expect(spy.pathFills).toBe(1); // 圆角背景
    expect(spy.fills).toHaveLength(0); // 没有直角 fillRect
    expect(spy.saves).toBe(1);
    expect(spy.restores).toBe(1);
  });

  it('radius=0 退回 fillRect：坐标正好是 box', () => {
    const spy = render(toast, box, { text: '已送达', radius: 0 });
    expect(spy.fills).toHaveLength(1);
    expect(spy.fills[0]?.args).toEqual([box.x, box.y, box.w, box.h]);
    expect(spy.pathFills).toBe(0);
  });

  it('文字居垂直中、从左内边距起画，坐标落在框内', () => {
    const spy = render(toast, box, { text: '已送达' });
    const text = spy.texts[0];
    expect(text?.text).toBe('已送达');
    expect(text?.x).toBe(box.x + 16);
    expect(text?.y).toBe(box.y + box.h / 2);
    expectInside([text?.x ?? 0, (text?.y ?? 0) - 8, 60, 16], box, 'toast 文字');
  });

  it('有图标且素材存在：drawImage 一次，文字整体右移 24+8', () => {
    const deps = makeDeps([makeImage('icons/star', 64, 64)]);
    const spy = render(toast, box, { text: '已送达', icon: 'icons/star' }, deps);
    expect(spy.images).toHaveLength(1);
    expect(nativeKey(spy.images[0]?.native)).toBe('icons/star');
    // args = [sx, sy, sw, sh, dx, dy, dw, dh]：图标在左内边距、纵向居中
    expect(spy.images[0]?.args[4]).toBe(box.x + 16);
    expect(spy.images[0]?.args[5]).toBe(box.y + (box.h - 24) / 2);
    expect(spy.images[0]?.args[6]).toBe(24);
    expect(spy.images[0]?.args[7]).toBe(24);
    expect(spy.texts[0]?.x).toBe(box.x + 16 + 24 + 8);
  });

  it('图标素材缺失：画占位方块，文字位置不变（布局不塌）', () => {
    const spy = render(toast, box, { text: '已送达', icon: 'icons/missing' });
    expect(spy.images).toHaveLength(0);
    expect(spy.fills).toHaveLength(1); // 占位方块
    expect(spy.fills[0]?.color).toBe(DEFAULT_THEME.gridLine);
    expect(spy.texts[0]?.x).toBe(box.x + 16 + 24 + 8);
  });

  it('空文字：背景照画，不画文字', () => {
    const spy = render(toast, box, {});
    expect(spy.pathFills).toBe(1);
    expect(spy.texts).toHaveLength(0);
  });

  it('颜色可用 props 覆盖（bgColor / textColor）', () => {
    const spy = render(toast, box, { text: '已送达', bgColor: '#112233', textColor: '#ffffff', radius: 0 });
    expect(spy.fills[0]?.color).toBe('#112233');
    expect(spy.texts[0]?.color).toBe('#ffffff');
  });
});

describe('opacity：组件只照画当前值（淡入淡出归游戏 tween）', () => {
  it('opacity=0.5 → globalAlpha 设成 0.5', () => {
    const spy = render(toast, box, { text: '已送达', opacity: 0.5 });
    expect(spy.alphas).toContain(0.5);
  });

  it('opacity=0 → 什么都不画（tween 到 0 不留残影）', () => {
    const spy = render(toast, box, { text: '已送达', opacity: 0 });
    expect(spy.pathFills).toBe(0);
    expect(spy.fills).toHaveLength(0);
    expect(spy.texts).toHaveLength(0);
    expect(spy.saves).toBe(0);
  });

  it('opacity 越界钳制：2 → 1，-1 → 不画', () => {
    expect(render(toast, box, { text: '已送达', opacity: 2 }).alphas).toEqual([1]);
    expect(render(toast, box, { text: '已送达', opacity: -1 }).pathFills).toBe(0);
  });
});

describe('assert', () => {
  it('空文本且无图标 / opacity 越界 / 框太矮 都报中文', () => {
    expect(toast.def.assert?.(box, {})?.join(' ')).toContain('空框');
    expect(toast.def.assert?.(box, { text: 'x', opacity: 1.5 })?.join(' ')).toContain('opacity');
    expect(toast.def.assert?.(makeBox(0, 0, 240, 10), { text: 'x', textSize: 16 })?.join(' ')).toContain('裁切');
    expect(toast.def.assert?.(box, { text: '已送达' })).toEqual([]);
  });
});

describe('toast.ui 校验（离线 ui.check 不接注册表，靠这条守住）', () => {
  const source = (): string => readFileSync(new URL('../../../../../../games/ui-demo/ui/toast.ui', import.meta.url), 'utf8');
  const registry = createWidgetRegistry();
  const parsed = parse(source(), {
    knownComponents: registry.names(),
    componentProps: registry.propKeys(),
    fileName: 'toast.ui',
  });

  it('组件名与参数键全部通过注册表校验', () => {
    expect(parsed.errors).toEqual([]);
    expect([...parsed.components]).toEqual(['toast']);
  });

  it('bindComponents 无错，参数值类型合法（opacity 是数字）', () => {
    const bound = bindComponents(parsed.spec, { registry, env: makeEnv() });
    expect(bound.errors).toEqual([]);
    expect(bound.props.toast).toEqual({ text: '包裹已送达 +12 积分', textSize: 16, icon: 'icons/coin', opacity: 1 });
  });

  it('两视口布局无错，toast 在 overlay 整屏里水平垂直居中', () => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const bound = bindComponents(parsed.spec, { registry, env: makeEnv(viewport.width, viewport.height) });
      const solved = layout(bound.spec, viewport);
      expect(solved.errors, `${viewport.width}×${viewport.height} 布局错误`).toEqual([]);
      const rect = solved.rects.toast;
      if (rect === undefined) throw new Error(`${viewport.width} 下 toast 没有矩形`);
      expect(rect.x).toBe((viewport.width - 220) / 2);
      expect(rect.y).toBe((viewport.height - 44) / 2);
    }
  });
});
