import { describe, expect, it } from 'vitest';
import type { SaveEnvelope, SaveMigration, SaveOptions } from './contract';
import { createSave, DEFAULT_NAMESPACE, saveKeys } from './index';

const V = 3;
const keys = saveKeys();

interface MockStore {
  readonly data: Map<string, unknown>;
  readonly ops: string[];
  readonly store: SaveOptions['store'];
  readonly failSet: Set<string>;
  readonly failGet: Set<string>;
}

function makeStore(): MockStore {
  const data = new Map<string, unknown>();
  const ops: string[] = [];
  const failSet = new Set<string>();
  const failGet = new Set<string>();
  const store: SaveOptions['store'] = {
    get<T>(key: string): T | null {
      if (failGet.has(key)) throw new Error('存储读取失败');
      const value = data.get(key);
      return value === undefined ? null : (value as T);
    },
    set<T>(key: string, value: T): boolean {
      ops.push(`set:${key}`);
      if (failSet.has(key)) return false;
      data.set(key, value);
      return true;
    },
    remove(key: string): void {
      ops.push(`remove:${key}`);
      data.delete(key);
    },
  };
  return { data, ops, store, failSet, failGet };
}

const envelope = (version: number, data: unknown): SaveEnvelope => ({ version, savedAt: 1000, data });
const jsonOf = (version: number, data: unknown): string => JSON.stringify(envelope(version, data));
const nOf = (data: unknown): number => (data as { n: number }).n;

const M12: SaveMigration = { from: 1, to: 2, migrate: (data) => ({ n: nOf(data) + 1 }) };
const M23: SaveMigration = { from: 2, to: 3, migrate: (data) => ({ n: nOf(data) * 10 }) };

const makeSave = (
  mock: MockStore,
  version = V,
  migrations: readonly SaveMigration[] = [M12, M23],
  namespace?: string,
) => createSave({ version, migrations, store: mock.store, now: () => 4242, namespace });

describe('createSave：读写往返', () => {
  it('空存储：load 返回 null、inspect 是 empty', () => {
    const mock = makeStore();
    const save = makeSave(mock);
    expect(save.load()).toBeNull();
    expect(save.inspect()).toMatchObject({ status: 'empty', storedVersion: null, currentVersion: V });
    expect(save.version).toBe(V);
  });

  it('save 后 load 原样返回，信封带版本与时间戳', () => {
    const mock = makeStore();
    const save = makeSave(mock);
    expect(save.save({ n: 7 })).toBe(true);
    expect(save.load<{ n: number }>()).toEqual({ n: 7 });
    expect(save.inspect()).toMatchObject({ status: 'ok', storedVersion: V });
    const stored = JSON.parse(mock.data.get(keys.main) as string) as SaveEnvelope;
    expect(stored).toEqual({ version: V, savedAt: 4242, data: { n: 7 } });
    expect(mock.data.has(keys.pending)).toBe(false);
  });

  it('双槽写入顺序：pending → 主槽 → 删 pending', () => {
    const mock = makeStore();
    expect(makeSave(mock).save({ n: 1 })).toBe(true);
    expect(mock.ops).toEqual([`set:${keys.pending}`, `set:${keys.main}`, `remove:${keys.pending}`]);
  });

  it('自定义 namespace 决定键名', () => {
    const mock = makeStore();
    expect(saveKeys('game.a.')).toEqual({ main: 'game.a.data', pending: 'game.a.data.pending' });
    const save = makeSave(mock, V, [M12, M23], 'game.a.');
    expect(save.save({ n: 1 })).toBe(true);
    expect(mock.data.has('game.a.data')).toBe(true);
    expect(mock.data.has('game.a.data.pending')).toBe(false);
    expect(save.load<{ n: number }>()).toEqual({ n: 1 });
    expect(DEFAULT_NAMESPACE).toBe('mg.save.');
  });

  it('不可序列化数据：返回 false，不写任何槽，旧档保持', () => {
    const mock = makeStore();
    const save = makeSave(mock);
    mock.data.set(keys.main, jsonOf(V, { n: 1 }));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(save.save(circular)).toBe(false);
    expect(mock.ops).toEqual([]);
    expect(save.load<{ n: number }>()).toEqual({ n: 1 });
  });
});

describe('createSave：原子性与回滚', () => {
  it('pending 写失败：返回 false，主槽不动，pending 被清掉', () => {
    const mock = makeStore();
    const save = makeSave(mock);
    mock.data.set(keys.main, jsonOf(V, { n: 1 }));
    mock.failSet.add(keys.pending);
    expect(save.save({ n: 9 })).toBe(false);
    expect(mock.data.has(keys.pending)).toBe(false);
    expect(save.load<{ n: number }>()).toEqual({ n: 1 });
  });

  it('主槽写失败：返回 false，pending 回滚，旧主槽完整', () => {
    const mock = makeStore();
    const save = makeSave(mock);
    mock.data.set(keys.main, jsonOf(V, { n: 1 }));
    mock.failSet.add(keys.main);
    expect(save.save({ n: 9 })).toBe(false);
    expect(mock.data.has(keys.pending)).toBe(false);
    expect(save.load<{ n: number }>()).toEqual({ n: 1 });
  });

  it('clear 清空两个槽', () => {
    const mock = makeStore();
    const save = makeSave(mock);
    expect(save.save({ n: 1 })).toBe(true);
    save.clear();
    expect(save.load()).toBeNull();
    expect(save.inspect().status).toBe('empty');
  });
});

