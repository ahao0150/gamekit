/**
 * @mg/economy 契约：配表形状、模拟与离线收益入参/出参。
 * 所有校验与计算均为纯函数，无模块级可变状态。
 */

/** 等级曲线一行：升到下一级所需经验；升级后可发金币奖励。 */
export interface LevelRow {
  readonly level: number;
  readonly expToNext: number;
  readonly rewardGold?: number;
}

/** 产出表一行：每小时金币（挂机/离线共用同一套速率）。 */
export interface ProductionRow {
  readonly id: string;
  readonly perHour: number;
  readonly unlockLevel?: number;
}

/** 价格表一行：购买后解锁同 id 的产出（若产出行存在）。 */
export interface PriceRow {
  readonly id: string;
  readonly costGold: number;
  readonly unlockLevel?: number;
}

export interface EconomyTables {
  readonly levels: readonly LevelRow[];
  readonly production: readonly ProductionRow[];
  readonly prices: readonly PriceRow[];
}

export interface SimulateOptions {
  readonly days: number;
  readonly startLevel?: number;
  readonly startGold?: number;
  /** 每天有效游玩小时数，默认 1 */
  readonly playHoursPerDay?: number;
  /** 游玩时每小时获得的经验，默认 10 */
  readonly expPerPlayHour?: number;
  /** 是否在每日结束时自动购买能负担的价格项，默认 true */
  readonly autoBuy?: boolean;
}

export interface DailySummary {
  readonly day: number;
  readonly level: number;
  readonly gold: number;
  readonly exp: number;
  readonly goldEarned: number;
  readonly purchases: readonly string[];
  readonly levelUps: number;
}

export interface SimulateReport {
  readonly days: number;
  readonly finalLevel: number;
  readonly finalGold: number;
  readonly finalExp: number;
  /** 结束时仍有可买但金币不足的下一档价格项 */
  readonly blockedByGold: boolean;
  readonly blockedItemId: string | null;
  readonly daily: readonly DailySummary[];
}

export interface OfflineCaps {
  /** 离线结算最多计多少小时，默认 24 */
  readonly maxHours?: number;
  /** 单次离线金币上限，默认不限 */
  readonly maxGold?: number;
}

export interface OfflineRewardInput {
  readonly lastSeenAt: number;
  readonly now: number;
  readonly productionTable: readonly ProductionRow[];
  /** 与 simulate 一致：有价格项的产出需先购买 */
  readonly prices?: readonly PriceRow[];
  readonly level: number;
  readonly purchasedIds?: readonly string[];
  readonly caps?: OfflineCaps;
}

export interface OfflineRewardResult {
  readonly gold: number;
  readonly elapsedMs: number;
  readonly capped: boolean;
}
