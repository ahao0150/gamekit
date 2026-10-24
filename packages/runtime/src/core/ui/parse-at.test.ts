/**
 * `at` 任意位置的解析测试（v0.6）。
 *
 * 钉死五件事：语法能解析、产物形状正确、**base 层用 at 报错**、
 * **at 缺 size 报错**、长度/成对约束的报错文案指到具体位置。
 */
import { describe, expect, it } from 'vitest';
import { parse } from './parse';

const parseUi = (lines: readonly string[]) => parse(lines.join('\n'), { fileName: 'test.ui' });

describe('at / size 语法', () => {
  it('overlay 的 region 可省略 edge，at + size 原样进 spec', () => {
    const ui = parseUi([
      'layer overlay',
      'region tip at 30% 70% size 60% 18%',
      '  put label size fill',
    ]);
    expect(ui.errors).toEqual([]);
    const region = ui.spec.regions[0];
    expect(region?.layer).toBe('overlay');
    expect(region?.edge).toBe('fill');
    expect(region?.at).toEqual({ x: { kind: 'ratio', r: 0.3 }, y: { kind: 'ratio', r: 0.7 } });
    expect(region?.size).toEqual({ w: { kind: 'ratio', r: 0.6 }, h: { kind: 'ratio', r: 0.18 } });
  });

  it('像素写法：at 120 240 size 200 100', () => {
    const ui = parseUi(['layer overlay', 'region tip at 120 240 size 200 100']);
    expect(ui.errors).toEqual([]);
    expect(ui.spec.regions[0]?.at).toEqual({ x: 120, y: 240 });
    expect(ui.spec.regions[0]?.size).toEqual({ w: 200, h: 100 });
  });

  it('overlay 也可以显式写 edge，at 照样生效', () => {
    const ui = parseUi(['layer overlay', 'region tip fill at 30% 70% size 60% 18%']);
    expect(ui.errors).toEqual([]);
    expect(ui.spec.regions[0]?.at).toEqual({ x: { kind: 'ratio', r: 0.3 }, y: { kind: 'ratio', r: 0.7 } });
  });

  it('at / size 与 gap / justify / align 混用不冲突', () => {
    const ui = parseUi([
      'layer overlay',
      'region tip at 30% 70% size 60% 18% gap 4 justify center align center',
      '  put label size fill',
    ]);
    expect(ui.errors).toEqual([]);
    const region = ui.spec.regions[0];
    expect(region?.at).toBeDefined();
    expect(region?.size).toBeDefined();
    const stack = region?.node?.stack;
    expect(stack?.justify).toBe('center');
    expect(stack?.align).toBe('center');
    expect(stack?.gap).toBe(4);
  });
});

describe('at 的约束', () => {
  it('base 层写 at → 明确报错（base 是流布局，位置由流决定）', () => {
    const ui = parseUi(['region box top 48 at 30% 70% size 60% 18%']);
    expect(ui.errors.join('\n')).toContain('只能用在 layer overlay 里');
  });

  it('at 缺 size → 报错（不能靠 measure 猜内容尺寸）', () => {
    const ui = parseUi(['layer overlay', 'region tip at 30% 70%']);
    expect(ui.errors.join('\n')).toContain('必须配 size');
  });

  it('size 单独用（没有 at）→ 报错', () => {
    const ui = parseUi(['layer overlay', 'region tip size 60% 18%']);
    expect(ui.errors.join('\n')).toContain('只能和 at 一起用');
  });

  it('at 只给一个值 → 报错指到 y', () => {
    const ui = parseUi(['layer overlay', 'region tip at 30% size 60% 18%']);
    const text = ui.errors.join('\n');
    expect(text).toContain("region 'tip' 的 at 的 y");
  });

  it('非法长度（200%）→ 报错', () => {
    const ui = parseUi(['layer overlay', 'region tip at 200% 70% size 60% 18%']);
    expect(ui.errors.join('\n')).toContain('百分比必须在 0% 到 100% 之间');
  });

  it('非数字长度 → 报错', () => {
    const ui = parseUi(['layer overlay', 'region tip at abc 70% size 60% 18%']);
    expect(ui.errors.join('\n')).toContain('必须是像素或百分比');
  });

  it('base 层省略 edge → 仍然报错（只有 overlay 允许省）', () => {
    const ui = parseUi(['region box at 30% 70% size 60% 18%']);
    expect(ui.errors.join('\n')).toContain('的边必须是 top / bottom / fill');
  });
});
