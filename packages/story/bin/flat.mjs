/**
 * 扁平剧情解析（与 src/flat.ts 对齐）。
 */

const splitTsvLine = (line) => {
  const out = [];
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

const parseSetClause = (raw) => {
  const t = raw.trim();
  if (t.length === 0) return undefined;
  const flags = {};
  const vars = {};
  for (const part of t.split(';')) {
    const seg = part.trim();
    if (seg.length === 0) continue;
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    const lhs = seg.slice(0, eq).trim();
    const rhs = seg.slice(eq + 1).trim();
    if (lhs.startsWith('flags.')) {
      flags[lhs.slice('flags.'.length)] = rhs === 'true';
    } else if (lhs.startsWith('vars.')) {
      const n = Number(rhs);
      if (Number.isFinite(n)) vars[lhs.slice('vars.'.length)] = n;
    }
  }
  if (Object.keys(flags).length === 0 && Object.keys(vars).length === 0) return undefined;
  return { flags, vars };
};

const formatDialogue = (speaker, text) => {
  const t = text.trim();
  const sp = speaker.trim();
  if (sp.length === 0) return t;
  if (t.length === 0) return sp;
  return `${sp}：${t}`;
};

const parseFlatRows = (text) => {
  const lines = text.split(/\r?\n/);
  let start = null;
  const rows = [];
  let header = null;

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
    const get = (name) => {
      const idx = header.indexOf(name);
      return idx >= 0 ? (cells[idx] ?? '').trim() : '';
    };
    const typeRaw = get('type').toLowerCase();
    const type = typeRaw === 'choice' ? 'choice' : typeRaw === 'end' ? 'end' : 'line';
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

export const parseFlatStory = (text) => {
  const { start: startComment, rows } = parseFlatRows(text);
  const drafts = new Map();

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

  const nodes = {};
  for (const draft of drafts.values()) {
    if (draft.lineNext !== undefined && draft.lineNext.length > 0) {
      const hasNext = draft.choices.some((c) => c.next === draft.lineNext);
      if (!hasNext) {
        draft.choices.push({ text: '继续', next: draft.lineNext });
      }
    }
    nodes[draft.id] = {
      id: draft.id,
      dialogue: draft.dialogue,
      choices: draft.choices.length > 0 ? draft.choices : undefined,
      set: draft.set,
      end: draft.end === true ? true : undefined,
    };
  }

  let start = startComment;
  if (start === null || start.length === 0) {
    const firstLine = rows.find((r) => r.type === 'line');
    start = firstLine?.id ?? rows[0]?.id ?? '';
  }
  if (start.length === 0) throw new Error('无法确定剧情起点（可加 # start: <id>）');

  return { start, nodes };
};

export const loadStoryFromPath = (filePath, readFileSync) => {
  const text = readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.story.tsv') || filePath.endsWith('.story')) {
    return parseFlatStory(text);
  }
  return JSON.parse(text);
};
