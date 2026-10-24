/**
 * 存档实现：双槽原子写 + 版本迁移链 + 体检。
 *
 * 存储里放的是 JSON 字符串：三端同步 KV 都接受字符串，序列化放在这一层，
 * 半截写入（只写了 pending）才是可检测的坏档，而不是静默读到半份数据。
 *
 * 双槽协议：save 先写 `main.pending` → 成功才覆盖 `main` → 最后删 pending。
 * load 时主槽坏了而 pending 完好，就用 pending 恢复并写回主槽（报 recovered）。
 *
 * 所有状态都在闭包里（每个 createSave 一份），没有模块级可变状态。
 */

import type {
  CreateSave,
  SaveEnvelope,
  SaveInspect,
  SaveMigration,
  SaveOptions,
  SaveService,
} from './contract';

/** 默认命名空间。一个游戏一个前缀，避免多游戏共用一个包时串档。 */
export const DEFAULT_NAMESPACE = 'mg.save.';
/** 主槽后缀 */
const MAIN_SUFFIX = 'data';
/** 待提交槽后缀（相对主槽） */
const PENDING_SUFFIX = '.pending';

export interface SaveKeys {
  readonly main: string;
  readonly pending: string;
}

/** 键名推导：`<namespace>data` 与 `<namespace>data.pending`。导出便于 doctor 排查。 */
export const saveKeys = (namespace?: string): SaveKeys => {
  const main = `${namespace ?? DEFAULT_NAMESPACE}${MAIN_SUFFIX}`;
  return { main, pending: `${main}${PENDING_SUFFIX}` };
};

type SaveStore = SaveOptions['store'];

const resolveVersion = (version: number): number =>
  Number.isFinite(version) && version > 0 ? Math.floor(version) : 1;

const readNow = (now: () => number): number => {
  const value = now();
  return Number.isFinite(value) ? value : 0;
};

const writeJson = (store: SaveStore, key: string, json: string): boolean => {
  try {
    return store.set<string>(key, json) === true;
  } catch {
    return false;
  }
};

const removeKey = (store: SaveStore, key: string): void => {
  try {
    store.remove(key);
  } catch {
    // 清理失败不改变结果；残留 pending 会在下次写入时被覆盖
  }
};

const isEnvelope = (value: unknown): value is SaveEnvelope => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { version?: unknown; savedAt?: unknown; data?: unknown };
  if (typeof candidate.version !== 'number' || !Number.isFinite(candidate.version)) return false;
  if (!Object.prototype.hasOwnProperty.call(candidate, 'data')) return false;
  if (candidate.savedAt !== undefined && typeof candidate.savedAt !== 'number') return false;
  return true;
};

type SlotRead =
  | { readonly kind: 'empty' }
  | { readonly kind: 'bad'; readonly message: string }
  | { readonly kind: 'envelope'; readonly envelope: SaveEnvelope };

type MigrateOutcome =
  | { readonly ok: true; readonly data: unknown; readonly migrated: boolean }
  | { readonly ok: false; readonly message: string };

