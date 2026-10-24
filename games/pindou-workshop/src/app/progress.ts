/**
 * 存档：把进度接到 runtime 的 `core/save`（双槽原子写 + 版本迁移都在 runtime 里）。
 *
 * **存储 key 固定**（任务书要求）：命名空间 `pindou-workshop.` → 主槽
 * `pindou-workshop.data`、待提交槽 `pindou-workshop.data.pending`。
 * 改存档结构必须 `SAVE_VERSION + 1` 并给迁移，否则老玩家存档会丢。
 *
 * 为什么读取要 sanitize：localStorage / wx 的 KV 是玩家可以手改的（web 直接改
 * DevTools），任何字段都可能是脏的。脏数据不许让游戏崩，回落到默认值就行。
 */

import { createSave } from './deps';
import { FULL_ITEMS } from './items';
import type { GameState, LevelBest, Progress } from './state';
import { LEVELS } from './levels';

/** 存储命名空间（固定，别改：改了等于清档） */
export const SAVE_NAMESPACE = 'pindou-workshop.';
/** 存档 schema 版本 */
export const SAVE_VERSION = 1;

export const DEFAULT_PROGRESS: Progress = {
  unlocked: 1,
  clears: 0,
  best: {},
  sound: true,
  music: true,
  itemLeft: FULL_ITEMS,
};

const clampLevel = (v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 1;
  return Math.max(1, Math.min(LEVELS.length, n));
};

const num = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

/** 把任意脏数据洗成合法进度（永不抛错） */
export const sanitizeProgress = (raw: unknown): Progress => {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PROGRESS;
  const o = raw as Record<string, unknown>;
  const bestRaw = typeof o['best'] === 'object' && o['best'] !== null ? (o['best'] as Record<string, unknown>) : {};
  const best: Record<string, LevelBest> = {};
  for (const [k, v] of Object.entries(bestRaw)) {
    const id = Number(k);
    if (!Number.isFinite(id) || id < 1 || id > LEVELS.length) continue;
    if (typeof v !== 'object' || v === null) continue;
    const e = v as Record<string, unknown>;
    best[k] = { timeLeft: Math.max(0, num(e['timeLeft'], 0)), burnt: Math.max(0, Math.min(1, num(e['burnt'], 1))) };
  }
  const items = typeof o['itemLeft'] === 'object' && o['itemLeft'] !== null ? (o['itemLeft'] as Record<string, unknown>) : {};
  return {
    unlocked: clampLevel(o['unlocked']),
    clears: Math.max(0, Math.floor(num(o['clears'], 0))),
    best,
    sound: o['sound'] !== false,
    music: o['music'] !== false,
    itemLeft: {
      hint: Math.max(0, Math.min(FULL_ITEMS.hint, Math.floor(num(items['hint'], FULL_ITEMS.hint)))),
      time: Math.max(0, Math.min(FULL_ITEMS.time, Math.floor(num(items['time'], FULL_ITEMS.time)))),
      slot: Math.max(0, Math.min(FULL_ITEMS.slot, Math.floor(num(items['slot'], FULL_ITEMS.slot)))),
    },
  };
};

/** 从状态抽进度（写档用；单局盘面状态不存，刷新后回首页重开） */
export const toProgress = (state: GameState): Progress => ({
  unlocked: state.unlocked,
  clears: state.clears,
  best: state.best,
  sound: state.sound,
  music: state.music,
  itemLeft: state.itemLeft,
});

export interface ProgressStore {
  /** 读档；没有存档返回 null */
  load(): Progress | null;
  /** 写档（状态好就洗一遍再写）；返回是否成功 */
  store(state: GameState): boolean;
  clear(): void;
  /** 体检（`mg doctor` 与测试用） */
  inspect(): { status: string; storedVersion: number | null };
  /** 固定 key（测试与验收脚本直接读它） */
  readonly key: string;
}

/** 只需要 KV 存储：测试传内存实现即可（结构化类型，不依赖整个适配器） */
export interface ProgressPlatform {
  readonly storage: {
    get<T>(key: string): T | null;
    set<T>(key: string, value: T): boolean;
    remove(key: string): void;
  };
}

export const createProgress = (platform: ProgressPlatform): ProgressStore => {
  const save = createSave({ namespace: SAVE_NAMESPACE, version: SAVE_VERSION, store: platform.storage });
  return {
    key: `${SAVE_NAMESPACE}data`,
    load(): Progress | null {
      const raw = save.load<unknown>();
      if (raw === null || raw === undefined) return null;
      return sanitizeProgress(raw);
    },
    store(state: GameState): boolean {
      return save.save(sanitizeProgress(toProgress(state)));
    },
    clear(): void {
      save.clear();
    },
    inspect(): { status: string; storedVersion: number | null } {
      const r = save.inspect();
      return { status: r.status, storedVersion: r.storedVersion };
    },
  };
};
