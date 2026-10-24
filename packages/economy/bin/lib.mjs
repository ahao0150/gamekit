/**
 * simulate.mjs 用纯 JS 实现（与 src/*.ts 逻辑对齐；改算法时请同步 TS 与单测）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const fail = (table, index, field, detail) => {
  throw new Error(`配表「${table}」第 ${index + 1} 行字段「${field}」不合法：${detail}`);
};

const reqNumber = (table, index, field, value, min = 0) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(table, index, field, '必须是数字');
  if (value < min) fail(table, index, field, `必须 ≥ ${min}`);
  return value;
};

const reqString = (table, index, field, value) => {
  if (typeof value !== 'string' || value.trim().length === 0) fail(table, index, field, '必须是非空字符串');
  return value.trim();
};

const optNumber = (table, index, field, value, min = 0) => {
  if (value === undefined || value === null || value === '') return undefined;
  return reqNumber(table, index, field, value, min);
};

export const validateTables = (partial) => ({
  levels: parseLevels(partial.levels ?? []),
  production: parseProduction(partial.production ?? []),
  prices: parsePrices(partial.prices ?? []),
});

const asArray = (raw, table) => {
  if (!Array.isArray(raw)) throw new Error(`配表「${table}」必须是 JSON 数组`);
  return raw;
};

const parseLevels = (raw) => {
  const arr = asArray(raw, 'levels');
  const out = arr.map((row, i) => {
    if (typeof row !== 'object' || row === null) fail('levels', i, '(行)', '必须是对象');
    return {
      level: reqNumber('levels', i, 'level', row.level, 1),
      expToNext: reqNumber('levels', i, 'expToNext', row.expToNext, 0),
      rewardGold: optNumber('levels', i, 'rewardGold', row.rewardGold, 0),
    };
  });
  out.sort((a, b) => a.level - b.level);
  return out;
};

const parseProduction = (raw) => {
  const arr = asArray(raw, 'production');
  const seen = new Set();
  return arr.map((row, i) => {
    if (typeof row !== 'object' || row === null) fail('production', i, '(行)', '必须是对象');
    const id = reqString('production', i, 'id', row.id);
    if (seen.has(id)) fail('production', i, 'id', `重复 id「${id}」`);
    seen.add(id);
    return {
      id,
      perHour: reqNumber('production', i, 'perHour', row.perHour, 0),
      unlockLevel: optNumber('production', i, 'unlockLevel', row.unlockLevel, 1),
    };
  });
};

const parsePrices = (raw) => {
  const arr = asArray(raw, 'prices');
  return arr.map((row, i) => {
    if (typeof row !== 'object' || row === null) fail('prices', i, '(行)', '必须是对象');
    return {
      id: reqString('prices', i, 'id', row.id),
      costGold: reqNumber('prices', i, 'costGold', row.costGold, 0),
      unlockLevel: optNumber('prices', i, 'unlockLevel', row.unlockLevel, 1),
    };
  });
};

const splitDelimitedLine = (line, delimiter) => {
  const out = [];
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

const parseCell = (raw) => {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t.length > 0 && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
};

const parseDelimitedTable = (text, delimiter) => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length < 2) return [];
  const headers = splitDelimitedLine(lines[0], delimiter);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitDelimitedLine(lines[i], delimiter);
    const row = {};
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c];
      if (key === undefined || key.length === 0) continue;
      row[key] = parseCell(cells[c] ?? '');
    }
    rows.push(row);
  }
  return rows;
};

const readTableFile = (dir, name) => {
  const tsvPath = join(dir, `${name}.tsv`);
  const csvPath = join(dir, `${name}.csv`);
  const jsonPath = join(dir, `${name}.json`);
  if (existsSync(tsvPath)) return parseDelimitedTable(readFileSync(tsvPath, 'utf8'), '\t');
  if (existsSync(csvPath)) return parseDelimitedTable(readFileSync(csvPath, 'utf8'), ',');
  if (existsSync(jsonPath)) return JSON.parse(readFileSync(jsonPath, 'utf8'));
  return [];
};

export const loadTablesFromDir = (dir) => {
  const production = readTableFile(dir, 'production');
  const drops = readTableFile(dir, 'drops');
  return validateTables({
    levels: readTableFile(dir, 'levels'),
    production: Array.isArray(production) && production.length > 0 ? production : drops,
    prices: readTableFile(dir, 'prices'),
  });
};

export const compileTablesFromDir = (srcDir, outDir) => {
  const tables = loadTablesFromDir(srcDir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'levels.json'), `${JSON.stringify(tables.levels, null, 2)}\n`);
  writeFileSync(join(outDir, 'production.json'), `${JSON.stringify(tables.production, null, 2)}\n`);
  writeFileSync(join(outDir, 'prices.json'), `${JSON.stringify(tables.prices, null, 2)}\n`);
  return tables;
};

const hourlyGoldRate = (production, prices, level, purchased) => {
  const priceMap = new Map(prices.map((p) => [p.id, p]));
  let sum = 0;
  for (const row of production) {
    const need = row.unlockLevel ?? 1;
    if (level < need) continue;
    const price = priceMap.get(row.id);
    if (price !== undefined && !purchased.has(row.id)) continue;
    sum += row.perHour;
  }
  return sum;
};

const levelRowOf = (tables, level) => tables.levels.find((r) => r.level === level);

const tryLevelUp = (tables, level, exp, gold) => {
  let l = level;
  let e = exp;
  let g = gold;
  let count = 0;
  for (;;) {
    const row = levelRowOf(tables, l);
    if (row === undefined || e < row.expToNext) break;
    e -= row.expToNext;
    const completed = row;
    l += 1;
    count += 1;
    if (completed.rewardGold !== undefined) g += completed.rewardGold;
  }
  return { level: l, exp: e, gold: g, count };
};

const autoBuyPass = (tables, level, gold, purchased) => {
  const bought = [];
  let g = gold;
  for (;;) {
    const affordable = tables.prices
      .filter((p) => !purchased.has(p.id) && level >= (p.unlockLevel ?? 1) && g >= p.costGold)
      .sort((a, b) => a.costGold - b.costGold)[0];
    if (affordable === undefined) break;
    g -= affordable.costGold;
    purchased.add(affordable.id);
    bought.push(affordable.id);
  }
  return { gold: g, bought };
};

const nextBlocked = (prices, level, purchased, gold) => {
  const candidates = prices
    .filter((p) => !purchased.has(p.id) && level >= (p.unlockLevel ?? 1))
    .sort((a, b) => a.costGold - b.costGold);
  const next = candidates[0];
  if (next === undefined || gold >= next.costGold) return null;
  return { id: next.id, costGold: next.costGold };
};

export const simulate = (tables, opts) => {
  const days = Math.max(0, Math.floor(opts.days));
  const playHours = opts.playHoursPerDay > 0 ? opts.playHoursPerDay : 1;
  const expPerHour = opts.expPerPlayHour > 0 ? opts.expPerPlayHour : 10;
  const autoBuy = opts.autoBuy !== false;

  let level = opts.startLevel >= 1 ? Math.floor(opts.startLevel) : 1;
  let gold = Number.isFinite(opts.startGold) ? opts.startGold : 0;
  let exp = 0;
  const purchased = new Set();
  const daily = [];

  for (let d = 1; d <= days; d += 1) {
    const rate = hourlyGoldRate(tables.production, tables.prices, level, purchased);
    const goldEarned = rate * playHours;
    gold += goldEarned;
    exp += expPerHour * playHours;

    let up = tryLevelUp(tables, level, exp, gold);
    level = up.level;
    exp = up.exp;
    gold = up.gold;
    let levelUps = up.count;
    let purchases = [];

    if (autoBuy) {
      const buy = autoBuyPass(tables, level, gold, purchased);
      gold = buy.gold;
      purchases = buy.bought;
      up = tryLevelUp(tables, level, exp, gold);
      level = up.level;
      exp = up.exp;
      gold = up.gold;
      levelUps += up.count;
    }

    daily.push({ day: d, level, gold, exp, goldEarned, purchases, levelUps });
  }

  const blocked = nextBlocked(tables.prices, level, purchased, gold);
  return {
    days,
    finalLevel: level,
    finalGold: gold,
    finalExp: exp,
    blockedByGold: blocked !== null,
    blockedItemId: blocked?.id ?? null,
    daily,
  };
};
