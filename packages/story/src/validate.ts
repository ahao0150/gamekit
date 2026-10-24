import type { StoryChoice, StoryNode, StoryScript } from './contract';

const fail = (field: string, detail: string): never => {
  throw new Error(`剧情脚本字段「${field}」不合法：${detail}`);
};

const reqString = (field: string, value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) fail(field, '必须是非空字符串');
  return (value as string).trim();
};

const parseChoice = (raw: unknown, index: number): StoryChoice => {
  if (typeof raw !== 'object' || raw === null) fail(`choices[${index}]`, '必须是对象');
  const o = raw as Record<string, unknown>;
  const text = reqString(`choices[${index}].text`, o.text);
  const next = reqString(`choices[${index}].next`, o.next);
  const when = o.when === undefined ? undefined : reqString(`choices[${index}].when`, o.when);
  return { text, next, when };
};

const parseNode = (id: string, raw: unknown): StoryNode => {
  if (typeof raw !== 'object' || raw === null) fail(`nodes.${id}`, '必须是对象');
  const o = raw as Record<string, unknown>;
  const dialogue = reqString(`nodes.${id}.dialogue`, o.dialogue);
  const end = o.end === true;
  let choices: StoryChoice[] | undefined;
  if (o.choices !== undefined) {
    if (!Array.isArray(o.choices)) fail(`nodes.${id}.choices`, '必须是数组');
    choices = (o.choices as unknown[]).map((c, i) => parseChoice(c, i));
  }
  let set: StoryNode['set'];
  if (o.set !== undefined) {
    if (typeof o.set !== 'object' || o.set === null) fail(`nodes.${id}.set`, '必须是对象');
    const s = o.set as Record<string, unknown>;
    const flags = s.flags as Record<string, boolean> | undefined;
    const vars = s.vars as Record<string, number> | undefined;
    set = { flags, vars };
  }
  return { id, dialogue, choices, set, end };
};

export const parseStoryScript = (raw: unknown): StoryScript => {
  if (typeof raw !== 'object' || raw === null) fail('(root)', '必须是对象');
  const o = raw as Record<string, unknown>;
  const start = reqString('start', o.start);
  if (typeof o.nodes !== 'object' || o.nodes === null) fail('nodes', '必须是对象');
  const nodesRaw = o.nodes as Record<string, unknown>;
  const nodes: Record<string, StoryNode> = {};
  for (const key of Object.keys(nodesRaw)) {
    const node = parseNode(key, nodesRaw[key]);
    if (node.id !== key) fail(`nodes.${key}`, `节点 id 与键名不一致（${node.id}）`);
    nodes[key] = node;
  }
  return { start, nodes };
};
