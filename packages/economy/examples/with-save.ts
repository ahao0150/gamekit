/**
 * 示例：createSave + lastSeenAt + computeOfflineReward（注释示意，不直接跑）。
 *
 * 真实项目从 @mg/runtime 引入 createSave（或游戏内 re-export），
 * 数值表从 @mg/economy 加载。
 */

import { computeOfflineReward, loadTablesFromDir } from '../src/index';

// import { createSave } from '@mg/runtime';

export interface IdleSaveV1 {
  readonly level: number;
  readonly gold: number;
  readonly purchased: readonly string[];
  readonly lastSeenAt: number;
}

export const applyOfflineOnBoot = (data: IdleSaveV1, tablesDir: string, now: number): IdleSaveV1 => {
  const tables = loadTablesFromDir(tablesDir);
  const offline = computeOfflineReward({
    lastSeenAt: data.lastSeenAt,
    now,
    productionTable: tables.production,
    prices: tables.prices,
    level: data.level,
    purchasedIds: data.purchased,
    caps: { maxHours: 12 },
  });
  return {
    ...data,
    gold: data.gold + offline.gold,
    lastSeenAt: now,
  };
};

// const save = createSave({ version: 1, store, migrations: [] });
// let data = save.load<IdleSaveV1>() ?? { level: 1, gold: 0, purchased: [], lastSeenAt: Date.now() };
// data = applyOfflineOnBoot(data, 'packages/economy/examples/idle-basic', Date.now());
// save.save(data);