export const createSave: CreateSave = (opts: SaveOptions): SaveService => {
  const store = opts.store;
  const currentVersion = resolveVersion(opts.version);
  const migrations: readonly SaveMigration[] = opts.migrations ?? [];
  const now = opts.now ?? ((): number => Date.now());
  const keys = saveKeys(opts.namespace);

  /** 读一个槽并归一成「空 / 坏 / 合法信封」。兼容字符串型与值型两种存储。 */
  const readSlot = (key: string): SlotRead => {
    let raw: unknown;
    try {
      raw = store.get<unknown>(key);
    } catch {
      return { kind: 'bad', message: '存储读取抛错' };
    }
    if (raw === null || raw === undefined) return { kind: 'empty' };

    let value: unknown = raw;
    // 字符串型存储（web localStorage）与值型存储（wx 直接存对象）都接受；
    // 最多解两层，兼容「平台自己又 stringify 了一次」的实现。
    for (let depth = 0; depth < 2 && typeof value === 'string'; depth += 1) {
      try {
        value = JSON.parse(value) as unknown;
      } catch {
        return { kind: 'bad', message: '存档不是合法 JSON' };
      }
    }
    if (!isEnvelope(value)) return { kind: 'bad', message: '存档结构不合法（缺 version 或 data）' };
    return { kind: 'envelope', envelope: value };
  };

  /** 按 from → to 依次跑迁移链；缺步 / 越级 / 成环一律判坏档，不猜数据。 */
  const migrateToCurrent = (envelope: SaveEnvelope): MigrateOutcome => {
    let version = envelope.version;
    let data = envelope.data;
    if (version === currentVersion) return { ok: true, data, migrated: false };
    if (version > currentVersion) {
      return { ok: false, message: `存档版本 v${version} 高于当前 v${currentVersion}，拒绝降级` };
    }

    const limit = migrations.length + 1;
    for (let step = 0; step < limit; step += 1) {
      if (version === currentVersion) return { ok: true, data, migrated: true };
      const migration = migrations.find((m) => m.from === version);
      if (migration === undefined) {
        return { ok: false, message: `缺少 v${version} → v${version + 1} 的迁移` };
      }
      if (migration.to <= version) {
        return { ok: false, message: `迁移链非法：v${migration.from} → v${migration.to}` };
      }
      data = migration.migrate(data);
      version = migration.to;
      if (version > currentVersion) {
        return { ok: false, message: `迁移链越过当前版本 v${currentVersion}（到 v${version}）` };
      }
    }
    return { ok: false, message: '迁移链过长或成环' };
  };

  /** 把恢复出来的数据写回主槽（原子写同样走双槽）。 */
  const repair = (data: unknown): void => {
    const envelope: SaveEnvelope = { version: currentVersion, savedAt: readNow(now), data };
    let json: string;
    try {
      json = JSON.stringify(envelope);
    } catch {
      return;
    }
    if (writeJson(store, keys.main, json)) removeKey(store, keys.pending);
  };

  const load = <T>(): T | null => {
    const main = readSlot(keys.main);
    if (main.kind === 'envelope') {
      const outcome = migrateToCurrent(main.envelope);
      return outcome.ok ? (outcome.data as T) : null;
    }

    // 主槽坏了或缺失：看 pending 能否恢复（断电只写了一槽的常见情况）
    const pending = readSlot(keys.pending);
    if (pending.kind !== 'envelope') return null;
    const outcome = migrateToCurrent(pending.envelope);
    if (!outcome.ok) return null;
    repair(outcome.data);
    return outcome.data as T;
  };

  const save = <T>(data: T): boolean => {
    const envelope: SaveEnvelope = {
      version: currentVersion,
      savedAt: readNow(now),
      data: data === undefined ? null : data,
    };
    let json: string;
    try {
      json = JSON.stringify(envelope);
    } catch {
      return false; // 循环引用 / BigInt 等不可序列化：不写任何槽，旧存档保持完整
    }

    // 双槽写入：pending 先落盘 → 覆盖主槽 → 删 pending；任何一步失败都回滚
    if (!writeJson(store, keys.pending, json)) {
      removeKey(store, keys.pending);
      return false;
    }
    if (!writeJson(store, keys.main, json)) {
      removeKey(store, keys.pending);
      return false;
    }
    removeKey(store, keys.pending);
    return true;
  };

  const clear = (): void => {
    removeKey(store, keys.main);
    removeKey(store, keys.pending);
  };

  const inspect = (): SaveInspect => {
    const main = readSlot(keys.main);
    const pending = readSlot(keys.pending);

    if (main.kind === 'envelope') {
      const storedVersion = main.envelope.version;
      const outcome = migrateToCurrent(main.envelope);
      if (!outcome.ok) {
        return { status: 'corrupt', storedVersion, currentVersion, message: `主槽无法使用：${outcome.message}` };
      }
      if (outcome.migrated) {
        return {
          status: 'migrated',
          storedVersion,
          currentVersion,
          message: `存档 v${storedVersion} 已迁移到 v${currentVersion}`,
        };
      }
      return { status: 'ok', storedVersion, currentVersion, message: '存档正常' };
    }

    if (pending.kind === 'envelope') {
      const storedVersion = pending.envelope.version;
      const outcome = migrateToCurrent(pending.envelope);
      if (!outcome.ok) {
        return {
          status: 'corrupt',
          storedVersion,
          currentVersion,
          message: `主槽不可用，pending 也无法使用：${outcome.message}`,
        };
      }
      return {
        status: 'recovered',
        storedVersion,
        currentVersion,
        message:
          main.kind === 'bad'
            ? `主槽损坏（${main.message}），可从 pending 恢复`
            : '主槽缺失但 pending 完好，可从 pending 恢复',
      };
    }

    if (main.kind === 'empty' && pending.kind === 'empty') {
      return { status: 'empty', storedVersion: null, currentVersion, message: '没有存档（首次启动）' };
    }

    const details: string[] = [];
    if (main.kind === 'bad') details.push(`主槽：${main.message}`);
    if (pending.kind === 'bad') details.push(`pending：${pending.message}`);
    return {
      status: 'corrupt',
      storedVersion: null,
      currentVersion,
      message: `存档无法解析（${details.join('；')}）`,
    };
  };

  return {
    version: currentVersion,
    load,
    save,
    clear,
    inspect,
  };
};
