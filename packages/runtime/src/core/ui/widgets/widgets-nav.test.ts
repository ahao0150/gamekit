/**
 * T19 数据驱动容器组件的测试：tabs / segmented / keypad + keypadHit 命中纯函数。
 *
 * 这几个组件的「数据」不在 props 里（StyleProps 装不了数组），而是从 `deps.data` 拿，
 * 所以测试里用 `{ ...makeDeps(), data }` 注入。绘制断言仍然要具体数值：
 * 指示条 x / 高亮块 x / 键位 x 间距，以及命中函数的四角、间隙、空位。
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bindComponents } from '../bind';
import { layout } from '../layout';
import { parse } from '../parse';
import type { DrawDeps } from '../components';
import { createWidgetRegistry } from './index';
import { keypad } from './keypad';
import { keypadHit, keypadMetrics } from './keypad-hit';
import { segmented } from './segmented';
import { tabs } from './tabs';
import { makeBox, makeDeps, makeEnv, render, spyCtx } from './test-helpers';

/** 带游戏数据的依赖。 */
const withData = (data: Record<string, unknown>): DrawDeps => ({ ...makeDeps(), data });

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'] as const;

describe('tabs', () => {
  it('measure：高度跟 itemH 走，宽度回显可用宽', () => {
    expect(tabs.def.measure(makeEnv(), makeBox(0, 0, 390, 40), {})).toEqual({ w: 390, h: 40 });
    expect(tabs.def.measure(makeEnv(), makeBox(0, 0, 390, 40), { itemH: 56 })).toEqual({ w: 390, h: 56 });
  });

  it('指示条 x 随 active 变：3 个标签等分 390 → 0 / 130 / 260，宽 = 标签宽', () => {
    const box = makeBox(0, 0, 390, 40);
    for (const [active, expectedX] of [
      [0, 0],
      [1, 130],
      [2, 260],
    ] as const) {
      const spy = render(tabs, box, { active }, withData({ tabs: ['包裹', '路线', '我的'] }));
      expect(spy.fills, `active=${active} 指示条`).toHaveLength(1);
      expect(spy.fills[0]?.args).toEqual([expectedX, 37, 130, 3]);
      expect(spy.texts).toHaveLength(3);
      expect(spy.texts[active]?.x).toBe(expectedX + 65); // 文字在标签中心
      expect(spy.texts[active]?.y).toBe(20);
    }
  });

  it('选中文字用 activeColor，其余用 color', () => {
    const spy = render(tabs, makeBox(0, 0, 300, 40), { active: 1, activeColor: '#ff0000', color: '#00ff00' }, withData({ tabs: ['A', 'B', 'C'] }));
    expect(spy.texts[1]?.color).toBe('#ff0000');
    expect(spy.texts[0]?.color).toBe('#00ff00');
    expect(spy.texts[2]?.color).toBe('#00ff00');
  });

  it('active 越界回落 0；没有数据时什么都不画', () => {
    const box = makeBox(0, 0, 390, 40);
    expect(render(tabs, box, { active: 99 }, withData({ tabs: ['A', 'B'] })).fills[0]?.args[0]).toBe(0);
    expect(render(tabs, box, { active: -3 }, withData({ tabs: ['A', 'B'] })).fills[0]?.args[0]).toBe(0);
    const empty = render(tabs, box, {}, withData({ tabs: [] }));
    expect(empty.fills).toHaveLength(0);
    expect(empty.texts).toHaveLength(0);
  });
});

describe('segmented', () => {
  it('measure：高度跟 itemH 走', () => {
    expect(segmented.def.measure(makeEnv(), makeBox(0, 0, 300, 32), {})).toEqual({ w: 300, h: 32 });
  });

  it('高亮块 x 随 active 变：300 宽 3 段 → 起点 6 / 106 / 206', () => {
    const box = makeBox(0, 0, 300, 32);
    for (const [active, expectedStartX] of [
      [0, 6],
      [1, 106],
      [2, 206],
    ] as const) {
      const spy = render(segmented, box, { active }, withData({ segments: ['日', '周', '月'] }));
      // pathStarts[0] = 底板起点、[1] = 高亮块起点（圆角路径的起点是 x+radius）
      expect(spy.pathFills, `active=${active}`).toBe(2);
      expect(spy.pathStarts).toHaveLength(2);
      expect(spy.pathStarts[1]?.[0], `active=${active} 高亮块 x`).toBe(expectedStartX);
      expect(spy.texts).toHaveLength(3);
    }
  });

  it('active 越界钳到 0（高亮块回到第一段）', () => {
    const box = makeBox(0, 0, 300, 32);
    for (const active of [-1, 99, Number.NaN]) {
      const spy = render(segmented, box, { active }, withData({ segments: ['日', '周', '月'] }));
      expect(spy.pathStarts[1]?.[0], `active=${String(active)}`).toBe(6);
    }
  });

  it('没有数据时什么都不画', () => {
    const spy = render(segmented, makeBox(0, 0, 300, 32), {}, withData({ segments: [] }));
    expect(spy.pathFills).toBe(0);
    expect(spy.texts).toHaveLength(0);
  });
});

