/**
 * `mg.ui.grammar()` 的单一真源验收：
 * - 语法说明来自解析器的表（`grammar.ts`），不是手写字符串；
 * - 与 `docs/ui-syntax.md` 的关键字**双向对得上**（文档有、表里也有；表里有、文档也有）。
 *
 * 这条测试存在的原因：今天已经因为「文档和实现漂移」踩过坑（PLAN-ai-authoring §9.6）。
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALIGNS,
  HIT_VALUES,
  JUSTIFY_VALUES,
  LAYER_NAMES,
  LENGTH_FORMS,
  PERCENT_BASIS,
  PUT_MODIFIERS,
  REGION_DIRECTIONS,
  REGION_EDGES,
  REGION_MODIFIERS,
  SIZE_FORMS,
  STYLE_VALUE_TYPES,
  UI_GRAMMAR,
  UI_SYNTAX_VERSION,
  UI_VERBS,
  describeGrammar,
} from '../../runtime/src/core/ui/grammar';
import { createUiTools } from './ui-tools';

// T44：文档已搬进仓库 `repos/gamekit/docs/`（原来在团队工作区 `workspace/docs/`，要上跳 5 层）。
// 这个路径断了测试会直接红 —— 它就是「克隆下来能不能找到文档」的守门人。
const DOC = readFileSync(new URL('../../../docs/ui-syntax.md', import.meta.url), 'utf8');

/** 文档里必须出现的关键字（与解析器表同源）。 */
const KEYWORDS: readonly string[] = [
  ...UI_VERBS,
  ...REGION_EDGES,
  ...REGION_DIRECTIONS,
  ...REGION_MODIFIERS,
  ...PUT_MODIFIERS,
  ...ALIGNS,
  ...JUSTIFY_VALUES,
  ...LAYER_NAMES,
  ...HIT_VALUES,
  'fill',
  'auto',
  'fixed',
  'ratio',
  'true',
  'false',
];

const grammarText = async (): Promise<string> => (await createUiTools().call('ui.grammar', {})).text;

describe('语法说明由解析器的表生成', () => {
  it('describeGrammar 与导出的关键字表逐项一致', () => {
    const grammar = describeGrammar();
    expect(grammar.version).toBe(UI_SYNTAX_VERSION);
    expect(grammar.verbs).toEqual(UI_VERBS);
    expect(grammar.region.edges).toEqual(REGION_EDGES);
    expect(grammar.region.directions).toEqual(REGION_DIRECTIONS);
    expect(grammar.region.modifiers).toEqual(REGION_MODIFIERS);
    expect(grammar.region.alignValues).toEqual(ALIGNS);
    expect(grammar.region.justifyValues).toEqual(JUSTIFY_VALUES);
    expect(grammar.layers).toEqual(LAYER_NAMES);
    expect(grammar.put.hits).toEqual(HIT_VALUES);
    expect(grammar.put.modifiers).toEqual(PUT_MODIFIERS);
    expect(grammar.put.sizes).toEqual(SIZE_FORMS);
    expect(grammar.put.styleValues).toEqual(STYLE_VALUE_TYPES);
    expect(grammar.lengths).toEqual(LENGTH_FORMS);
    expect(grammar.percentBasis).toEqual(PERCENT_BASIS);
    expect(grammar.errorFormat).toBe(UI_GRAMMAR.errorFormat);
  });

  it('mg.ui.grammar 输出包含表里每一个关键字（不是手写清单）', async () => {
    const text = await grammarText();
    for (const word of KEYWORDS) expect(text, `语法说明缺少 ${word}`).toContain(word);
    for (const form of SIZE_FORMS) expect(text).toContain(form);
    for (const form of LENGTH_FORMS) expect(text).toContain(form);
    for (const value of STYLE_VALUE_TYPES) expect(text).toContain(value);
    for (const basis of PERCENT_BASIS) expect(text).toContain(basis.where);
    expect(text).toContain(UI_SYNTAX_VERSION);
    expect(text).toContain(UI_GRAMMAR.errorFormat);
  });
});

describe('语法说明与 docs/ui-syntax.md 双向对账', () => {
  it('文档里出现的关键字都在语法表里（文档 → 表）', () => {
    const tableWords = new Set<string>(KEYWORDS);
    for (const word of KEYWORDS) {
      expect(DOC, `文档缺少关键字 ${word}`).toContain(word);
      expect(tableWords.has(word), `表里缺少文档中的关键字 ${word}`).toBe(true);
    }
  });

  it('表里的关键字都在文档里有定义（表 → 文档）', () => {
    for (const word of KEYWORDS) {
      expect(DOC, `文档没有定义 ${word}`).toContain(word);
    }
  });

  it('文档版本与解析器版本一致', () => {
    expect(DOC).toContain(UI_SYNTAX_VERSION);
  });
});
