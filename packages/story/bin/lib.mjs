/**
 * lint-story.mjs 用纯 JS（与 src/lint.ts 对齐）。
 */

const collectEnds = (script) => {
  const ends = [];
  for (const node of Object.values(script.nodes)) {
    if (node.end === true) ends.push(node.id);
  }
  return ends;
};

const reachableFrom = (script, fromId) => {
  const seen = new Set();
  const stack = [fromId];
  while (stack.length > 0) {
    const id = stack.pop();
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

export const lintStory = (raw) => {
  const issues = [];
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, issues: [{ kind: 'invalid-start', nodeId: '(root)', message: '必须是对象' }] };
  }
  const start = raw.start;
  const nodes = raw.nodes;
  if (typeof start !== 'string' || start.trim().length === 0) {
    return { ok: false, issues: [{ kind: 'invalid-start', nodeId: '(root)', message: 'start 无效' }] };
  }
  if (typeof nodes !== 'object' || nodes === null) {
    return { ok: false, issues: [{ kind: 'invalid-start', nodeId: '(root)', message: 'nodes 无效' }] };
  }
  const script = { start: start.trim(), nodes };

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

  for (const endId of collectEnds(script)) {
    if (!reachableFrom(script, script.start).has(endId)) {
      issues.push({ kind: 'unreachable-end', nodeId: endId, message: `结局节点「${endId}」从 start 不可达` });
    }
  }

  return { ok: issues.length === 0, issues };
};
