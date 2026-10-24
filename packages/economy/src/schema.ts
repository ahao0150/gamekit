/**
 * 配表 schema 手写窄化与校验。
 */

import type { EconomyTables, LevelRow, PriceRow, ProductionRow } from './contract';

const fail = (table: string, index: number, field: string, detail: string): never => {
  throw new Error(`配表「${table}」第 ${index + 1} 行字段「${field}」不合法：${detail}`);
};

const reqNumber = (table: string, index: number, field: string, value: unknown, min = 0): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(table, index, field, '必须是数字');
  }
  const n = value as number;
  if (n < min) fail(table, index, field, `必须 ≥ ${min}`);
  return n;
};

const reqString = (table: string, index: number, field: string, value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(table, index, field, '必须是非空字符串');
  }
  return (value as string).trim();
};

const optNumber = (table: string, index: number, field: string, value: unknown, min = 0): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  return reqNumber(table, index, field, value, min);
};

const asArray = (raw: unknown, table: string): unknown[] => {
  if (!Array.isArray(raw)) throw new Error(`配表「${table}」必须是 JSON 数组`);
  return raw;
};

export const parseLevelRows = (raw: unknown): LevelRow[] => {
  const arr = asArray(raw, 'levels');
  const out: LevelRow[] = [];
  for (let i = 0; i < arr.length; i += 1) {
    const row = arr[i];
    if (typeof row !== 'object' || row === null) fail('levels', i, '(行)', '必须是对象');
    const o = row as Record<string, unknown>;
    const level = reqNumber('levels', i, 'level', o.level, 1);
    const expToNext = reqNumber('levels', i, 'expToNext', o.expToNext, 0);
    const rewardGold = optNumber('levels', i, 'rewardGold', o.rewardGold, 0);
    out.push({ level, expToNext, rewardGold });
  }
  out.sort((a, b) => a.level - b.level);
  return out;
};

export const parseProductionRows = (raw: unknown): ProductionRow[] => {
  const arr = asArray(raw, 'production');
  const out: ProductionRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < arr.length; i += 1) {
    const row = arr[i];
    if (typeof row !== 'object' || row === null) fail('production', i, '(行)', '必须是对象');
    const o = row as Record<string, unknown>;
    const id = reqString('production', i, 'id', o.id);
    if (seen.has(id)) fail('production', i, 'id', `重复 id「${id}」`);
    seen.add(id);
    const perHour = reqNumber('production', i, 'perHour', o.perHour, 0);
    const unlockLevel = optNumber('production', i, 'unlockLevel', o.unlockLevel, 1);
    out.push({ id, perHour, unlockLevel });
  }
  return out;
};

export const parsePriceRows = (raw: unknown): PriceRow[] => {
  const arr = asArray(raw, 'prices');
  const out: PriceRow[] = [];
  for (let i = 0; i < arr.length; i += 1) {
    const row = arr[i];
    if (typeof row !== 'object' || row === null) fail('prices', i, '(行)', '必须是对象');
    const o = row as Record<string, unknown>;
    const id = reqString('prices', i, 'id', o.id);
    const costGold = reqNumber('prices', i, 'costGold', o.costGold, 0);
    const unlockLevel = optNumber('prices', i, 'unlockLevel', o.unlockLevel, 1);
    out.push({ id, costGold, unlockLevel });
  }
  return out;
};

export const validateEconomyTables = (partial: {
  levels?: unknown;
  production?: unknown;
  prices?: unknown;
}): EconomyTables => ({
  levels: parseLevelRows(partial.levels ?? []),
  production: parseProductionRows(partial.production ?? []),
  prices: parsePriceRows(partial.prices ?? []),
});
