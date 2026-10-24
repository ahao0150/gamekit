/**
 * @mg/economy — 配表、模拟、离线收益。
 */

export type {
  DailySummary,
  EconomyTables,
  LevelRow,
  OfflineCaps,
  OfflineRewardInput,
  OfflineRewardResult,
  PriceRow,
  ProductionRow,
  SimulateOptions,
  SimulateReport,
} from './contract';

export { loadTablesFromDir, loadTablesFromParts } from './load';
export { compileTablesFromDir, writeCompiledTables } from './compile';
export { parseCsvTable, parseJsonTable, parseTsvTable } from './parse';
export { parseLevelRows, parsePriceRows, parseProductionRows, validateEconomyTables } from './schema';
export { hourlyGoldRate, nextBlockedPurchase } from './rates';
export { simulate } from './simulate';
export { computeOfflineReward } from './offline';
