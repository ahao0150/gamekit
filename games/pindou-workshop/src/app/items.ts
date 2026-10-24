/**
 * IAA 广告道具的**纯逻辑层**（不碰平台、不碰 canvas、不存状态）。
 *
 * 三条规则按 T65 任务书钉死：
 * - 每关次数上限：提示 ≤3、续时 1、扩临时位 1（防刷）；
 * - **第 1 关不放任何广告入口**（IAA 常识：首关 30 秒内要先给正反馈）；
 * - 广告不可用/未填充 → 按钮**优雅禁用**（不能点了没反应）。
 *
 * 为什么单独成文件：`state.ts` 要 `AD_LIMITS`、`game.ts` 要「按钮该不该亮」、
 * 测试要逐条断言，三处共用一份口径，谁都不许自己再写一遍阈值。
 */

export type AdItem = 'hint' | 'time' | 'slot';

/** 每关可用次数（第 1 关整组禁用） */
export const AD_LIMITS: Readonly<Record<AdItem, number>> = { hint: 3, time: 1, slot: 1 };

/** 本关剩余次数 */
export interface ItemLeft {
  readonly hint: number;
  readonly time: number;
  readonly slot: number;
}

export const FULL_ITEMS: ItemLeft = { hint: AD_LIMITS.hint, time: AD_LIMITS.time, slot: AD_LIMITS.slot };

export type DisabledReason = '' | 'first-level' | 'used-up' | 'unsupported';

export interface AdEntry {
  readonly item: AdItem;
  /** 按钮文案（带剩余次数） */
  readonly label: string;
  readonly enabled: boolean;
  readonly reason: DisabledReason;
  /** 点了但不能用时的提示语（给 toast 用） */
  readonly hint: string;
}

const LABELS: Readonly<Record<AdItem, string>> = { hint: '提示', time: '续时 +30s', slot: '扩位 +1' };
const HINTS: Readonly<Record<AdItem, string>> = {
  hint: '本关提示次数用完了',
  time: '本关续时次数用完了',
  slot: '本关扩位次数用完了',
};

export interface EntriesInput {
  /** 当前关卡号（1 起）：第 1 关不放广告入口 */
  readonly levelId: number;
  readonly left: ItemLeft;
  /** 平台是否真的能放激励视频（`platform.can('ad-rewarded')`） */
  readonly canRewarded: boolean;
}

/** 三个广告入口的可用状态（顺序固定：提示 / 续时 / 扩位） */
export const adEntriesOf = (input: EntriesInput): readonly AdEntry[] => {
  const items: readonly AdItem[] = ['hint', 'time', 'slot'];
  const firstLevel = input.levelId <= 1;
  return items.map((item) => {
    const left = Math.max(0, input.left[item]);
    const reason: DisabledReason = firstLevel ? 'first-level' : left <= 0 ? 'used-up' : !input.canRewarded ? 'unsupported' : '';
    return {
      item,
      label: `${LABELS[item]} ${left}`,
      enabled: reason === '',
      reason,
      hint: reason === 'first-level' ? '第 1 关不给广告' : reason === 'unsupported' ? '广告暂不可用' : HINTS[item],
    };
  });
};

/**
 * 提示锁哪一格：**随机一个还没归位的正确格**。
 *
 * `rand` 由调用方注入（游戏传 Math.random，测试传定值）—— 提示是「解锁一格」，
 * 具体哪格不影响正确性，但必须可测。
 *
 * @param grid          目标图案（-1 = 空格）
 * @param filled        已经被占住的格下标（已归位或广告锁定的）
 * @param pendingColors 还没归位的色块颜色（决定哪些格「现在能放」）
 */
export const hintCellOf = (
  grid: readonly number[],
  filled: readonly number[],
  pendingColors: readonly number[],
  rand: () => number,
): number => {
  const occupied = new Set(filled);
  const canPlace = new Set(pendingColors);
  const open: number[] = [];
  for (let i = 0; i < grid.length; i += 1) {
    const color = grid[i];
    if (color === undefined || color < 0) continue;
    if (occupied.has(i)) continue;
    if (!canPlace.has(color)) continue;
    open.push(i);
  }
  if (open.length === 0) return -1;
  const k = Math.floor(Math.max(0, Math.min(0.999999, rand())) * open.length);
  return open[k] ?? -1;
};
/**
 * 插屏频次：**每通关 3 关弹一次**。
 * 只在「通关」这条路径上问（失败/重试不问），所以重试同一关永远不会弹。
 */
export const shouldInterstitial = (clears: number): boolean =>
  Number.isFinite(clears) && clears > 0 && Math.floor(clears) % 3 === 0;
