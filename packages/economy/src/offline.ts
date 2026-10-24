/**
 * 离线收益：按产出表与等级结算挂机金币。
 */

import type { OfflineRewardInput, OfflineRewardResult } from './contract';
import { hourlyGoldRate } from './rates';

const MS_PER_HOUR = 3_600_000;

export const computeOfflineReward = (input: OfflineRewardInput): OfflineRewardResult => {
  const now = Number.isFinite(input.now) ? input.now : 0;
  const last = Number.isFinite(input.lastSeenAt) ? input.lastSeenAt : now;
  let elapsedMs = Math.max(0, now - last);

  const maxHours = input.caps?.maxHours !== undefined && input.caps.maxHours > 0 ? input.caps.maxHours : 24;
  const maxMs = maxHours * MS_PER_HOUR;
  let capped = false;
  if (elapsedMs > maxMs) {
    elapsedMs = maxMs;
    capped = true;
  }

  const purchased = new Set(input.purchasedIds ?? []);
  const level = input.level >= 1 ? Math.floor(input.level) : 1;
  const rate = hourlyGoldRate(input.productionTable, input.prices ?? [], level, purchased);
  let gold = rate * (elapsedMs / MS_PER_HOUR);

  const maxGold = input.caps?.maxGold;
  if (maxGold !== undefined && Number.isFinite(maxGold) && gold > maxGold) {
    gold = maxGold;
    capped = true;
  }

  return { gold, elapsedMs, capped };
};
