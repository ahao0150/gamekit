import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStoryRunner, lintStory, parseFlatStory, parseStoryScript } from './index';

const demo = {
  start: 'intro',
  nodes: {
    intro: {
      id: 'intro',
      dialogue: '你好',
      choices: [{ text: '打招呼', next: 'meet' }],
      set: { flags: { metNpc: true } },
    },
    meet: {
      id: 'meet',
      dialogue: '商人出现',
      choices: [
        { text: '买', next: 'rich', when: 'vars.gold >= 10' },
        { text: '离开', next: 'bye' },
      ],
    },
    rich: { id: 'rich', dialogue: '成交', end: true },
    bye: { id: 'bye', dialogue: '再见', end: true },
    orphan: { id: 'orphan', dialogue: '死路', choices: [{ text: 'x', next: 'missing' }] },
  },
};

const demoFlatPath = join(import.meta.dirname, '../examples/demo.story.tsv');

describe('parseFlatStory', () => {
  it('示例 demo.story.tsv 可解析且 lint 通过', () => {
    const script = parseFlatStory(readFileSync(demoFlatPath, 'utf8'));
    expect(script.start).toBe('intro');
    expect(script.nodes.guide?.choices?.length).toBe(3);
    const report = lintStory(script);
    expect(report.ok).toBe(true);
  });

  it('条件表达式挂在 choice.when', () => {
    const script = parseFlatStory(readFileSync(demoFlatPath, 'utf8'));
    const buy = script.nodes.guide?.choices?.find((c) => c.next === 'cave');
    expect(buy?.when).toBe('vars.gold>=20');
  });
});

describe('lintStory', () => {
  it('检出断链与不可达结局', () => {
    const report = lintStory(demo);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.kind === 'broken-link')).toBe(true);
  });
});

describe('createStoryRunner', () => {
  it('条件分支与结局', () => {
    const script = parseStoryScript({
      start: 'intro',
      nodes: {
        intro: {
          id: 'intro',
          dialogue: 'a',
          choices: [{ text: 'go', next: 'end' }],
          set: { vars: { gold: 10 } },
        },
        end: { id: 'end', dialogue: 'done', end: true },
      },
    });
    const r0 = createStoryRunner(script);
    expect(r0.current()?.dialogue).toBe('a');
    const r1 = r0.choose(0);
    expect(r1.isEnded()).toBe(true);
    expect(r1.state.vars.gold).toBe(10);
  });
});
