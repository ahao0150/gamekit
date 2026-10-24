/**
 * `scrollbar` 组件测试（T20）：滑块长与位置断**具体数值**。
 *
 * 圆角块走 path fill，没有 `fillRect` 那样的几何参数，所以用测试辅助的 `fillBounds`
 * （每次 fill 时路径顶点的包围盒）反推矩形 —— 断言的是「真的画在哪」，不是「算出来的数」。
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bindComponents } from '../bind';
import { layout } from '../layout';
import { parse } from '../parse';
import { DEFAULT_THEME } from '../components';
import { createWidgetRegistry } from './index';
import { scrollbar } from './scrollbar';
import { makeBox, makeEnv, render } from './test-helpers';

/** 竖条：宽 40、高 300，厚度 4 → 轨道贴右侧（x=36）。 */
const vBox = makeBox(0, 0, 40, 300);
/** 内容 4 屏 → viewport 0.25 → 滑块长 = 300 × 0.25 = 75，可走 225。 */
const vProps = { viewport: 0.25 } as const;

describe('measure', () => {
  it('竖：宽 = thickness、高 = 可用高；横：对调', () => {
    expect(scrollbar.def.measure(makeEnv(), vBox, { thickness: 4 })).toEqual({ w: 4, h: 300 });
    expect(scrollbar.def.measure(makeEnv(), makeBox(0, 0, 300, 40), { direction: 'horizontal', thickness: 6 })).toEqual({
      w: 300,
      h: 6,
    });
  });
});

describe('竖条：轨道贴右，滑块长 = 轨道长 × viewport', () => {
  it('滑块长 75（300 × 0.25），value=0 时贴顶', () => {
    const spy = render(scrollbar, vBox, { ...vProps, value: 0 });
    expect(spy.pathFills).toBe(2); // 轨道 + 滑块
    expect(spy.fillBounds[0]).toEqual({ x: 36, y: 0, w: 4, h: 300 }); // 轨道贴右
    expect(spy.fillBounds[1]).toEqual({ x: 36, y: 0, w: 4, h: 75 }); // 滑块长 = 300/4
    expect(spy.saves).toBe(1);
    expect(spy.restores).toBe(1);
  });

  it('value = 0 / 0.5 / 1 三个位置：0 / 112.5 / 225（= value ×（300-75））', () => {
    for (const [value, expectedY] of [
      [0, 0],
      [0.5, 112.5],
      [1, 225],
    ] as const) {
      const spy = render(scrollbar, vBox, { ...vProps, value });
      expect(spy.fillBounds[1]?.y, `value=${value}`).toBe(expectedY);
      expect(spy.fillBounds[1]?.h).toBe(75); // 长度不随位置变
      expect(spy.fillBounds[1]?.x).toBe(36);
    }
  });

  it('轨道与滑块颜色默认走主题，可覆盖', () => {
    const spy = render(scrollbar, vBox, { ...vProps, value: 0.5 });
    expect(spy.pathFillColors).toEqual([DEFAULT_THEME.gridLine, DEFAULT_THEME.primary]);
    const custom = render(scrollbar, vBox, { ...vProps, value: 0.5, trackColor: '#111111', thumbColor: '#222222' });
    expect(custom.pathFillColors).toEqual(['#111111', '#222222']);
  });
});

describe('横条：轨道贴底', () => {
  const hBox = makeBox(0, 0, 300, 40);

  it('轨道 y=36、高 4；滑块三个位置 0 / 112.5 / 225，长 75', () => {
    const first = render(scrollbar, hBox, { direction: 'horizontal', viewport: 0.25, value: 0 });
    expect(first.fillBounds[0]).toEqual({ x: 0, y: 36, w: 300, h: 4 });
    expect(first.fillBounds[1]).toEqual({ x: 0, y: 36, w: 75, h: 4 });
    for (const [value, expectedX] of [
      [0, 0],
      [0.5, 112.5],
      [1, 225],
    ] as const) {
      const spy = render(scrollbar, hBox, { direction: 'horizontal', viewport: 0.25, value });
      expect(spy.fillBounds[1]?.x, `value=${value}`).toBe(expectedX);
    }
  });
});

describe('不画的几种情况', () => {
  it('viewport >= 1（内容装得下）→ 零绘制', () => {
    expect(render(scrollbar, vBox, { viewport: 1, value: 0.5 }).pathFills).toBe(0);
    expect(render(scrollbar, vBox, { viewport: 1.5, value: 0.5 }).pathFills).toBe(0);
  });

  it('viewport = 0 / 非法 → 零绘制；opacity = 0 → 零绘制', () => {
    expect(render(scrollbar, vBox, { viewport: 0, value: 0.5 }).pathFills).toBe(0);
    expect(render(scrollbar, vBox, { ...vProps, opacity: 0 }).pathFills).toBe(0);
  });

  it('opacity = 0.5 → globalAlpha 设成 0.5（淡出由游戏 tween）', () => {
    expect(render(scrollbar, vBox, { ...vProps, opacity: 0.5 }).alphas).toEqual([0.5]);
  });

  it('value 越界钳制：1.5 → 贴底、-1 → 贴顶', () => {
    expect(render(scrollbar, vBox, { ...vProps, value: 1.5 }).fillBounds[1]?.y).toBe(225);
    expect(render(scrollbar, vBox, { ...vProps, value: -1 }).fillBounds[1]?.y).toBe(0);
  });
});

describe('scrollbar.ui 校验（离线 ui.check 不接注册表，靠这条守住）', () => {
  // T31：原 `scroll.ui`（列表 + 滚动条示例）改名为 `scrollbar.ui`，
  // `scroll.ui` 让给了通用滑动容器。
  const source = (): string => readFileSync(new URL('../../../../../../games/ui-demo/ui/scrollbar.ui', import.meta.url), 'utf8');
  const registry = createWidgetRegistry();
  const parsed = parse(source(), {
    knownComponents: registry.names(),
    componentProps: registry.propKeys(),
    fileName: 'scrollbar.ui',
  });

  it('组件名与参数键全部通过注册表校验', () => {
    expect(parsed.errors).toEqual([]);
    expect([...parsed.components]).toEqual(['label', 'list', 'scrollbar']);
  });

  it('bindComponents 无错，两视口布局无错且矩形在视口内', () => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const bound = bindComponents(parsed.spec, { registry, env: makeEnv(viewport.width, viewport.height) });
      expect(bound.errors, `${viewport.width} 绑定错误`).toEqual([]);
      const solved = layout(bound.spec, viewport);
      expect(solved.errors, `${viewport.width}×${viewport.height} 布局错误`).toEqual([]);
      for (const name of parsed.components) {
        const rect = solved.rects[name];
        if (rect === undefined) throw new Error(`${viewport.width} 下 ${name} 没有矩形`);
        expect(rect.w, `${name} 宽`).toBeGreaterThan(0);
        expect(rect.h, `${name} 高`).toBeGreaterThan(0);
      }
    }
  });
});
