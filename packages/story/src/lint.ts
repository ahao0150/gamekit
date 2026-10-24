import type { LintIssue, LintReport, StoryScript } from './contract';
import { parseStoryScript } from './validate';

const collectEnds = (script: StoryScript): string[] => {
  const ends: string[] = [];
  for (const node of Object.values(script.nodes)) {
    if (node.end === true) ends.push(node.id);
  }
  return ends;
};

const reachableFrom = (script: StoryScript, fromId: string): Set<string> => {
  const seen = new Set<string>();
  const stack = [fromId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = script.nodes[id];
    if (node === undefined) continue;
    if (node.end === true) continue;
    for (const c of node.choices ?? []) {
      if (!seen.has(c.next)) stack.push(c.next);
    }
  }
  return seen;
};

export const lintStory = (raw: unknown): LintReport => {
  const issues: LintIssue[] = [];
  let script: StoryScript;
  try {
    script = parseStoryScript(raw);
  } catch (error) {
    return {
      ok: false,
      issues: [{ kind: 'invalid-start', nodeId: '(root)', message: error instanceof Error ? error.message : String(error) }],
    };
  }

  if (script.nodes[script.start] === undefined) {
    issues.push({ kind: 'invalid-start', nodeId: script.start, message: `start 指向不存在的节点「${script.start}」` });
  }

  for (const node of Object.values(script.nodes)) {
    if (node.end === true) continue;
    const choices = node.choices ?? [];
    if (choices.length === 0) {
      issues.push({ kind: 'dead-end', nodeId: node.id, message: '非结局节点没有 choices，玩家无路可走' });
    }
    for (const c of choices) {
      if (script.nodes[c.next] === undefined) {
        issues.push({ kind: 'broken-link', nodeId: node.id, message: `选项「${c.text}」的 next「${c.next}」不存在` });
      }
    }
  }

  const ends = collectEnds(script);
  const reach = reachableFrom(script, script.start);
  for (const endId of ends) {
    if (!reach.has(endId)) {
      issues.push({ kind: 'unreachable-end', nodeId: endId, message: `结局节点「${endId}」从 start 不可达` });
    }
  }

  return { ok: issues.length === 0, issues };
};
