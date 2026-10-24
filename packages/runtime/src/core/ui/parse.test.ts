/**
 * `.ui` 解析器契约测试。
 *
 * 覆盖三块：**正常解析**（产物结构对不对）、**每个语法位置写错**（错误能不能报出来）、
 * **错误格式与行号**（`<file>:<line>: <中文说明>`，一次报全不中断）。
 */

import { describe, expect, it } from 'vitest';
import { parse } from './parse';

/** 规范 §2 的完整示例，用来钉住「合规文件能解析」这条底线。 */
const SAMPLE = `# 注释
region header top 48 row gap 8 pad 12 align center
put coinBadge  size auto
put statusText size fill
put pause      size fixed 24 align end

region body fill column pad 12
put parcelGrid size fill

region footer bottom 72 column gap 8 pad 12 align stretch
put primaryButton   size fill cross fixed 56 style tone=primary label="开始配送"
put secondaryButton size fill cross fixed 44 style tone=secondary
`;

describe('正常解析', () => {
  it('解析出 3 个 region，顺序与文件一致', () => {
    const result = parse(SAMPLE, { fileName: 'home.ui' });
    expect(result.errors).toEqual([]);
    expect(result.name).toBe('home');
    expect(result.spec.regions.map((r) => r.name)).toEqual(['header', 'body', 'footer']);
  });

  it('region 的边 / 高度 / 排布 / gap / pad / align 都落到 spec 上', () => {
    const result = parse(SAMPLE);
    const [header, body, footer] = result.spec.regions;
    expect(header?.edge).toBe('top');
    expect(header?.height).toEqual({ kind: 'fixed', n: 48 });
    expect(header?.padding).toEqual({ top: 12, right: 12, bottom: 12, left: 12 });
    expect(header?.node?.stack?.direction).toBe('row');
    expect(header?.node?.stack?.gap).toBe(8);
    expect(header?.node?.stack?.align).toBe('center');
    expect(body?.edge).toBe('fill');
    expect(body?.height).toBeUndefined();
    expect(footer?.edge).toBe('bottom');
    expect(footer?.height).toEqual({ kind: 'fixed', n: 72 });
    expect(footer?.node?.stack?.align).toBe('stretch');
  });

  it('put 的 size / cross / align 落到 NodeSpec 上', () => {
    const result = parse(SAMPLE);
    const children = result.spec.regions[0]?.node?.stack?.children ?? [];
    expect(children.map((c) => c.name)).toEqual(['coinBadge', 'statusText', 'pause']);
    expect(children[0]?.size).toEqual({ kind: 'auto' });
    expect(children[1]?.size).toEqual({ kind: 'fill' });
    expect(children[2]?.size).toEqual({ kind: 'fixed', n: 24 });
    expect(children[2]?.align).toBe('end');
    const buttons = result.spec.regions[2]?.node?.stack?.children ?? [];
    expect(buttons[0]?.cross).toEqual({ kind: 'fixed', n: 56 });
    expect(buttons[1]?.cross).toEqual({ kind: 'fixed', n: 44 });
  });

  it('components 去重且按首次出现排序，lines 记录真实行号', () => {
    const result = parse(SAMPLE);
    expect(result.components).toEqual(['coinBadge', 'statusText', 'pause', 'parcelGrid', 'primaryButton', 'secondaryButton']);
    expect(result.lines['coinBadge']).toBe(3);
    expect(result.lines['pause']).toBe(5);
    expect(result.lines['parcelGrid']).toBe(8);
    expect(result.lines['primaryButton']).toBe(11);
  });

  it('注释行、空行、行尾空白都不影响解析', () => {
    const result = parse('\n# 只有注释\n\n   \nregion body fill\nput a size fixed 10\n');
    expect(result.errors).toEqual([]);
    expect(result.components).toEqual(['a']);
    expect(result.lines['a']).toBe(6);
  });

  it('尺寸四种写法 + 裸数字当 fixed', () => {
    const result = parse(`region body fill column
put a size fill
put b size auto
put c size fixed 24
put d size ratio 0.5
put e size 16
`);
    expect(result.errors).toEqual([]);
    const sizes = (result.spec.regions[0]?.node?.stack?.children ?? []).map((c) => c.size);
    expect(sizes).toEqual([
      { kind: 'fill' },
      { kind: 'auto' },
      { kind: 'fixed', n: 24 },
      { kind: 'ratio', r: 0.5 },
      { kind: 'fixed', n: 16 },
    ]);
  });

  it('未传 knownComponents 时不做组件存在性校验', () => {
    const result = parse('region body fill\nput someUnknownWidget size fill\n');
    expect(result.errors).toEqual([]);
    expect(result.components).toEqual(['someUnknownWidget']);
  });

  it('传空数组等于跳过校验（T5 阶段的默认口径）', () => {
    const result = parse('region body fill\nput whatever size fill\n', { knownComponents: [] });
    expect(result.errors).toEqual([]);
  });
});

