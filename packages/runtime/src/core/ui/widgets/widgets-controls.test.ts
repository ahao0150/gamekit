/**
 * 四个交互型展示组件的绘制测试（T18）：slider / switchToggle / checkbox / radio。
 *
 * 团队硬规则：断言「真实绘制发生过」且断言**具体数值**——
 * 开关开/关时滑块 x 差多少、滑杆填充宽是不是 value×travel、勾的路径画了几个点、
 * 选中时 arc 是不是正好两次。这些都是「看起来对但差几个像素」的常见来源。
 */

import { expect, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_THEME } from '../components';
import { bindComponents } from '../bind';
import { layout } from '../layout';
import { parse } from '../parse';
import { checkbox } from './checkbox';
import { createWidgetRegistry } from './index';
import { radio } from './radio';
import { slider } from './slider';
import { switchToggle } from './switch';
import { expectInside, makeBox, makeEnv, render } from './test-helpers';

describe('slider', () => {
  it('measure：水平 240×40，垂直对调', () => {
    expect(slider.def.measure(makeEnv(), makeBox(0, 0, 240, 40), {})).toEqual({ w: 240, h: 40 });
    expect(slider.def.measure(makeEnv(), makeBox(0, 0, 240, 40), { direction: 'vertical' })).toEqual({ w: 40, h: 240 });
  });

  it('填充宽 = value × (trackW - knobW)：0 / 0.5 / 1 三档', () => {
    const box = makeBox(0, 0, 240, 40);
    const track = { x: 0, y: 16.5, w: 240, h: 7 };
    // knobSize 20 → travel = 220 → 0 / 110 / 220
    for (const [value, expectedWidth, expectedCx] of [
      [0, 0, 10],
      [0.5, 110, 120],
      [1, 220, 230],
    ] as const) {
      const spy = render(slider, box, { value });
      expect(spy.arcs).toHaveLength(1);
      expect(spy.arcs[0]?.[0], `value=${value} 滑块中心 x`).toBe(expectedCx);
      expect(spy.arcs[0]?.[1]).toBe(20); // 垂直居中
      expect(spy.arcs[0]?.[2]).toBe(10); // 半径 = knob / 2
      if (expectedWidth === 0) {
        expect(spy.fills, 'value=0 不画填充').toHaveLength(1);
      } else {
        expect(spy.fills).toHaveLength(2);
        expect(spy.fills[0]?.args).toEqual([track.x, track.y, track.w, track.h]); // 轨道
        expect(spy.fills[1]?.args, `value=${value} 填充宽`).toEqual([0, 16.5, expectedWidth, 7]);
        expectInside(spy.fills[1]!.args, box, 'slider 填充');
      }
    }
  });

  it('value 越界钳制：1.5 → 100%，-0.3 → 0%', () => {
    expect(render(slider, makeBox(0, 0, 240, 40), { value: 1.5 }).fills).toHaveLength(2);
    expect(render(slider, makeBox(0, 0, 240, 40), { value: -0.3 }).fills).toHaveLength(1);
  });

  it('disabled：轨道 / 填充 / 滑块全用主题 disabled 色', () => {
    const spy = render(slider, makeBox(0, 0, 240, 40), { value: 0.5, disabled: true });
    expect(spy.fills[0]?.color).toBe(DEFAULT_THEME.disabled);
    expect(spy.fills[1]?.color).toBe(DEFAULT_THEME.disabled);
    expect(spy.alphas).toHaveLength(0); // 组件不偷偷改透明度（disabled 靠颜色表达）
  });

  it('vertical：从底部往上填充，滑块中心 y 反向', () => {
    const spy = render(slider, makeBox(0, 0, 40, 240), { value: 0.5, direction: 'vertical' });
    // travel = 240 - 20 = 220 → filled 110；滑块中心 y = 240 - 10 - 110 = 120
    expect(spy.arcs[0]?.[1]).toBe(120);
    expect(spy.fills[1]?.args).toEqual([16.5, 240 - 110, 7, 110]);
  });
});

