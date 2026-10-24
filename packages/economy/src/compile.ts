/**
 * 将扁平 tsv/csv 配表目录编译为引擎可用的 JSON。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EconomyTables } from './contract';
import { loadTablesFromDir } from './load';

const TABLE_NAMES = ['levels', 'production', 'prices'] as const;

/** 把已校验的表写入 outDir（每表一个 JSON 数组）。 */
export const writeCompiledTables = (tables: EconomyTables, outDir: string): void => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'levels.json'), `${JSON.stringify(tables.levels, null, 2)}\n`);
  writeFileSync(join(outDir, 'production.json'), `${JSON.stringify(tables.production, null, 2)}\n`);
  writeFileSync(join(outDir, 'prices.json'), `${JSON.stringify(tables.prices, null, 2)}\n`);
};

/** 从含 tsv/csv 的源目录加载并写出 JSON（优先读扁平源，不手改 json）。 */
export const compileTablesFromDir = (srcDir: string, outDir: string): EconomyTables => {
  const tables = loadTablesFromDir(srcDir);
  writeCompiledTables(tables, outDir);
  return tables;
};

export const economyTableNames = (): readonly string[] => TABLE_NAMES;