describe('错误：语法位置逐项', () => {
  const cases: Array<{ title: string; source: string; expect: string }> = [
    { title: '未知语句', source: 'colum body fill\n', expect: '不认识的语句' },
    { title: 'region 缺名字', source: 'region\n', expect: 'region 需要一个合法的标识符' },
    { title: 'region 名字非法', source: 'region 9bad top 10\n', expect: 'region 需要一个合法的标识符' },
    { title: 'region 边非法', source: 'region body left 10\n', expect: '的边必须是 top / bottom / fill' },
    { title: 'top 缺高度', source: 'region body top\n', expect: '缺少长度' },
    { title: 'top 高度非数字', source: 'region body top abc\n', expect: '必须是像素或百分比' },
    { title: 'region 未知修饰词', source: 'region body fill rowd\n', expect: '不认识的修饰词' },
    { title: 'region gap 缺值', source: 'region body fill gap\n', expect: '缺少长度' },
    { title: 'region align 非法', source: 'region body fill align middle\n', expect: 'align 只能是' },
    { title: 'put 缺组件名', source: 'region body fill\nput\n', expect: 'put 需要一个组件名' },
    { title: 'put 未知修饰词', source: 'region body fill\nput a sizee fill\n', expect: '不认识的修饰词' },
    { title: 'size 非法值', source: 'region body fill\nput a size bigg\n', expect: "size 只接受 fill / auto / fixed <n> / ratio <r> / <n>%，收到 'bigg'" },
    { title: 'size fixed 缺数字', source: 'region body fill\nput a size fixed\n', expect: 'fixed 需要一个数字' },
    { title: 'size ratio 超范围', source: 'region body fill\nput a size ratio 2\n', expect: 'ratio 必须在 0 到 1 之间' },
    { title: 'put 的 align 非法', source: 'region body fill\nput a align middle\n', expect: 'align 只能是' },
    { title: 'style 不是 k=v', source: 'region body fill\nput a style tone\n', expect: 'style 需要 key=value 形式' },
    { title: 'put 在没有 region 时', source: 'put a size fill\n', expect: '之前没有 region' },
  ];

  cases.forEach(({ title, source, expect: expected }) => {
    it(title, () => {
      const result = parse(source, { fileName: 'home.ui' });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain(expected);
      expect(result.errors[0]?.startsWith('home.ui:')).toBe(true);
    });
  });

  it('重复 region 报出首次定义的行号', () => {
    const result = parse('region body fill\nregion body top 10\n', { fileName: 'home.ui' });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBe("home.ui:2: region 'body' 重复定义（第 1 行已定义）");
  });

  it('传了 knownComponents 后报未知组件并列出已注册项', () => {
    const result = parse('region body fill\nput prymaryButton size fill\n', {
      knownComponents: ['primaryButton', 'secondaryButton'],
      fileName: 'home.ui',
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBe("home.ui:2: 未知组件 'prymaryButton'，已注册的有：primaryButton / secondaryButton");
  });

  it('传了 componentProps 后报 style 键拼错并列出可用参数', () => {
    const result = parse('region footer bottom 72 column\nput primaryButton size fill style tonee=primary\n', {
      knownComponents: ['primaryButton'],
      componentProps: { primaryButton: ['tone', 'label', 'disabled'] },
      fileName: 'home.ui',
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBe(
      "home.ui:2: style 键 'tonee' 不是组件 primaryButton 的合法参数，可用：tone / label / disabled",
    );
  });

  it('合法 style 键不报错（含布尔与数字转换）', () => {
    const result = parse('region footer bottom 72 column\nput primaryButton size fill style tone=primary disabled=false ratio=1.5 label="开始 配送"\n', {
      knownComponents: ['primaryButton'],
      componentProps: { primaryButton: ['tone', 'label', 'disabled', 'ratio'] },
    });
    expect(result.errors).toEqual([]);
  });
});

describe('错误：一次报全、行号准确', () => {
  it('多个错误全部报出来，不在第一个错误处中断', () => {
    const source = `region header top 48
put okOne size fill
put badCmp size bigg
region header bottom 10
put noRegionYet size fill
`;
    const result = parse(source, {
      knownComponents: ['okOne'],
      fileName: 'home.ui',
    });
    // 第 3 行 size 非法、第 4 行 region 重复、第 5 行未知组件
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]).toContain('home.ui:3:');
    expect(result.errors[1]).toContain('home.ui:4:');
    expect(result.errors[2]).toContain('home.ui:5:');
  });

  it('行号从 1 开始，注释行也计入', () => {
    const result = parse('# c1\n# c2\nregion body fill\nput a size xyz\n', { fileName: 'ui/home.ui' });
    expect(result.errors).toEqual(["ui/home.ui:4: size 只接受 fill / auto / fixed <n> / ratio <r> / <n>%，收到 'xyz'"]);
  });

  it('解析失败的文件返回已解析出的部分（不抛异常）', () => {
    const result = parse('region body fill\nput a size fill\nput b size ???\n', { fileName: 'home.ui' });
    expect(result.errors).toHaveLength(1);
    expect(result.spec.regions[0]?.node?.stack?.children.map((c) => c.name)).toEqual(['a']);
  });
});

describe('v0.2：百分比高度与 pad 分轴', () => {
  it('region 高度支持百分比（基数=视口高，编译成 ratio）', () => {
    const result = parse('region header top 9%\nregion footer bottom 8.5%\nregion body fill\n');
    expect(result.errors).toEqual([]);
    expect(result.spec.regions[0]?.height).toEqual({ kind: 'ratio', r: 0.09 });
    expect(result.spec.regions[1]?.height).toEqual({ kind: 'ratio', r: 0.085 });
    expect(result.spec.regions[2]?.height).toBeUndefined();
  });

  it('百分比与固定像素可以在同一个文件里混用', () => {
    const result = parse('region header top 9%\nregion gap top 12\nregion body fill\n');
    expect(result.spec.regions[0]?.height).toEqual({ kind: 'ratio', r: 0.09 });
    expect(result.spec.regions[1]?.height).toEqual({ kind: 'fixed', n: 12 });
  });

  it('pad-x / pad-y 覆盖 pad 的对应两轴', () => {
    const result = parse('region body fill column pad 12 pad-x 19.5 pad-y 4\n');
    expect(result.errors).toEqual([]);
    expect(result.spec.regions[0]?.padding).toEqual({ top: 4, right: 19.5, bottom: 4, left: 19.5 });
  });

  it('只写 pad-x 时上下保持 0，不带 padding 的带不产出该字段', () => {
    const withPad = parse('region body fill pad-x 19.5\n');
    expect(withPad.spec.regions[0]?.padding).toEqual({ top: 0, right: 19.5, bottom: 0, left: 19.5 });
    const noPad = parse('region body fill\n');
    expect(noPad.spec.regions[0]?.padding).toBeUndefined();
  });

  it('put 的 size / cross 也支持百分比', () => {
    const result = parse('region body fill column\nput a size 50%\nput b size fill cross 40%\n');
    const children = result.spec.regions[0]?.node?.stack?.children ?? [];
    expect(children[0]?.size).toEqual({ kind: 'ratio', r: 0.5 });
    expect(children[1]?.size).toEqual({ kind: 'fill' });
    expect(children[1]?.cross).toEqual({ kind: 'ratio', r: 0.4 });
  });

  it('百分比越界时报错（region 高度与 put 尺寸两个位置）', () => {
    const region = parse('region body top 120%\n', { fileName: 'home.ui' });
    expect(region.errors).toHaveLength(1);
    expect(region.errors[0]).toContain('0% 到 100%');
    const put = parse('region body fill\nput a size 150%\n', { fileName: 'home.ui' });
    expect(put.errors).toHaveLength(1);
    expect(put.errors[0]).toContain('0% 到 100%');
  });

  it('pad-x 不是非负数字时报错', () => {
    const result = parse('region body fill pad-x abc\n', { fileName: 'home.ui' });
    expect(result.errors[0]).toContain('必须是像素或百分比');
  });
});
describe('v0.3：pad / gap 支持百分比', () => {
  it('pad-x 5% 编译成 ratio 长度（左右）', () => {
    const result = parse('region body fill pad-x 5%\n');
    expect(result.errors).toEqual([]);
    expect(result.spec.regions[0]?.padding).toEqual({
      top: 0,
      right: { kind: 'ratio', r: 0.05 },
      bottom: 0,
      left: { kind: 'ratio', r: 0.05 },
    });
  });

  it('gap 2% 编译成 ratio 长度', () => {
    const result = parse('region body fill row gap 2%\nput a size fill\nput b size fill\n');
    expect(result.errors).toEqual([]);
    expect(result.spec.regions[0]?.node?.stack?.gap).toEqual({ kind: 'ratio', r: 0.02 });
  });

  it('pad 12 仍是像素、pad-y 3% 是百分比，两者可以混用', () => {
    const result = parse('region body fill pad 12 pad-y 3%\n');
    expect(result.spec.regions[0]?.padding).toEqual({
      top: { kind: 'ratio', r: 0.03 },
      right: 12,
      bottom: { kind: 'ratio', r: 0.03 },
      left: 12,
    });
  });

  it('pad 百分比越界时报错', () => {
    const result = parse('region body fill pad-x 120%\n', { fileName: 'home.ui' });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('0% 到 100%');
  });
});