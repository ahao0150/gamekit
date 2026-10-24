/**
 * 扁平 TSV 剧情脚本 → StoryScript（编译前真源格式）。
 */

import type { StoryChoice, StoryNode, StoryScript } from './contract';

const COLS = ['id', 'type', 'speaker', 'text', 'next', 'condition', 'set'] as const;

type RowType = 'line' | 'choice' | 'end';

interface FlatRow {
  id: string;
  type: RowType;
  speaker: string;
  text: string;
  next: string;
  condition: string;
  set: string;
}

const splitTsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\t') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
};

const parseSetClause = (raw: string): StoryNode['set'] | undefined => {
  const t = raw.trim();
  if (t.length === 0) return undefined;
  const flags: Record<string, boolean> = {};
  const vars: Record<string, number> = {};
  for (const part of t.split(';')) {
    const seg = part.trim();
    if (seg.length === 0) continue;
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    const lhs = seg.slice(0, eq).trim();
    const rhs = seg.slice(eq + 1).trim();
    if (lhs.startsWith('flags.')) {
      const key = lhs.slice('flags.'.length);
      flags[key] = rhs === 'true';
    } else if (lhs.startsWith('vars.')) {
      const key = lhs.slice('vars.'.length);
      const n = Number(rhs);
      if (Number.isFinite(n)) vars[key] = n;
    }
  }
  if (Object.keys(flags).length === 0 && Object.keys(vars).length === 0) return undefined;
  return { flags, vars };
};

const formatDialogue = (speaker: string, text: string): string => {
  const t = text.trim();
  const sp = speaker.trim();
  if (sp.length === 0) return t;
  if (t.length === 0) return sp;
  return `${sp}：${t}`;
};

const parseFlatRows = (text: string): { start: string | null; rows: FlatRow[] } => {
  const lines = text.split(/\r?\n/);
  let start: string | null = null;
  const rows: FlatRow[] = [];
  let header: string[] | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) {
      const m = line.match(/^#\s*start:\s*(\S+)/i);
      if (m?.[1]) start = m[1];
      continue;
    }
    const cells = splitTsvLine(line);
    if (header === null) {
      header = cells.map((c) => c.trim().toLowerCase());
      continue;
    }
    const get = (name: string): string => {
      const idx = header!.indexOf(name);
      return idx >= 0 ? (cells[idx] ?? '').trim() : '';
    };
    const typeRaw = get('type').toLowerCase();
    const type: RowType =
      typeRaw === 'choice' ? 'choice' : typeRaw === 'end' ? 'end' : 'line';
    rows.push({
      id: get('id'),
      type,
      speaker: get('speaker'),
      text: get('text'),
      next: get('next'),
      condition: get('condition'),
      set: get('set'),
    });
  }
  return { start, rows };
};

interface NodeDraft {
  id: string;
  dialogue: string;
  choices: StoryChoice[];
  set?: StoryNode['set'];
  end?: boolean;
  lineNext?: string;
}

/** 将扁平 TSV 文本解析为 StoryScript。 */
export const parseFlatStory = (text: string): StoryScript => {
  const { start: startComment, rows } = parseFlatRows(text);
  const drafts = new Map<string, NodeDraft>();

  for (const row of rows) {
    if (row.id.length === 0) throw new Error('扁平剧情行缺少 id');
    let draft = drafts.get(row.id);
    if (draft === undefined) {
      draft = { id: row.id, dialogue: '', choices: [] };
      drafts.set(row.id, draft);
    }

    if (row.type === 'end') {
      draft.end = true;
      if (row.text.length > 0 || row.speaker.length > 0) {
        draft.dialogue = formatDialogue(row.speaker, row.text);
      }
      const set = parseSetClause(row.set);
      if (set !== undefined) draft.set = set;
      continue;
    }

    if (row.type === 'line') {
      if (row.text.length > 0 || row.speaker.length > 0) {
        draft.dialogue = formatDialogue(row.speaker, row.text);
      }
      const set = parseSetClause(row.set);
      if (set !== undefined) draft.set = set;
      if (row.next.length > 0) draft.lineNext = row.next;
      continue;
    }

    if (row.type === 'choice') {
      if (row.text.length === 0 || row.next.length === 0) {
        throw new Error(`节点「${row.id}」的 choice 需要 text 与 next`);
      }
      const when = row.condition.length > 0 ? row.condition : undefined;
      draft.choices.push({ text: row.text, next: row.next, when });
    }
  }

  const nodes: Record<string, StoryNode> = {};
  for (const draft of drafts.values()) {
    if (draft.lineNext !== undefined && draft.lineNext.length > 0) {
      const hasNext = draft.choices.some((c) => c.next === draft.lineNext);
      if (!hasNext) {
        draft.choices.push({ text: '继续', next: draft.lineNext });
      }
    }
    const node: StoryNode = {
      id: draft.id,
      dialogue: draft.dialogue,
      choices: draft.choices.length > 0 ? draft.choices : undefined,
      set: draft.set,
      end: draft.end === true ? true : undefined,
    };
    nodes[draft.id] = node;
  }

  let start = startComment;
  if (start === null || start.length === 0) {
    const firstLine = rows.find((r) => r.type === 'line');
    start = firstLine?.id ?? rows[0]?.id ?? '';
  }
  if (start.length === 0) throw new Error('无法确定剧情起点（可加 # start: <id>）');

  return { start, nodes };
};

/** 将 StoryScript 序列化为 JSON 对象（与手写 JSON 形状一致）。 */
export const storyScriptToJson = (script: StoryScript): Record<string, unknown> => ({
  start: script.start,
  nodes: script.nodes,
});

export const flatStoryColumns = (): readonly string[] => COLS;
