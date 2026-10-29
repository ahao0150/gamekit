/**
 * `aspect` 原语（v0.7）的**解析层**：词法（`<r>` / `<w>:<h>`）、组合校验、语法表、
 * 以及「现有全部 `.ui` 都不触发 aspect 错误」的回归扫描。
 *
 * 求解语义（已知轴推导、方向、fill 钳制）在 `layout-aspect.test.ts`。
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { layout } from './layout';
import type { NodeSpec } from './layout';
import { describeGrammar, PUT_MODIFIERS, UI_SYNTAX_VERSION } from './grammar';
import { parse } from './parse';
import { rectOf, REPO, VIEW } from './layout-aspect.helpers';

/** 解析一行 `put`（放进一个最小 region 里）。 */
const parseOne = (line: string) =>
  parse(`region body fill column align start\n${line}\n`, { fileName: 'x.ui' });

/** 解析一行 `put` 并要求零错误，返回节点。 */
const nodeOf = (line: string): NodeSpec => {
  const parsed = parseOne(line);
  expect(parsed.errors).toEqual([]);
  const node = parsed.spec.regions[0]?.node?.stack?.children[0];
  if (node === undefined) throw new Error('没有解析出节点');
  return node;
};

describe('aspect：解析（.ui → spec）', () => {
  it('aspect 16:9 解析成 1.7778（四位小数）', () => {
    expect(nodeOf('put cover cross 100% aspect 16:9').aspect).toBe(1.7778);
  });

  it('纯数字与 9:16 都折成 w/h', () => {
    expect(nodeOf('put cover cross 100% aspect 1').aspect).toBe(1);
    expect(nodeOf('put cover cross 100% aspect 9:16').aspect).toBe(0.5625);
  });

  it('aspect 0 / -1 / 1:0 都报错且带行号', () => {
    for (const bad of ['aspect 0', 'aspect -1', 'aspect 1:0']) {
      const parsed = parseOne(`put cover cross 100% ${bad}`);
      expect(parsed.errors.join('\n'), bad).toContain('x.ui:2:');
      expect(parsed.errors.length, bad).toBe(1);
    }
  });

  it('缺值 / 非法写法报错', () => {
    expect(parseOne('put cover cross 100% aspect').errors[0]).toContain('缺少比值');
    expect(parseOne('put cover cross 100% aspect abc').errors[0]).toContain('大于 0 的比值');
  });

  it('显式 size auto + aspect 报错（与「没写 size」区分开）', () => {
    expect(parseOne('put cover size auto aspect 1').errors[0]).toContain('aspect 与 size auto 冲突');
    // 没写 size 时解析器补的默认 auto 不算冲突
    expect(parseOne('put cover cross 100% aspect 1').errors).toEqual([]);
  });

  it('size fill + aspect 在解析期合法（v0.7 修正）；其余冲突仍带行号报错', () => {
    expect(parseOne('put cover size fill aspect 1').errors).toEqual([]);
    expect(parseOne('put cover size 100 cross 50 aspect 1').errors[0]).toContain('x.ui:2:');
    expect(parseOne('put cover size fill cross 50 aspect 1').errors[0]).toContain('aspect 的轴冲突');
  });

  it('端到端：parse → layout 得到真实正方形', () => {
    const parsed = parse('region body fill column align start\nput cover cross 100% aspect 1\n', {
      fileName: 'x.ui',
    });
    expect(parsed.errors).toEqual([]);
    const result = layout(parsed.spec, { width: 100, height: 400 });
    expect(rectOf(result, 'cover')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(result.errors).toEqual([]);
  });

  it('语法表同步：版本 v0.7、put 修饰词含 aspect、aspect 两种写法', () => {
    expect(UI_SYNTAX_VERSION).toBe('v0.7');
    expect(PUT_MODIFIERS).toContain('aspect');
    expect(describeGrammar().put.aspects).toEqual(['<r>', '<w>:<h>']);
  });
});

describe('aspect：回归', () => {
  const walk = (dir: string, out: string[]): string[] => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'build' || entry === 'dist') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (entry.endsWith('.ui')) out.push(full);
    }
    return out;
  };

  // 这条是全量回归：扫 games/** + templates/** 下所有 .ui（当前 59 个）逐个 layout。
  // 成本随 .ui 数量线性增长，并发跑时会被挤慢，所以单独放大 timeout。
  // 不要删这条——它是唯一能证明「新原语没让既有界面报错」的用例，抽样式覆盖不行。
  it('现有 games/** 与 templates/** 的 .ui 都不触发 aspect 错误', { timeout: 30000 }, () => {
    const files = ['games', 'templates'].flatMap((dir) => walk(join(REPO, dir), []));
    expect(files.length).toBeGreaterThan(30);
    for (const file of files) {
      const parsed = parse(readFileSync(file, 'utf8'), { fileName: file });
      const result = layout(parsed.spec, VIEW);
      const bad = [...parsed.errors, ...result.errors].filter((message) => message.includes('aspect'));
      expect(bad, file).toEqual([]);
    }
  });
});
