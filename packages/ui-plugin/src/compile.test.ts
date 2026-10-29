/**
 * `.ui` 编译函数测试。
 *
 * 测的是「编译产物」这一层：产物必须是**纯数据**（JSON 可序列化，不能混进函数）、
 * 结构符合规范 §7、失败时给出规范 §6 的完整错误串。
 * 真链路（Vite dev/build 都走同一函数）由 `tools/verify-ui-plugin.mjs` 验。
 */

import { describe, expect, it } from 'vitest';
import { compileUi } from './compile';

const SOURCE = `# 首页
region header top 48 row gap 8 pad 12 align center
put coinBadge size auto

region body fill column pad 12
put parcelGrid size fill

region footer bottom 72 column gap 8 align stretch
put primaryButton size fill cross fixed 56 style tone=primary label="开始配送"
`;

describe('compileUi', () => {
  it('产物是 `export default` 的数据模块，且能被 JSON 解析回来', () => {
    const result = compileUi(SOURCE, 'ui/home.ui');
    expect(result.errors).toEqual([]);
    expect(result.code.startsWith('// 由 @mg/ui-plugin')).toBe(true);
    expect(result.code).toContain('export default ');
    const json = result.code.slice(result.code.indexOf('{'), result.code.lastIndexOf('}') + 1);
    const data = JSON.parse(json) as { name: string; spec: { regions: unknown[] }; components: string[]; source: string; lines: Record<string, number> };
    expect(data.name).toBe('home');
    expect(data.spec.regions).toHaveLength(3);
    expect(data.source).toBe('ui/home.ui');
    expect(data.lines['primaryButton']).toBe(9);
  });

  it('产物里没有函数（spec 是纯数据，可直接进 JSON/存档）', () => {
    const result = compileUi(SOURCE, 'ui/home.ui');
    expect(result.code).not.toContain('=>');
    expect(result.code).not.toContain('function');
    expect(result.module).not.toBeNull();
    expect(() => JSON.stringify(result.module)).not.toThrow();
  });

  it('解析失败：code 为空、errors 是规范 §6 的完整串、module 保留已解析部分', () => {
    const result = compileUi('region body fill\nput a size bigg\n', 'ui/home.ui');
    expect(result.code).toBe('');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBe("ui/home.ui:2: size 只接受 fill / auto / fixed <n> / ratio <r> / <n>%，收到 'bigg'");
    expect(result.module?.spec.regions).toHaveLength(1);
  });

  it('一次报全多个错误（编译不做「报第一个就停」）', () => {
    const result = compileUi('region body fill\nput a size bigg\nput b size small\n', 'ui/home.ui');
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]?.startsWith('ui/home.ui:2:')).toBe(true);
    expect(result.errors[1]?.startsWith('ui/home.ui:3:')).toBe(true);
  });

  it('把 knownComponents / componentProps 透传给解析器', () => {
    const ok = compileUi('region body fill\nput primaryButton size fill style tone=primary\n', 'ui/home.ui', {
      knownComponents: ['primaryButton'],
      componentProps: { primaryButton: ['tone', 'label'] },
    });
    expect(ok.errors).toEqual([]);
    const bad = compileUi('region body fill\nput prymaryButton size fill\n', 'ui/home.ui', {
      knownComponents: ['primaryButton'],
    });
    expect(bad.errors[0]).toContain('未知组件');
  });

  it('aspect（v0.7）：产物带 aspect 字段，组合错误与 parse 同源（编译期不重复实现）', () => {
    const ok = compileUi('region body fill column align start\nput cover cross 100% aspect 1\n', 'ui/home.ui');
    expect(ok.errors).toEqual([]);
    const child = ok.module?.spec.regions[0]?.node?.stack?.children[0];
    expect(child?.aspect).toBe(1);

    // 同一条文案，只有文件名前缀由 compileUi 补——证明校验只在 parse 里实现了一次
    const bad = compileUi('region body fill\nput cover size 100 cross 50 aspect 1\n', 'ui/home.ui');
    expect(bad.code).toBe('');
    expect(bad.errors[0]).toContain('ui/home.ui:2:');
    expect(bad.errors[0]).toContain('aspect 的轴冲突');

    // v0.7 修正：size fill + aspect 合法，产物能编译出来
    const fillOk = compileUi('region body fill\nput cover size fill aspect 1\n', 'ui/home.ui');
    expect(fillOk.errors).toEqual([]);
    expect(fillOk.module?.spec.regions[0]?.node?.stack?.children[0]?.aspect).toBe(1);
  });
});
