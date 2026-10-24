/**
 * 从目录或分表内容加载并校验 EconomyTables。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EconomyTables } from './contract';
import { parseCsvTable, parseJsonTable, parseTsvTable } from './parse';
import { validateEconomyTables } from './schema';

const readTableFile = (dir: string, name: string): unknown => {
  const tsvPath = join(dir, `${name}.tsv`);
  const csvPath = join(dir, `${name}.csv`);
  const jsonPath = join(dir, `${name}.json`);
  if (existsSync(tsvPath)) {
    return parseTsvTable(readFileSync(tsvPath, 'utf8'));
  }
  if (existsSync(csvPath)) {
    return parseCsvTable(readFileSync(csvPath, 'utf8'));
  }
  if (existsSync(jsonPath)) {
    return parseJsonTable(readFileSync(jsonPath, 'utf8'));
  }
  return [];
};

/** 从目录读取 levels/production/prices（tsv/csv 优先，json 仅兼容/编译产物）。 */
export const loadTablesFromDir = (dir: string): EconomyTables => {
  const production = readTableFile(dir, 'production');
  const drops = readTableFile(dir, 'drops');
  const partial: Record<string, unknown> = {
    levels: readTableFile(dir, 'levels'),
    production: Array.isArray(production) && production.length > 0 ? production : drops,
    prices: readTableFile(dir, 'prices'),
  };
  return validateEconomyTables(partial);
};

/** 从已解析的分表对象校验（测试 / 游戏内 fetch 后用）。 */
export const loadTablesFromParts = (parts: {
  levels?: unknown;
  production?: unknown;
  prices?: unknown;
}): EconomyTables => validateEconomyTables(parts);
