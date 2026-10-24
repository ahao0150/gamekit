/**
 * 多日成长模拟（纯函数、可复现）。
 */

import type { DailySummary, EconomyTables, SimulateOptions, SimulateReport } from './contract';
import { hourlyGoldRate, nextBlockedPurchase } from './rates';

const levelRowOf = (tables: EconomyTables, level: number) =>
  tables.levels.find((r) => r.level === level);

const tryLevelUp = (
  tables: EconomyTables,
  level: number,
  exp: number,
  gold: number,
): { level: number; exp: number; gold: number; count: number } => {
  let l = level;
  let e = exp;
  let g = gold;
  let count = 0;
  for (;;) {
    const row = levelRowOf(tables, l);
    if (row === undefined || e < row.expToNext) break;
    e -= row.expToNext;
    l += 1;
    count += 1;
    const next = levelRowOf(tables, l - 1);
    if (next?.rewardGold !== undefined) g += next.rewardGold;
  }
  return { level: l, exp: e, gold: g, count };
};

const autoBuyPass = (
  tables: EconomyTables,
  level: number,
  gold: number,
  purchased: Set<string>,
): { gold: number; bought: string[] } => {
  const bought: string[] = [];
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

export const simulate = (tables: EconomyTables, opts: SimulateOptions): SimulateReport => {
  const days = Math.max(0, Math.floor(opts.days));
  const playHours = opts.playHoursPerDay !== undefined && opts.playHoursPerDay > 0 ? opts.playHoursPerDay : 1;
  const expPerHour = opts.expPerPlayHour !== undefined && opts.expPerPlayHour > 0 ? opts.expPerPlayHour : 10;
  const autoBuy = opts.autoBuy !== false;

  let level = opts.startLevel !== undefined && opts.startLevel >= 1 ? Math.floor(opts.startLevel) : 1;
  let gold = opts.startGold !== undefined && Number.isFinite(opts.startGold) ? opts.startGold : 0;
  let exp = 0;
  const purchased = new Set<string>();
  const daily: DailySummary[] = [];

  for (let d = 1; d <= days; d += 1) {
    const rate = hourlyGoldRate(tables.production, tables.prices, level, purchased);
    const goldEarned = rate * playHours;
    gold += goldEarned;
    exp += expPerHour * playHours;

    const up = tryLevelUp(tables, level, exp, gold);
    level = up.level;
    exp = up.exp;
    gold = up.gold;
    let levelUps = up.count;
    let purchases: string[] = [];

    if (autoBuy) {
      const buy = autoBuyPass(tables, level, gold, purchased);
      gold = buy.gold;
      purchases = buy.bought;
      const up2 = tryLevelUp(tables, level, exp, gold);
      level = up2.level;
      exp = up2.exp;
      gold = up2.gold;
      levelUps += up2.count;
    }

    daily.push({
      day: d,
      level,
      gold,
      exp,
      goldEarned,
      purchases,
      levelUps,
    });
  }

  const blocked = nextBlockedPurchase(tables.prices, level, purchased, gold);
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
