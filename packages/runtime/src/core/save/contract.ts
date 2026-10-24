/**
 * 存档契约。
 *
 * 为什么要有 `version` 与迁移：游戏会迭代，存档结构一定会变。没有迁移机制的
 * 结果只有两种——老玩家存档丢失，或者业务代码里长出一堆 `if (v === 2)`。
 *
 * 为什么「原子写」要写进契约：三端只有同步 KV（`localStorage` / `wx.setStorageSync`），
 * 没有事务。断电/闪退可能只写了一半。做法是**双槽写入**：先写 `key.pending`，
 * 成功后再覆盖 `key`，最后删 `pending`。读取时若 `key` 解析失败而 `pending` 完好，
 * 用 `pending` 恢复。这是在没有事务的平台上能做到的最强保证。
 *
 * 为什么 `load()` 返回 `null` 而不是抛错：首次启动没有存档是正常路径。
 * 真正的损坏要能被 `doctor` 查出来，所以额外提供 `inspect()`。
 */

/** 存储里放的封装（业务数据包在 `data` 里）。 */
export interface SaveEnvelope {
  readonly version: number;
  readonly savedAt: number;
  readonly data: unknown;
}

/** 一次版本迁移。迁移函数是纯函数：输入老数据，输出新数据。 */
export interface SaveMigration {
  readonly from: number;
  readonly to: number;
  migrate(data: unknown): unknown;
}

export interface SaveOptions {
  /** 存储键名前缀，默认 `'mg.save.'`；一个游戏一个命名空间 */
  readonly namespace?: string;
  /** 当前 schema 版本。改结构必须 +1 并给迁移 */
  readonly version: number;
  /** 迁移链。必须能覆盖 version 1..当前版本-1 的每一步 */
  readonly migrations?: readonly SaveMigration[];
  /** 由 platform 提供的同步 KV */
  readonly store: {
    get<T>(key: string): T | null;
    set<T>(key: string, value: T): boolean;
    remove(key: string): void;
  };
  /** 时间源，默认 Date.now */
  readonly now?: () => number;
}

/** 存档体检结果，供 `mg doctor` 与测试使用。 */
export interface SaveInspect {
  /** 'empty' 首次启动；'ok' 正常；'migrated' 迁移过；'recovered' 从 pending 恢复；'corrupt' 无法解析 */
  readonly status: 'empty' | 'ok' | 'migrated' | 'recovered' | 'corrupt';
  /** 存储里的原始版本（有的话） */
  readonly storedVersion: number | null;
  readonly currentVersion: number;
  /** 状态说明，可直接进日志 */
  readonly message: string;
}

export interface SaveService {
  /** 当前 schema 版本 */
  readonly version: number;

  /**
   * 读档。没有存档或解析失败返回 null（不抛错）。
   * 内部会按需跑迁移链。
   */
  load<T>(): T | null;

  /**
   * 写档。返回是否成功。
   * 实现必须走双槽（pending → active → 删 pending）。
   */
  save<T>(data: T): boolean;

  /** 删除存档（两个槽都清）。 */
  clear(): void;

  /** 体检，不修改数据。 */
  inspect(): SaveInspect;
}

export type CreateSave = (opts: SaveOptions) => SaveService;
