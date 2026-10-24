/**
 * 产出速率：等级 + 已购 id 决定每小时金币。
 */

import type { PriceRow, ProductionRow } from './contract';

const priceById = (prices: readonly PriceRow[]): Map<string, PriceRow> => {
  const m = new Map<string, PriceRow>();
  for (const p of prices) m.set(p.id, p);
  return m;
};

const isProductionActive = (
  row: ProductionRow,
  level: number,
  purchased: ReadonlySet<string>,
  prices: Map<string, PriceRow>,
): boolean => {
  const needLevel = row.unlockLevel ?? 1;
  if (level < needLevel) return false;
  const price = prices.get(row.id);
  if (price === undefined) return true;
  return purchased.has(row.id);
};

/** 当前等级与已购项下的每小时总产出。 */
export const hourlyGoldRate = (
  production: readonly ProductionRow[],
  prices: readonly PriceRow[],
  level: number,
  purchasedIds: ReadonlySet<string>,
): number => {
  const priceMap = priceById(prices);
  let sum = 0;
  for (const row of production) {
    if (isProductionActive(row, level, purchasedIds, priceMap)) sum += row.perHour;
  }
  return sum;
};

export const nextBlockedPurchase = (
  prices: readonly PriceRow[],
  level: number,
  purchased: ReadonlySet<string>,
  gold: number,
): { id: string; costGold: number } | null => {
  const candidates = prices
    .filter((p) => !purchased.has(p.id) && level >= (p.unlockLevel ?? 1))
    .sort((a, b) => a.costGold - b.costGold);
  const next = candidates[0];
  if (next === undefined) return null;
  if (gold >= next.costGold) return null;
  return { id: next.id, costGold: next.costGold };
};
