import { expect, it } from 'vitest';
import { createLayoutEngine } from './layout';
import { WIDGET_COMPONENTS } from './deps';
import { INITIAL_STATE, SCORE_GOAL } from './state';

const engine = createLayoutEngine();
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
];

it('两视口：绑定无错、布局无溢出、组件齐全且都在视口内', () => {
  for (const viewport of VIEWPORTS) {
    const tag = `${viewport.width}×${viewport.height}`;
    const view = engine.compute('home', viewport, INITIAL_STATE);
    expect(view.errors, `${tag} 有布局错误`).toEqual([]);
    const names = Object.keys(view.components);
    expect(names.length, `${tag} 没有组件`).toBeGreaterThan(0);
    for (const name of names) {
      const rect = view.rects[name];
      expect(rect, `${tag} 组件 ${name} 缺矩形`).toBeDefined();
      if (rect === undefined) continue;
      expect(rect.w, `${tag} ${name} 宽`).toBeGreaterThan(0);
      expect(rect.h, `${tag} ${name} 高`).toBeGreaterThan(0);
      expect(rect.x, `${tag} ${name} 左越界`).toBeGreaterThanOrEqual(0);
      expect(rect.y, `${tag} ${name} 上越界`).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w, `${tag} ${name} 右越界`).toBeLessThanOrEqual(viewport.width + 0.01);
      expect(rect.y + rect.h, `${tag} ${name} 下越界`).toBeLessThanOrEqual(viewport.height + 0.01);
    }
  }
});

it('paintOrder 与 rects / meta 一一对应（绘制序 = 命中序的来源）', () => {
  const view = engine.compute('home', VIEWPORTS[0]!, INITIAL_STATE);
  for (const name of view.paintOrder) {
    expect(view.rects[name], `${name} 在 paintOrder 里但没有矩形`).toBeDefined();
    expect(view.meta[name], `${name} 缺 meta`).toBeDefined();
  }
  expect(Object.keys(view.meta).sort()).toEqual([...view.paintOrder].sort());
  // base 的按钮、overlay 的标题与提示
  expect(view.meta['button']).toMatchObject({ layer: 'base', hit: 'self' });
  expect(view.meta['label']).toMatchObject({ layer: 'overlay' });
});

it('分数变化反映到 progress.value（动态 props）', () => {
  const scored = { ...INITIAL_STATE, score: 4, hint: '+1 分（当前 4）' };
  const view = engine.compute('home', VIEWPORTS[0]!, scored);
  expect(view.props['progress']).toMatchObject({ value: 4, max: SCORE_GOAL });
  expect(view.props['toast']).toMatchObject({ text: '+1 分（当前 4）' });
});

it('默认注册表与通用组件源一致，不混入旧业务件', () => {
  expect([...engine.registry.names()].sort()).toEqual(WIDGET_COMPONENTS.map(component => component.name).sort());
  expect(engine.registry.has('statusText')).toBe(false);
  for (const name of ['button', 'panel', 'label', 'progress', 'toast', 'grid', 'scroll', 'input']) {
    expect(engine.registry.has(name), `缺组件 ${name}`).toBe(true);
  }
});
