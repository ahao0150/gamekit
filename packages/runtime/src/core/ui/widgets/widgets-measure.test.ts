/**
 * T15 measure / 注册表 / widgets.ui 校验测试。
 *
 * 最后一条是重点：离线 `mg.ui.check` **不接组件注册表**，所以「widgets.ui 里的组件名
 * 真的在注册表里、参数键真的合法」只能靠 `parse(knownComponents/componentProps)`
 * + `bindComponents` 这条测试守住（文档体检发现的第 7 条缺口）。
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bindComponents } from '../bind';
import { layout } from '../layout';
import { parse } from '../parse';
import { avatar } from './avatar';
import { badge } from './badge';
import { button } from './button';
import { divider } from './divider';
import { icon } from './icon';
import { label } from './label';
import { panel } from './panel';
import { progress } from './progress';
import { WIDGET_COMPONENTS, createWidgetRegistry } from './index';
import { makeBox, makeEnv } from './test-helpers';

const widgetsUiSource = (): string =>
  readFileSync(new URL('../../../../../../games/ui-demo/ui/widgets.ui', import.meta.url), 'utf8');

const at = makeBox(0, 0, 120, 24);

describe('measure：默认尺寸与 props 覆盖', () => {
  it('progress：水平 180×12，vertical 对调', () => {
    expect(progress.def.measure(makeEnv(), at, {})).toEqual({ w: 180, h: 12 });
    expect(progress.def.measure(makeEnv(), at, { direction: 'vertical' })).toEqual({ w: 12, h: 120 });
  });

  it('button / panel / avatar：固定默认尺寸（296×56 / 320×200 / 64×64）', () => {
    expect(button.def.measure(makeEnv(), at, {})).toEqual({ w: 296, h: 56 });
    expect(panel.def.measure(makeEnv(), at, {})).toEqual({ w: 320, h: 200 });
    expect(avatar.def.measure(makeEnv(), at, {})).toEqual({ w: 64, h: 64 });
  });

  it('label：按字号估算文字宽，maxWidth 截断', () => {
    const two = label.def.measure(makeEnv(), at, { text: '通用', fontSize: 16 });
    expect(two.w).toBe(32); // 两个 CJK × 16
    expect(two.h).toBe(20); // 16 × 1.2
    expect(label.def.measure(makeEnv(), at, { text: '通用组件库', fontSize: 16, maxWidth: 20 }).w).toBe(20);
  });

  it('icon：默认 32，size 覆盖', () => {
    expect(icon.def.measure(makeEnv(), at, {})).toEqual({ w: 32, h: 32 });
    expect(icon.def.measure(makeEnv(), at, { size: 48 })).toEqual({ w: 48, h: 48 });
  });

  it('badge：空 text 是圆点尺寸，有 text 按文字加宽', () => {
    expect(badge.def.measure(makeEnv(), at, { dotSize: 10 })).toEqual({ w: 10, h: 10 });
    const text = badge.def.measure(makeEnv(), at, { text: '9', dotSize: 10 });
    expect(text.w).toBeGreaterThan(10);
    expect(text.h).toBeGreaterThanOrEqual(10);
  });

  it('divider：水平 200×1，垂直对调且厚度生效', () => {
    expect(divider.def.measure(makeEnv(), at, {})).toEqual({ w: 200, h: 1 });
    expect(divider.def.measure(makeEnv(), at, { direction: 'vertical', thickness: 2 })).toEqual({ w: 2, h: 200 });
  });
});

describe('注册表', () => {
  it('createWidgetRegistry 装好 22 个组件，顺序与 WIDGET_COMPONENTS 一致', () => {
    const registry = createWidgetRegistry();
    expect(registry.names()).toEqual([
      'progress',
      'button',
      'panel',
      'label',
      'icon',
      'badge',
      'divider',
      'avatar',
      'list',
      'input',
      'toast',
      'slider',
      'switch',
      'checkbox',
      'radio',
      'tabs',
      'segmented',
      'keypad',
      'scrollbar',
      'carousel',
      'grid',
      'scroll',
    ]);
    expect(WIDGET_COMPONENTS.map((comp) => comp.name)).toEqual(registry.names());
  });

  it('每个组件都有 props 声明、measure、draw、assert 与默认尺寸', () => {
    for (const comp of WIDGET_COMPONENTS) {
      expect(Object.keys(comp.def.props ?? {}).length, `${comp.name} 没有 props 声明`).toBeGreaterThan(0);
      expect(comp.def.measure, `${comp.name} 缺 measure`).toBeTypeOf('function');
      expect(comp.def.draw, `${comp.name} 缺 draw`).toBeTypeOf('function');
      expect(comp.def.assert, `${comp.name} 缺 assert`).toBeTypeOf('function');
      expect(comp.def.defaultSize, `${comp.name} 缺 defaultSize`).toBeDefined();
    }
  });
});

describe('widgets.ui 校验（离线 ui.check 不接注册表，靠这条守住）', () => {
  const registry = createWidgetRegistry();
  const parsed = parse(widgetsUiSource(), {
    knownComponents: registry.names(),
    componentProps: registry.propKeys(),
    fileName: 'widgets.ui',
  });

  it('组件名与参数键全部通过注册表校验', () => {
    expect(parsed.errors).toEqual([]);
    // widgets.ui 用 P0 的八个通用件（list 在 list.ui 里，见 widgets-list.test.ts）
    expect([...parsed.components].sort()).toEqual([
      'avatar',
      'badge',
      'button',
      'divider',
      'icon',
      'label',
      'panel',
      'progress',
    ]);
  });

  it('bindComponents 无错，widgets.ui 里的组件都拿到定义', () => {
    const bound = bindComponents(parsed.spec, { registry, env: makeEnv() });
    expect(bound.errors).toEqual([]);
    for (const name of parsed.components) expect(bound.components[name], `${name} 没绑上`).toBeDefined();
  });

  it('两视口布局无错、矩形都在视口内且尺寸 > 0', () => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const bound = bindComponents(parsed.spec, { registry, env: makeEnv(viewport.width, viewport.height) });
      const solved = layout(bound.spec, viewport);
      expect(solved.errors, `${viewport.width}×${viewport.height} 布局错误`).toEqual([]);
      for (const [name, rect] of Object.entries(solved.rects)) {
        const tag = `${name}@${viewport.width}`;
        expect(rect.w, `${tag} 宽`).toBeGreaterThan(0);
        expect(rect.h, `${tag} 高`).toBeGreaterThan(0);
        expect(rect.x, `${tag} 左越界`).toBeGreaterThanOrEqual(0);
        expect(rect.y, `${tag} 上越界`).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w, `${tag} 右越界`).toBeLessThanOrEqual(viewport.width + 0.01);
        expect(rect.y + rect.h, `${tag} 下越界`).toBeLessThanOrEqual(viewport.height + 0.01);
      }
    }
  });
});
