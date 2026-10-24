import { expect, it } from 'vitest';
import { parse } from './parse';

/**
 * T7：`style k=v` 的值必须**保留到 spec 节点上**。
 *
 * T5 时只校验键、值解析完就丢了；组件注册表接上后，`draw` 要拿 label / tone，
 * 所以这里断言「值真的进了 NodeSpec.props」，且类型转换（规范 §5）正确。
 */
it('style 值保留到节点 props：布尔 / 数字 / 字符串都按规范转换', () => {
  const result = parse(
    'region footer bottom 63 column\nput primaryButton size fill style tone=primary disabled=false ratio=1.5 label="开始 配送"\n',
  );
  expect(result.errors).toEqual([]);
  const node = result.spec.regions[0]?.node?.stack?.children[0];
  expect(node?.props).toEqual({ tone: 'primary', disabled: false, ratio: 1.5, label: '开始 配送' });
});

it('没有 style 的节点不带 props 字段（不会给所有节点塞空对象）', () => {
  const result = parse('region body fill column\nput parcelGrid size auto\n');
  expect(result.errors).toEqual([]);
  expect(result.spec.regions[0]?.node?.stack?.children[0]?.props).toBeUndefined();
});

it('style 写在 size / cross 后面也能保留（顺序无关）', () => {
  const result = parse('region body fill\nput primaryButton size fill cross fixed 56 style label="开始"\n');
  expect(result.errors).toEqual([]);
  expect(result.spec.regions[0]?.node?.stack?.children[0]?.props).toEqual({ label: '开始' });
});

it('传了 componentProps：非法键仍是「一次报全」的错误，合法键照常保留', () => {
  const bad = parse('region body fill\nput primaryButton style tonee=primary tone=secondary\n', {
    knownComponents: ['primaryButton'],
    componentProps: { primaryButton: ['tone'] },
  });
  expect(bad.errors).toHaveLength(1);
  expect(bad.errors[0]).toContain("style 键 'tonee'");

  const good = parse('region body fill\nput primaryButton style tone=secondary\n', {
    knownComponents: ['primaryButton'],
    componentProps: { primaryButton: ['tone'] },
  });
  expect(good.errors).toEqual([]);
  expect(good.spec.regions[0]?.node?.stack?.children[0]?.props).toEqual({ tone: 'secondary' });
});

/**
 * T16 修复：**带引号的值保持字符串**。
 *
 * 之前 `text="3"` 会被 `coerceStyleValue` 数字化成 `3`，于是声明为 `string` 的组件参数
 * 校验报错（写 `text="99+"` 才能绕过）。引号是作者「这是字符串」的显式意图，
 * 不该被类型猜测覆盖；不带引号的才是数字。
 */
it('带引号的值保持字符串，不带引号才数字化', () => {
  const result = parse(
    'region body fill\nput label style text="3" value=50 plus="99+" flag=true quoted="true" truthy=false\n',
  );
  expect(result.errors).toEqual([]);
  const props = result.spec.regions[0]?.node?.stack?.children[0]?.props;
  expect(props).toEqual({ text: '3', value: 50, plus: '99+', flag: true, quoted: 'true', truthy: false });
  expect(typeof props?.text).toBe('string');
  expect(typeof props?.value).toBe('number');
});
