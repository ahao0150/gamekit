import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileTablesFromDir,
  computeOfflineReward,
  loadTablesFromDir,
  loadTablesFromParts,
  parseTsvTable,
  simulate,
  validateEconomyTables,
} from './index';

const basicTables = loadTablesFromParts({
  levels: [
    { level: 1, expToNext: 100, rewardGold: 10 },
    { level: 2, expToNext: 200, rewardGold: 20 },
  ],
  production: [
    { id: 'farm', perHour: 10, unlockLevel: 1 },
    { id: 'mine', perHour: 100, unlockLevel: 1 },
  ],
  prices: [{ id: 'mine', costGold: 500, unlockLevel: 1 }],
});

describe('flat tables', () => {
  it('TSV 首行表头解析为行对象', () => {
    const rows = parseTsvTable('id\tperHour\nfarm\t12\n');
    expect(rows).toEqual([{ id: 'farm', perHour: 12 }]);
  });

  it('示例 idle-basic 从 tsv 加载并与 simulate 兼容', () => {
    const dir = join(import.meta.dirname, '../examples/idle-basic');
    const tables = loadTablesFromDir(dir);
    expect(tables.levels.length).toBeGreaterThanOrEqual(3);
    const report = simulate(tables, { days: 1, startGold: 0, playHoursPerDay: 1 });
    expect(report.finalLevel).toBeGreaterThanOrEqual(1);
  });

  it('compileTablesFromDir 写出 JSON 数组', () => {
    const src = join(import.meta.dirname, '../examples/idle-basic');
    const out = mkdtempSync(join(tmpdir(), 'mg-economy-compile-'));
    const tables = compileTablesFromDir(src, out);
    expect(tables.production.some((p) => p.id === 'farm')).toBe(true);
    const again = loadTablesFromDir(out);
    expect(again.levels).toEqual(tables.levels);
  });
});

describe('schema', () => {
  it('缺字段时抛中文错误并指出表名', () => {
    expect(() => validateEconomyTables({ levels: [{ level: 1 }] })).toThrow(/expToNext/);
    expect(() => validateEconomyTables({ production: [{ perHour: 1 }] })).toThrow(/id/);
  });
});

describe('simulate', () => {
  it('相同入参结果可复现', () => {
    const a = simulate(basicTables, { days: 3, startGold: 0, playHoursPerDay: 2, expPerPlayHour: 50 });
    const b = simulate(basicTables, { days: 3, startGold: 0, playHoursPerDay: 2, expPerPlayHour: 50 });
    expect(a).toEqual(b);
    expect(a.daily.length).toBe(3);
    expect(a.finalLevel).toBeGreaterThanOrEqual(1);
  });

  it('金币不足时标记 blockedByGold', () => {
    const report = simulate(basicTables, { days: 1, startGold: 0, playHoursPerDay: 1, autoBuy: false });
    expect(report.blockedByGold).toBe(true);
    expect(report.blockedItemId).toBe('mine');
  });
});

describe('computeOfflineReward', () => {
  it('按小时产出并尊重封顶', () => {
    const r = computeOfflineReward({
      lastSeenAt: 0,
      now: 3_600_000,
      productionTable: [{ id: 'farm', perHour: 120 }],
      level: 1,
      caps: { maxHours: 0.5, maxGold: 40 },
    });
    expect(r.gold).toBe(40);
    expect(r.capped).toBe(true);
    expect(r.elapsedMs).toBe(1_800_000);
  });
});
