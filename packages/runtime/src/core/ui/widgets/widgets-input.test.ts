/**
 * 通用组件 `input` 的契约测试。
 *
 * 判据是「真实绘制发生过」，不是「状态对了」：
 * - 空值必须画出 placeholder，且颜色是主题的 disabled（否则用户看不出这是占位）；
 * - 有值必须画 value，颜色是 light；
 * - `focused` 必须多画一条光标（竖条 fillRect），未聚焦时一条都不许多；
 * - 超长必须截断并补省略号（`fillText` 的 4 参数 maxWidth 只是压缩，不等于截断）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME } from '../components';
import type { Rect } from '../contract';
import type { StyleProps } from '../layout-spec';
import { cursorVisibleAt, fitText, input } from './input';
import { makeBox, render } from './test-helpers';

const BOX = makeBox(20, 100, 280, 48);
const BOX_STYLE = { w: 280, h: 48 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fitText（纯函数：先按码点截、再按宽度截）', () => {
  it('短文本原样返回', () => {
    expect(fitText('你好', 20, 200, 17)).toBe('你好');
  });

  it('maxLength 截断（不是按 UTF-16 长度切）', () => {
    expect(fitText('abcdef', 3, 200, 17)).toBe('abc');
  });

  it('emoji 不被拆成半个代理对', () => {
    // '😀' 是 2 个 UTF-16 code unit、1 个码点；按 slice 切会切出乱码
    expect(fitText('😀😀😀😀', 2, 200, 17)).toBe('😀😀');
  });

  it('maxLength = -1 表示不限制', () => {
    expect(fitText('abcdef', -1, 200, 17)).toBe('abcdef');
  });

  it('maxLength = 0 时一个字符都不留', () => {
    expect(fitText('abcdef', 0, 200, 17)).toBe('');
  });

  it('宽度不够：截断并补省略号，且不超宽', () => {
    const out = fitText('a'.repeat(100), -1, 60, 17);
    expect(out.endsWith('…')).toBe(true);
    expect([...out].length).toBeLessThan(100);
  });

  it('可用宽为 0 / 负数 → 空串（不画出来）', () => {
    expect(fitText('abc', -1, 0, 17)).toBe('');
    expect(fitText('abc', -1, -5, 17)).toBe('');
  });

  it('空文本 → 空串', () => {
    expect(fitText('', 20, 200, 17)).toBe('');
  });
});

describe('cursorVisibleAt（500ms 一亮一灭）', () => {
  it('0~499ms 亮、500~999ms 灭', () => {
    expect(cursorVisibleAt(0)).toBe(true);
    expect(cursorVisibleAt(499)).toBe(true);
    expect(cursorVisibleAt(500)).toBe(false);
    expect(cursorVisibleAt(999)).toBe(false);
    expect(cursorVisibleAt(1000)).toBe(true);
  });
});

describe('input.measure', () => {
  it('高度固定 48，宽度跟随外层给的可用框', () => {
    expect(input.def.measure({ viewport: { width: 390, height: 844 }, data: {} }, makeBox(0, 0, 200, 10), {})).toEqual({
      w: 200,
      h: BOX_STYLE.h,
    });
  });

  it('外层没有宽度（0）→ 回落默认 280', () => {
    expect(input.def.measure({ viewport: { width: 390, height: 844 }, data: {} }, makeBox(0, 0, 0, 0), {})).toEqual({
      w: 280,
      h: 48,
    });
  });
});

describe('input.draw：空值 / 有值', () => {
  it('空值画 placeholder，颜色是主题 disabled', () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const spy = render(input, BOX, { placeholder: '请输入昵称' });
    expect(spy.texts).toHaveLength(1);
    expect(spy.texts[0]?.text).toBe('请输入昵称');
    expect(spy.texts[0]?.color).toBe(DEFAULT_THEME.disabled);
  });

  it('有值画 value，颜色是主题 light（placeholder 不再画）', () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const spy = render(input, BOX, { value: '小明', placeholder: '请输入昵称' });
    expect(spy.texts).toHaveLength(1);
    expect(spy.texts[0]?.text).toBe('小明');
    expect(spy.texts[0]?.color).toBe(DEFAULT_THEME.light);
  });

  it('文字左对齐、垂直居中（x 落在内边距处、y 在框中心）', () => {
    const spy = render(input, BOX, { value: 'x' });
    const text = spy.texts[0];
    expect(text?.x).toBe(BOX.x + 12);
    expect(text?.y).toBe(BOX.y + BOX.h / 2);
  });

  it('超长 value 画出来的是截断后的文本（带省略号）', () => {
    const spy = render(input, BOX, { value: 'a'.repeat(200), maxLength: 200 });
    const drawn = spy.texts[0]?.text ?? '';
    expect(drawn.endsWith('…')).toBe(true);
    expect([...drawn].length).toBeLessThan(200);
  });

  it('value 不是字符串（number / boolean）→ 当空值处理，回落 placeholder，不崩', () => {
    for (const bad of [123, true]) {
      const spy = render(input, BOX, { value: bad, placeholder: '请输入' });
      expect(spy.texts).toHaveLength(1);
      expect(spy.texts[0]?.text).toBe('请输入');
      expect(spy.texts[0]?.color).toBe(DEFAULT_THEME.disabled);
    }
  });

  it('maxLength 截断生效：value 比 maxLength 长时只画前 maxLength 个', () => {
    const spy = render(input, BOX, { value: 'abcdefgh', maxLength: 4 });
    expect(spy.texts[0]?.text).toBe('abcd');
  });
});

describe('input.draw：背景 / 边框 / 裁剪', () => {
  it('先填背景（圆角路径填充，颜色取 bgColor）', () => {
    const spy = render(input, BOX, { bgColor: '#123456' });
    expect(spy.pathFills).toBeGreaterThanOrEqual(1);
    expect(spy.pathFillColors[0]).toBe('#123456');
  });

  it('clip 只一次，save 与 restore 配对（裁到自己的框里）', () => {
    const spy = render(input, BOX, { value: 'x' });
    expect(spy.clips).toBe(1);
    expect(spy.saves).toBe(spy.restores);
  });

  it('未聚焦不描边；聚焦时描边一次且用 primary', () => {
    const normal = render(input, BOX, { value: 'x' });
    expect(normal.strokes).toBe(0);
    const focused = render(input, BOX, { value: 'x', focused: true });
    expect(focused.strokes).toBe(1);
    expect(focused.strokeColors[0]).toBe(DEFAULT_THEME.primary);
  });
});

describe('input.draw：光标', () => {
  it('focused 且闪烁亮：多画一条竖条（fillRect 宽 2、高为框高一半）', () => {
    vi.spyOn(Date, 'now').mockReturnValue(0); // 亮
    const spy = render(input, BOX, { value: 'ab', focused: true });
    const cursor = spy.fills.at(-1);
    expect(cursor?.args[2]).toBe(2);
    expect(cursor?.args[3]).toBe(BOX.h * 0.5);
    expect(cursor?.color).toBe(DEFAULT_THEME.light);
  });

  it('闪烁灭的半周期不画光标', () => {
    vi.spyOn(Date, 'now').mockReturnValue(500); // 灭
    const spy = render(input, BOX, { value: 'ab', focused: true });
    expect(spy.fills).toHaveLength(0);
  });

  it('未聚焦时任何时刻都不画光标', () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const spy = render(input, BOX, { value: 'ab' });
    expect(spy.fills).toHaveLength(0);
  });

  it('光标在文字末尾之后（随文本宽度右移）', () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const short = render(input, BOX, { value: 'a', focused: true });
    const long = render(input, BOX, { value: 'aaaaa', focused: true });
    const xShort = short.fills.at(-1)?.args[0] ?? 0;
    const xLong = long.fills.at(-1)?.args[0] ?? 0;
    expect(xLong).toBeGreaterThan(xShort);
  });

  it('空值 + 聚焦：光标画在 placeholder 起点（和系统输入框一致）', () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const spy = render(input, BOX, { placeholder: '请输入', focused: true });
    const cursor = spy.fills.at(-1);
    expect(cursor?.args[0]).toBe(BOX.x + 12 + 1);
  });
});

describe('input.draw：非法尺寸', () => {
  it('宽或高为 0 时什么都不画（也不崩）', () => {
    const zeroW = render(input, makeBox(0, 0, 0, 48), { value: 'x' });
    expect(zeroW.texts).toHaveLength(0);
    expect(zeroW.clips).toBe(0);
    const zeroH = render(input, makeBox(0, 0, 280, 0), { value: 'x' });
    expect(zeroH.texts).toHaveLength(0);
  });

  it('NaN 尺寸不产出非有限坐标', () => {
    const spy = render(input, makeBox(0, 0, Number.NaN, 48), { value: 'x' });
    expect(spy.texts).toHaveLength(0);
  });
});

describe('input.assert', () => {
  const assertOf = (props: StyleProps, box: Rect = BOX): readonly string[] =>
    input.def.assert?.(box, props) ?? [];

  it('合法输入没有问题', () => {
    expect(assertOf({ maxLength: 20 })).toEqual([]);
  });

  it('maxLength <= 0 报出来（会让输入框永远为空）', () => {
    expect(assertOf({ maxLength: 0 }).length).toBeGreaterThan(0);
    expect(assertOf({ maxLength: -3 }).length).toBeGreaterThan(0);
  });

  it('radius 为负、高度过小都报出来', () => {
    expect(assertOf({ radius: -1 }).length).toBe(1);
    expect(assertOf({}, makeBox(0, 0, 280, 20)).length).toBeGreaterThan(0);
  });
});