describe('createSave：损坏与恢复', () => {
  it('主槽坏 JSON：inspect 是 corrupt、load 返回 null 不抛错', () => {
    const mock = makeStore();
    const save = makeSave(mock);
    mock.data.set(keys.main, '{"version":1,"data":');
    expect(save.inspect()).toMatchObject({ status: 'corrupt', storedVersion: null });
    expect(() => save.load()).not.toThrow();
    expect(save.load()).toBeNull();
  });

  it('主槽坏 + pending 完好：inspect 报 recovered（不写盘），load 恢复并修复主槽', () => {
    const mock = makeStore();
    const save = makeSave(mock);
    mock.data.set(keys.main, '半截写入');
    mock.data.set(keys.pending, jsonOf(V, { n: 5 }));

    const inspected = save.inspect();
    expect(inspected).toMatchObject({ status: 'recovered', storedVersion: V });
    expect(inspected.message).toContain('pending');
    expect(mock.ops).toEqual([]); // 体检不修改数据

    expect(save.load<{ n: number }>()).toEqual({ n: 5 });
    expect(mock.data.has(keys.pending)).toBe(false);
    const repaired = JSON.parse(mock.data.get(keys.main) as string) as SaveEnvelope;
    expect(repaired.version).toBe(V);
    expect(save.inspect().status).toBe('ok');
  });

  it('主槽缺失 + pending 完好：报 recovered，load 从 pending 恢复', () => {
    const mock = makeStore();
    const save = makeSave(mock);
    mock.data.set(keys.pending, jsonOf(V, { n: 6 }));
    expect(save.inspect().status).toBe('recovered');
    expect(save.load<{ n: number }>()).toEqual({ n: 6 });
  });

  it('两槽都坏：corrupt，load 返回 null', () => {
    const mock = makeStore();
    const save = makeSave(mock);
    mock.data.set(keys.main, '不是 JSON');
    mock.data.set(keys.pending, '也不是');
    expect(save.inspect()).toMatchObject({ status: 'corrupt', storedVersion: null });
    expect(save.load()).toBeNull();
  });

  it('存储读取抛错：当坏档处理，不崩', () => {
    const mock = makeStore();
    const save = makeSave(mock);
    mock.failGet.add(keys.main);
    expect(save.load()).toBeNull();
    expect(save.inspect().status).toBe('corrupt');
  });
});

describe('createSave：版本迁移', () => {
  it('v1 → v3 依次跑两步迁移（+1 再 ×10）', () => {
    const mock = makeStore();
    const save = makeSave(mock);
    mock.data.set(keys.main, jsonOf(1, { n: 1 }));
    expect(save.inspect()).toMatchObject({ status: 'migrated', storedVersion: 1, currentVersion: V });
    expect(mock.ops).toEqual([]); // 迁移是纯计算，体检不写盘
    expect(save.load<{ n: number }>()).toEqual({ n: 20 });
  });

  it('缺迁移步骤：load 返回 null、inspect 是 corrupt', () => {
    const mock = makeStore();
    const save = makeSave(mock, V, [M12]);
    mock.data.set(keys.main, jsonOf(1, { n: 1 }));
    expect(save.load()).toBeNull();
    expect(save.inspect()).toMatchObject({ status: 'corrupt', storedVersion: 1 });
  });

  it('存档版本高于当前：拒绝降级，判 corrupt', () => {
    const mock = makeStore();
    const save = makeSave(mock);
    mock.data.set(keys.main, jsonOf(99, { n: 1 }));
    expect(save.load()).toBeNull();
    expect(save.inspect()).toMatchObject({ status: 'corrupt', storedVersion: 99 });
  });

  it('非法迁移链（to ≤ from 或越过当前版本）判 corrupt', () => {
    const loopMock = makeStore();
    loopMock.data.set(keys.main, jsonOf(1, { n: 1 }));
    const loopSave = makeSave(loopMock, V, [{ from: 1, to: 1, migrate: (data) => data }]);
    expect(loopSave.load()).toBeNull();
    expect(loopSave.inspect().message).toContain('迁移链非法');

    const jumpMock = makeStore();
    jumpMock.data.set(keys.main, jsonOf(1, { n: 1 }));
    const jumpSave = makeSave(jumpMock, V, [{ from: 1, to: 4, migrate: (data) => data }]);
    expect(jumpSave.load()).toBeNull();
    expect(jumpSave.inspect().message).toContain('越过当前版本');
  });
});

describe('createSave：存储形态兼容', () => {
  it('值型存储（wx 直接存对象）与双重字符串都能读', () => {
    const objectStore = makeStore();
    objectStore.data.set(keys.main, envelope(V, { n: 7 })); // wx 存对象
    expect(makeSave(objectStore).load<{ n: number }>()).toEqual({ n: 7 });

    const doubleStore = makeStore();
    doubleStore.data.set(keys.main, JSON.stringify(jsonOf(V, { n: 8 }))); // 平台又 stringify 一次
    expect(makeSave(doubleStore).load<{ n: number }>()).toEqual({ n: 8 });
  });
});
