/**
 * JSON / TSV / CSV 解析为行对象（首行表头）。
 */

const splitDelimitedLine = (line: string, delimiter: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
};

const splitCsvLine = (line: string): string[] => splitDelimitedLine(line, ',');
const splitTsvLine = (line: string): string[] => splitDelimitedLine(line, '\t');

const parseCell = (raw: string): string | number | boolean => {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t.length > 0 && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
};

const parseDelimitedTable = (text: string, splitLine: (line: string) => string[]): Record<string, unknown>[] => {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length < 2) return [];
  const headers = splitLine(lines[0] ?? '');
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    const cells = splitLine(line);
    const row: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c];
      if (key === undefined || key.length === 0) continue;
      row[key] = parseCell(cells[c] ?? '');
    }
    rows.push(row);
  }
  return rows;
};

/** 将 TSV 文本解析为对象数组（首行为列名，制表符分隔）。 */
export const parseTsvTable = (text: string): Record<string, unknown>[] => parseDelimitedTable(text, splitTsvLine);

/** 将 CSV 文本解析为对象数组（首行为列名）。 */
export const parseCsvTable = (text: string): Record<string, unknown>[] => parseDelimitedTable(text, splitCsvLine);

/** 解析 JSON 数组或单对象包装。 */
export const parseJsonTable = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('配表不是合法 JSON');
  }
};
