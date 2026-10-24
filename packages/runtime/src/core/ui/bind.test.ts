import { expect, it } from 'vitest';
import { assertComponents, bindComponents } from './bind';
import { createBuiltinRegistry } from './builtin';
import { createComponentRegistry } from './components';
import { layout } from './layout';
import type { LayoutSpec, NodeSpec } from './layout';

const registry = createBuiltinRegistry();
const VIEW_390 = { width: 390, height: 844 };
const VIEW_320 = { width: 320, height: 568 };

/** 一条 fill 带，里面按 column 排若干组件。 */
const columnSpec = (children: readonly NodeSpec[]): LayoutSpec => ({
  regions: [
    {
      name: 'body',
      edge: 'fill',
      node: { stack: { direction: 'column', align: 'center', children } },
    },
  ],
});

/** 最小的真实 spec：fill 带 → column → parcelGrid(auto) + cross 0.84。 */
const gridSpec = (): LayoutSpec =>
  columnSpec([{ name: 'parcelGrid', size: { kind: 'auto' }, cross: { kind: 'ratio', r: 0.84 } }]);

it('绑定后 parcelGrid 有真实 measure：390×844 = 327.6×218.4，320×568 ≈ 268.8×179.2', () => {
  const bound390 = bindComponents(gridSpec(), { registry, env: { viewport: VIEW_390, data: { cols: 3, rows: 2 } } });
  expect(bound390.errors).toEqual([]);
  expect(bound390.components['parcelGrid']).toBe(registry.get('parcelGrid'));
  const rect390 = layout(bound390.spec, VIEW_390).rects['parcelGrid'];
  expect(rect390?.w).toBeCloseTo(327.6, 6);
  expect(rect390?.h).toBeCloseTo(218.4, 6);

  const bound320 = bindComponents(gridSpec(), { registry, env: { viewport: VIEW_320, data: { cols: 3, rows: 2 } } });
  const rect320 = layout(bound320.spec, VIEW_320).rects['parcelGrid'];
  expect(rect320?.w).toBeCloseTo(268.8, 6);
  expect(rect320?.h).toBeCloseTo(179.2, 6);
});

it('未注册组件：进 errors（列出已注册名字），布局仍能跑、尺寸按 0', () => {
  const spec = columnSpec([
    { name: 'prymaryButton', size: { kind: 'auto' } },
    { name: 'parcelGrid', size: { kind: 'auto' }, cross: { kind: 'ratio', r: 0.84 } },
  ]);
  const bound = bindComponents(spec, { registry, env: { viewport: VIEW_390, data: { cols: 3, rows: 2 } } });
  expect(bound.errors).toHaveLength(1);
  expect(bound.errors[0]).toBe(
    "未知组件 'prymaryButton'，已注册的有：primaryButton / secondaryButton / coinBadge / statusText / pause / parcelGrid / infoPanel / card0 / card1",
  );
  const rects = layout(bound.spec, VIEW_390).rects;
  expect(rects['prymaryButton']?.h).toBe(0);
  expect(rects['parcelGrid']?.h).toBeCloseTo(218.4, 6); // 已注册的那个照常算
});

it('props 值校验：枚举/类型不符、键不存在都报中文错误并指出可用参数', () => {
  const spec = columnSpec([
    { name: 'primaryButton', size: { kind: 'fill' }, props: { tone: 'tertiary' } },
    { name: 'secondaryButton', size: { kind: 'fill' }, props: { tonee: 'primary' } },
  ]);
  const bound = bindComponents(spec, { registry, env: { viewport: VIEW_390, data: {} } });
  expect(bound.errors.some((e) => e.includes("'tone' 只能是 primary / secondary"))).toBe(true);
  expect(bound.errors.some((e) => e.includes("没有参数 'tonee'（可用：label / tone / disabled）"))).toBe(true);
});

it('绑定是纯函数：不改入参 spec，嵌套 stack 里的组件也能绑定', () => {
  const spec = gridSpec();
  const before = JSON.stringify(spec);
  const bound = bindComponents(spec, { registry, env: { viewport: VIEW_390, data: { cols: 3, rows: 2 } } });
  expect(JSON.stringify(spec)).toBe(before);
  expect(spec.regions[0]?.node?.stack?.children[0]?.measure).toBeUndefined();
  expect(bound.spec.regions[0]?.node?.stack?.children[0]?.measure).toBeTypeOf('function');

  const nested = columnSpec([
    {
      size: { kind: 'fixed', n: 63 },
      stack: { direction: 'row', children: [{ name: 'primaryButton', size: { kind: 'fill' } }] },
    },
  ]);
  const nestedBound = bindComponents(nested, { registry, env: { viewport: VIEW_390, data: {} } });
  expect(nestedBound.errors).toEqual([]);
  expect(nestedBound.components['primaryButton']).toBe(registry.get('primaryButton'));
  expect(nestedBound.props['primaryButton']).toEqual({});
});

it('assertComponents：布局后跑组件静态断言，正常返回空、太矮报中文问题', () => {
  const spec: LayoutSpec = {
    regions: [
      {
        name: 'info',
        edge: 'top',
        height: 40,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        node: { stack: { direction: 'column', align: 'center', children: [{ name: 'infoPanel', size: { kind: 'fill' } }] } },
      },
    ],
  };
  const bound = bindComponents(spec, { registry, env: { viewport: VIEW_320, data: {} } });
  const issues = assertComponents(bound, layout(bound.spec, VIEW_320).rects);
  expect(issues).toHaveLength(1);
  expect(issues[0]).toContain('infoPanel: 面板高 40px < 源边距 60px');

  const normal = bindComponents(gridSpec(), { registry, env: { viewport: VIEW_390, data: { cols: 3, rows: 2 } } });
  expect(assertComponents(normal, layout(normal.spec, VIEW_390).rects)).toEqual([]);
});

it('空注册表：所有组件都报未知，错误一次报全（不中断）', () => {
  const empty = createComponentRegistry();
  const spec = columnSpec([
    { name: 'a', size: { kind: 'auto' } },
    { name: 'b', size: { kind: 'auto' } },
  ]);
  const bound = bindComponents(spec, { registry: empty, env: { viewport: VIEW_390, data: {} } });
  expect(bound.errors).toHaveLength(2);
  expect(bound.errors[0]).toContain("未知组件 'a'");
  expect(bound.errors[1]).toContain("未知组件 'b'");
});
