/**
 * `.ui` v0.5 的 `layer` 分段行与 `put hit` 解析测试。
 *
 * 语义在 `layout-layer.test.ts`；这里只钉语法面（层切换、默认零变化、非法值）。
 */

import { describe, expect, it } from 'vitest';
import { parse } from './parse';

const parseUi = (source: string) => parse(source, { fileName: 'x.ui' });

describe('layer 分段行', () => {
  it('不写 layer 时 region 没有 layer 字段（默认 base，零变化）', () => {
    const ui = parseUi('region body fill\nput a size fixed 10');
    expect(ui.errors).toEqual([]);
    expect(ui.spec.regions[0]?.layer).toBeUndefined();
  });

  it('layer overlay 之后的 region 带 layer，layer base 切回', () => {
    const ui = parseUi(
      [
        'layer overlay',
        'region mask fill',
        'put a size fill',
        'layer base',
        'region body fill',
        'put b size fixed 10',
      ].join('\n'),
    );
    expect(ui.errors).toEqual([]);
    expect(ui.spec.regions[0]?.layer).toBe('overlay');
    expect(ui.spec.regions[1]?.layer).toBeUndefined();
  });

  it('多个 overlay region 可以连续写', () => {
    const ui = parseUi(
      ['layer overlay', 'region mask fill', 'put a size fill', 'region dialog fill', 'put b size fixed 10'].join('\n'),
    );
    expect(ui.errors).toEqual([]);
    expect(ui.spec.regions.map((region) => region.layer)).toEqual(['overlay', 'overlay']);
  });

  it('显式 layer base 不产出 layer 字段（与不写逐值等价）', () => {
    const withBase = parseUi('layer base\nregion body fill\nput a size fixed 10');
    const without = parseUi('region body fill\nput a size fixed 10');
    expect(withBase.errors).toEqual([]);
    expect(withBase.spec).toEqual(without.spec);
  });

  it('非法层名 / 缺值都报中文错误', () => {
    const bad = parseUi('layer backdrop\nregion body fill');
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]).toContain('x.ui:1:');
    expect(bad.errors[0]).toContain('layer 只能是 base / overlay');
    expect(bad.errors[0]).toContain('backdrop');

    const missing = parseUi('layer');
    expect(missing.errors[0]).toContain('收到');
    expect(missing.errors[0]).toContain('缺值');
  });
});

describe('put hit 修饰词', () => {
  it('三个取值都落到 NodeSpec.hit', () => {
    for (const hit of ['self', 'block', 'none']) {
      const ui = parseUi(`region body fill\nput a size fill hit ${hit}`);
      expect(ui.errors, `${hit} 解析失败`).toEqual([]);
      expect(ui.spec.regions[0]?.node?.stack?.children[0]?.hit).toBe(hit);
    }
  });

  it('不写 hit 时 NodeSpec 没有该字段（默认 self）', () => {
    const ui = parseUi('region body fill\nput a size fill');
    expect(ui.errors).toEqual([]);
    expect(ui.spec.regions[0]?.node?.stack?.children[0]?.hit).toBeUndefined();
  });

  it('非法 hit 值报中文错误并列出全部取值', () => {
    const ui = parseUi('region body fill\nput a size fill hit swallow');
    expect(ui.errors).toHaveLength(1);
    expect(ui.errors[0]).toContain('hit 只能是 self / block / none');
    expect(ui.errors[0]).toContain('swallow');
  });

  it('hit 与 size / cross / align / style / justify 可以任意顺序混写', () => {
    const ui = parseUi(
      'layer overlay\nregion dialog fill column justify center align center\nput a size 34% cross 80% align center hit block style label="确认"',
    );
    expect(ui.errors).toEqual([]);
    const node = ui.spec.regions[0]?.node?.stack?.children[0];
    expect(node?.hit).toBe('block');
    expect(node?.size).toEqual({ kind: 'ratio', r: 0.34 });
    expect(node?.cross).toEqual({ kind: 'ratio', r: 0.8 });
    expect(ui.spec.regions[0]?.layer).toBe('overlay');
    expect(ui.spec.regions[0]?.node?.stack?.justify).toBe('center');
  });
});