describe('keypad', () => {
  const box = makeBox(0, 0, 300, 226); // 3 列 × 4 行：4×52 + 3×6 = 226

  it('measure：按 cols 算行高（12 键 → 226）', () => {
    const env = { viewport: { width: 390, height: 844 }, data: { keys: KEYS } };
    expect(keypad.def.measure(env, box, {})).toEqual({ w: 300, h: 226 });
    expect(keypad.def.measure(env, box, { keyH: 40, gap: 0 })).toEqual({ w: 300, h: 160 });
  });

  it('12 个键画 12 次背景 + 12 次文字，键高 52、宽 96', () => {
    const spy = render(keypad, box, {}, withData({ keys: KEYS }));
    expect(spy.pathFills).toBe(12);
    expect(spy.texts).toHaveLength(12);
    expect(spy.texts[0]?.text).toBe('1');
    expect(spy.texts[11]?.text).toBe('ok');
    const m = keypadMetrics(box, { cols: 3, keyH: 52, gap: 6, keys: KEYS });
    expect(m.keyW).toBe(96);
    expect(m.rows).toBe(4);
  });

  it('cols=3 时第 0/1/2 个键 x 逐差一格宽 + gap', () => {
    const spy = render(keypad, box, {}, withData({ keys: KEYS }));
    // pathStarts[i] = 第 i 格左上角 + radius(6)
    expect(spy.pathStarts[0]?.[0]).toBe(6);
    expect(spy.pathStarts[1]?.[0]).toBe(6 + 96 + 6); // 108
    expect(spy.pathStarts[2]?.[0]).toBe(6 + 2 * (96 + 6)); // 210
  });

  it('gap 生效：第 2 个键 x = 第 0 个 + 2×(格宽+gap)，行间距同样生效', () => {
    const spy = render(keypad, box, {}, withData({ keys: KEYS }));
    const first = spy.pathStarts[0]?.[0] ?? 0;
    const third = spy.pathStarts[2]?.[0] ?? 0;
    expect(third - first).toBe(2 * (96 + 6));
    // 第 4 个键换行：y = 0 + keyH + gap = 58（roundPath 的起点是 (x+radius, y)，y 不加半径）
    expect(spy.pathStarts[3]?.[1]).toBe(58);
  });

  it('没有数据 / cols 非法时不崩', () => {
    expect(render(keypad, box, {}, withData({ keys: [] })).pathFills).toBe(0);
    expect(() => render(keypad, box, { cols: 0 }, withData({ keys: KEYS }))).not.toThrow();
  });
});

describe('keypadHit', () => {
  const box = makeBox(0, 0, 300, 226);
  const opts = { cols: 3, keyH: 52, gap: 6, keys: KEYS };

  it('四角：左上第一格、第一行第三格右下、最后一行右下是 ok', () => {
    expect(keypadHit(box, opts, { x: 0, y: 0 })).toEqual({ index: 0, key: '1' });
    expect(keypadHit(box, opts, { x: 299, y: 51 })).toEqual({ index: 2, key: '3' });
    expect(keypadHit(box, opts, { x: 0, y: 225 })).toEqual({ index: 9, key: 'del' });
    expect(keypadHit(box, opts, { x: 299, y: 225 })).toEqual({ index: 11, key: 'ok' });
  });

  it('点在列间隙 / 行间隙里返回 null', () => {
    // 第一格右边 96，第二格起点 102：x=100 落在间隙
    expect(keypadHit(box, opts, { x: 100, y: 20 })).toBeNull();
    // 第一行底 52，第二行起 58：y=55 落在行间隙
    expect(keypadHit(box, opts, { x: 20, y: 55 })).toBeNull();
  });

  it('最后一行不满时的空位不命中（10 键 3 列，第 11 格位置返回 null）', () => {
    const ten = { ...opts, keys: KEYS.slice(0, 10) };
    // 第 4 行第 2 格（index 10）没有键
    expect(keypadHit(box, ten, { x: 102 + 10, y: 174 + 10 })).toBeNull();
    // 第 4 行第 1 格（index 9）是最后一个键
    expect(keypadHit(box, ten, { x: 10, y: 174 + 10 })).toEqual({ index: 9, key: 'del' });
  });

  it('点在 box 外 / NaN 坐标返回 null', () => {
    expect(keypadHit(box, opts, { x: 300, y: 10 })).toBeNull();
    expect(keypadHit(box, opts, { x: 10, y: 226 })).toBeNull();
    expect(keypadHit(box, opts, { x: -1, y: 10 })).toBeNull();
    expect(keypadHit(box, opts, { x: Number.NaN, y: 10 })).toBeNull();
  });

  it('命中格子与绘制格子用同一套几何（左上角对齐）', () => {
    const spy = spyCtx();
    keypad.def.draw(spy.ctx, box, {}, { ...makeDeps(), data: { keys: KEYS } });
    for (const index of [0, 4, 7, 11]) {
      const start = spy.pathStarts[index];
      if (start === undefined) throw new Error(`第 ${index} 格没画`);
      // roundPath 的起点是 (x + radius, y)：x 要减半径，y 不减
      const cellX = (start[0] ?? 0) - 6;
      const cellY = start[1] ?? 0;
      expect(keypadHit(box, opts, { x: cellX + 1, y: cellY + 1 })?.index, `第 ${index} 格左上`).toBe(index);
    }
  });
});

describe('nav.ui 校验（离线 ui.check 不接注册表，靠这条守住）', () => {
  const source = (): string => readFileSync(new URL('../../../../../../games/ui-demo/ui/nav.ui', import.meta.url), 'utf8');
  const registry = createWidgetRegistry();
  const parsed = parse(source(), {
    knownComponents: registry.names(),
    componentProps: registry.propKeys(),
    fileName: 'nav.ui',
  });

  it('组件名与参数键全部通过注册表校验', () => {
    expect(parsed.errors).toEqual([]);
    expect([...parsed.components]).toEqual(['label', 'tabs', 'segmented', 'keypad']);
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
