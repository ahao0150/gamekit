/**
 * 游戏状态与存档结构：纯数据 + 纯函数，不碰平台、不碰 canvas。
 * 存档是外部输入（可能被改坏），读进来一律逐字段收窄。
 */
export const SAVE_VERSION = 1;

export interface GameState {
  readonly score: number;
  readonly rewardedCount: number;
  /** 当前提示文案（直接画在屏幕上） */
  readonly hint: string;
}

export interface SaveData {
  readonly score: number;
  readonly rewardedCount: number;
}

export const INITIAL_STATE: GameState = { score: 0, rewardedCount: 0, hint: '点按钮 +1 分' };

const asCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

export const addScore = (state: GameState, amount: number): GameState => ({
  ...state, score: state.score + amount, hint: `+${amount} 分`,
});

export const rewardScore = (state: GameState, amount: number): GameState => ({
  ...state, score: state.score + amount, rewardedCount: state.rewardedCount + 1, hint: `看广告 +${amount} 分`,
});

export const withHint = (state: GameState, hint: string): GameState => ({ ...state, hint });

export const toSaveData = (state: GameState): SaveData => ({
  score: state.score, rewardedCount: state.rewardedCount,
});

/** 存档不可信：坏数据回落到初始状态，不抛错。 */
export const fromSaveData = (raw: unknown): GameState => {
  if (typeof raw !== 'object' || raw === null) return INITIAL_STATE;
  const data = raw as { score?: unknown; rewardedCount?: unknown };
  const score = asCount(data.score);
  return { score, rewardedCount: asCount(data.rewardedCount), hint: score > 0 ? `从存档恢复 ${score} 分` : INITIAL_STATE.hint };
};

export const formatScore = (score: number, goal: number): string => `分数 ${score} / ${goal}`;
