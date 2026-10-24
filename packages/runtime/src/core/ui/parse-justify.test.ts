/**
 * `.ui` 的 `justify` 解析测试（v0.4）。
 *
 * 独立文件：`parse.test.ts` 已接近 300 行铁律上限；这里只钉 justify 的语法面
 * （取值、缺值、非法值、默认不产出字段），语义在 `layout-justify.test.ts`。
 */

import { describe, expect, it } from 'vitest';
import { JUSTIFY_VALUES } from './grammar';
import { parse } from './parse';

const parseUi = (source: string) => parse(source, { fileName: 'x.ui' });

describe('justify 解析', () => {
  it('四个取值都能落到 stack.justify', () => {
    for (const value of JUSTIFY_VALUES) {
      const ui = parseUi(`region body fill column justify ${value}\nput a size fixed 10`);
      expect(ui.errors, `${value} 解析失败`).toEqual([]);
      expect(ui.spec.regions[0]?.node?.stack?.justify).toBe(value);
    }
  });

  it('不写 justify 时 stack 里没有该字段（默认 start）', () => {
    const ui = parseUi('region body fill column\nput a size fixed 10');
    expect(ui.errors).toEqual([]);
    expect(ui.spec.regions[0]?.node?.stack?.justify).toBeUndefined();
  });

  it('row 方向也能用', () => {
    const ui = parseUi('region bar top 48 row justify space-between\nput a size fixed 10');
    expect(ui.errors).toEqual([]);
    expect(ui.spec.regions[0]?.node?.stack?.direction).toBe('row');
    expect(ui.spec.regions[0]?.node?.stack?.justify).toBe('space-between');
  });

  it('非法取值报中文错误，且列出全部合法值', () => {
    const ui = parseUi('region body fill justify middle');
    expect(ui.errors).toHaveLength(1);
    expect(ui.errors[0]).toContain('x.ui:1:');
    expect(ui.errors[0]).toContain('justify 只能是 start / center / end / space-between');
    expect(ui.errors[0]).toContain('middle');
  });

  it('缺值报中文错误', () => {
    const ui = parseUi('region body fill justify');
    expect(ui.errors).toHaveLength(1);
    expect(ui.errors[0]).toContain('收到');
    expect(ui.errors[0]).toContain('缺值');
  });

  it('justify 与 align / gap / pad 可以任意顺序混写', () => {
    const ui = parseUi('region body fill justify center gap 8 align center pad-x 5%\nput a size fixed 10');
    expect(ui.errors).toEqual([]);
    const stack = ui.spec.regions[0]?.node?.stack;
    expect(stack?.justify).toBe('center');
    expect(stack?.align).toBe('center');
    expect(stack?.gap).toBe(8);
    // pad-x 只给左右；上下为 0
    expect(ui.spec.regions[0]?.padding).toEqual({
      top: 0,
      right: { kind: 'ratio', r: 0.05 },
      bottom: 0,
      left: { kind: 'ratio', r: 0.05 },
    });
  });
});