describe('switchToggle（注册名 switch）', () => {
  const box = makeBox(100, 100, 52, 30);

  it('measure：默认 52×30，width/height 可覆盖', () => {
    expect(switchToggle.def.measure(makeEnv(), box, {})).toEqual({ w: 52, h: 30 });
    expect(switchToggle.def.measure(makeEnv(), box, { width: 80, height: 40 })).toEqual({ w: 80, h: 40 });
  });

  it('开 / 关时滑块 x 坐标不同（137 vs 115），半径与纵向中心一致', () => {
    const off = render(switchToggle, box, {});
    const on = render(switchToggle, box, { on: true });
    // pad=3、h=30 → 半径 12；关 cx = 100+3+12 = 115，开 cx = 100+52-3-12 = 137
    expect(off.arcs[0]?.[0]).toBe(115);
    expect(on.arcs[0]?.[0]).toBe(137);
    expect(off.arcs[0]?.[2]).toBe(12);
    expect(on.arcs[0]?.[2]).toBe(12);
    expect(off.arcs[0]?.[1]).toBe(115); // cy 居中
    expect(on.arcs[0]?.[1]).toBe(115);
  });

  it('轨道颜色：开走 trackOnColor（默认 primary），关走 trackOffColor（默认 gridLine）', () => {
    const off = render(switchToggle, box, {});
    const on = render(switchToggle, box, { on: true });
    // 两次 path fill：胶囊轨道 + 滑块圆（都不是 fillRect）
    expect(off.fills).toHaveLength(0);
    expect(off.pathFills).toBe(2);
    expect(on.pathFills).toBe(2);
    expect(off.pathFillColors[0]).toBe(DEFAULT_THEME.gridLine);
    expect(on.pathFillColors[0]).toBe(DEFAULT_THEME.primary);
    expect(off.pathFillColors[1]).toBe(DEFAULT_THEME.light);
    expect(on.pathFillColors[1]).toBe(DEFAULT_THEME.light);
  });

  it('滑块颜色默认主题 light，可覆盖', () => {
    const spy = render(switchToggle, box, { on: true, knobColor: '#abcdef' });
    expect(spy.pathFillColors[1]).toBe('#abcdef');
    expect(spy.arcs).toHaveLength(1);
  });
});

describe('checkbox', () => {
  it('measure：默认 24×24，size 可覆盖', () => {
    expect(checkbox.def.measure(makeEnv(), makeBox(0, 0, 24, 24), {})).toEqual({ w: 24, h: 24 });
    expect(checkbox.def.measure(makeEnv(), makeBox(0, 0, 24, 24), { size: 32 })).toEqual({ w: 32, h: 32 });
  });

  it('未勾选：只画方框，不画勾（无 stroke）', () => {
    const spy = render(checkbox, makeBox(0, 0, 24, 24), {});
    expect(spy.pathFills).toBe(1); // 圆角方框
    expect(spy.pathFillColors[0]).toBe(DEFAULT_THEME.primary);
    expect(spy.strokes).toBe(0); // 圆角框本身走 path，但绝不 stroke —— 只有勾才描边
  });

  it('勾选：在方框路径之外多画 1 个起点 + 2 段线，并描边一次', () => {
    const off = render(checkbox, makeBox(0, 0, 24, 24), {});
    const on = render(checkbox, makeBox(0, 0, 24, 24), { checked: true, checkColor: '#ff0000' });
    expect(on.strokes).toBe(1);
    expect(on.strokeColors).toEqual(['#ff0000']);
    expect(on.beginPaths - off.beginPaths).toBe(1); // 勾自己一次 beginPath
    expect(on.moves - off.moves).toBe(1); // moveTo 起点
    expect(on.lines - off.lines).toBe(2); // 两段线
    expect(on.pathFills).toBe(1); // 方框仍然只填一次
  });

  it('对勾粗细随框大小走：box 非方形时取短边，勾照样画', () => {
    const wide = render(checkbox, makeBox(0, 0, 60, 24), { checked: true });
    const wideOff = render(checkbox, makeBox(0, 0, 60, 24), {});
    expect(wide.strokes).toBe(1);
    expect(wide.moves - wideOff.moves).toBe(1);
    expect(wide.lines - wideOff.lines).toBe(2);
  });
});

describe('radio', () => {
  it('measure：默认 24×24，size 可覆盖', () => {
    expect(radio.def.measure(makeEnv(), makeBox(0, 0, 24, 24), {})).toEqual({ w: 24, h: 24 });
    expect(radio.def.measure(makeEnv(), makeBox(0, 0, 24, 24), { size: 40 })).toEqual({ w: 40, h: 40 });
  });

  it('未选中：只画外圈，arc 一次', () => {
    const spy = render(radio, makeBox(0, 0, 24, 24), {});
    expect(spy.arcs).toHaveLength(1);
    expect(spy.arcs[0]).toEqual([12, 12, 12, 0, Math.PI * 2]);
    expect(spy.pathFills).toBe(1);
  });

  it('选中：外圈 + 内点，arc 两次，内点半径是外圈的 45%', () => {
    const spy = render(radio, makeBox(0, 0, 24, 24), { checked: true, color: '#00ff00' });
    expect(spy.arcs).toHaveLength(2);
    expect(spy.arcs[0]).toEqual([12, 12, 12, 0, Math.PI * 2]);
    expect(spy.arcs[1]).toEqual([12, 12, 5.4, 0, Math.PI * 2]);
    expect(spy.pathFills).toBe(2);
  });
});

describe('controls.ui 校验（离线 ui.check 不接注册表，靠这条守住）', () => {
  const source = (): string => readFileSync(new URL('../../../../../../games/ui-demo/ui/controls.ui', import.meta.url), 'utf8');
  const registry = createWidgetRegistry();
  const parsed = parse(source(), {
    knownComponents: registry.names(),
    componentProps: registry.propKeys(),
    fileName: 'controls.ui',
  });

  it('组件名与参数键全部通过注册表校验', () => {
    expect(parsed.errors).toEqual([]);
    expect([...parsed.components]).toEqual(['label', 'slider', 'switch', 'checkbox', 'radio']);
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
