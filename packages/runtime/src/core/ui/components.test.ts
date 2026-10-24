import { expect, it } from 'vitest';
import {
  boolProp,
  checkPropValue,
  createComponentRegistry,
  defineComponent,
  estimateTextWidth,
  numberProp,
  stringProp,
  unknownComponentMessage,
} from './components';
import type { ComponentDef } from './components';

/** 最小可用组件：注册表测试不关心它画什么。 */
const minimal: ComponentDef = {
  props: { label: 'string', tone: 'primary|secondary', disabled: 'boolean' },
  measure: () => ({ w: 10, h: 10 }),
  draw: () => {},
};

it('注册表：注册后 get / has / names 一致，未注册的返回 null', () => {
  const registry = createComponentRegistry();
  expect(registry.has('primaryButton')).toBe(false);
  expect(registry.get('primaryButton')).toBeNull();
  expect(registry.names()).toEqual([]);

  registry.register(defineComponent('primaryButton', minimal));
  expect(registry.has('primaryButton')).toBe(true);
  expect(registry.get('primaryButton')).toBe(minimal);
  expect(registry.names()).toEqual(['primaryButton']);
  expect(registry.get('nope')).toBeNull();
});

it('同名组件重复注册直接抛错（不静默覆盖）', () => {
  const registry = createComponentRegistry();
  registry.register(defineComponent('a', minimal));
  expect(() => registry.register(defineComponent('a', minimal))).toThrow(/重复注册/);
});

it('defineComponent 拒绝非法组件名与非法参数名', () => {
  expect(() => defineComponent('1bad', minimal)).toThrow(/组件名/);
  expect(() => defineComponent('', minimal)).toThrow(/组件名/);
  expect(() => defineComponent('ok', { ...minimal, props: { 'bad-key': 'string' } })).toThrow(/参数名/);
  expect(() => defineComponent('ok', { ...minimal, props: { label: '' } })).toThrow(/类型声明/);
});

it('propKeys / propDecls：从 props 声明生成，喂给 parse() 用', () => {
  const registry = createComponentRegistry();
  registry.register(defineComponent('a', minimal));
  registry.register(defineComponent('b', { measure: () => ({ w: 0, h: 0 }), draw: () => {} }));
  expect(registry.propKeys()).toEqual({ a: ['label', 'tone', 'disabled'], b: [] });
  expect(registry.propDecls()['a']).toEqual({ label: 'string', tone: 'primary|secondary', disabled: 'boolean' });
});

it('未知组件的报错文案列出已注册名字（AI 能照着改）', () => {
  const registry = createComponentRegistry();
  registry.register(defineComponent('primaryButton', minimal));
  registry.register(defineComponent('secondaryButton', minimal));
  expect(unknownComponentMessage('prymaryButton', registry)).toBe(
    "未知组件 'prymaryButton'，已注册的有：primaryButton / secondaryButton",
  );
  expect(unknownComponentMessage('x', createComponentRegistry())).toContain('注册表为空');
});

it('checkPropValue：string / number / boolean / 枚举各有各的中文报错', () => {
  expect(checkPropValue('string', '开始配送')).toBeNull();
  expect(checkPropValue('string', 3)).toContain('需要字符串');
  expect(checkPropValue('number', 3)).toBeNull();
  expect(checkPropValue('number', '3')).toContain('需要数字');
  expect(checkPropValue('boolean', false)).toBeNull();
  expect(checkPropValue('boolean', 'false')).toContain('需要 true / false');
  expect(checkPropValue('primary|secondary', 'primary')).toBeNull();
  expect(checkPropValue('primary|secondary', 'tertiary')).toContain('只能是 primary / secondary');
});

it('estimateTextWidth：CJK 按 1 字宽、ASCII 按 0.55 字宽', () => {
  expect(estimateTextWidth('开始配送', 10)).toBe(40);
  expect(estimateTextWidth('abcd', 10)).toBeCloseTo(22, 6);
  expect(estimateTextWidth('', 10)).toBe(0);
});

it('读参数的小工具：类型不符时回默认值，不抛错', () => {
  const props = { label: 5, size: 'big', disabled: 'true', tone: 'secondary' };
  expect(stringProp(props, 'label', '兜底')).toBe('兜底');
  expect(stringProp(props, 'tone', 'primary')).toBe('secondary');
  expect(numberProp(props, 'size', 24)).toBe(24);
  expect(boolProp(props, 'disabled')).toBe(true);
  expect(boolProp({}, 'disabled', true)).toBe(true);
});
