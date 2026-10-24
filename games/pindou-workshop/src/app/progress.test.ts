// 存档：固定 key、脏数据洗白、往返恢复、进度抽取
import { expect, it } from 'vitest';
import { DEFAULT_PROGRESS, SAVE_NAMESPACE, SAVE_VERSION, createProgress, sanitizeProgress, toProgress } from './progress';
import { FULL_ITEMS } from './items';
import { INITIAL_STATE, reduce } from './state';
import type { PlatformAdapter } from './deps';

/** 内存 KV（模拟 localStorage / wx KV；接口与 platform.storage 一致） */
const fakeStorage = () => {
  const map = new Map<string, unknown>();
  return {
    map,
    get<T>(key: string): T | null {
      return (map.has(key) ? (map.get(key) as T) : null);
    },
    set<T>(key: string, value: T): boolean {
      map.set(key, value);
      return true;
    },
    remove(key: string): void {
      map.delete(key);
    },
  };
};

const progressOf = (store: ReturnType<typeof fakeStorage>) =>
  createProgress({ storage: store } as unknown as PlatformAdapter);

it('存储 key 固定：pindou-workshop.data（改了就等于清档）', () => {
  const p = progressOf(fakeStorage());
  expect(SAVE_NAMESPACE).toBe('pindou-workshop.');
  expect(p.key).toBe('pindou-workshop.data');
  expect(SAVE_VERSION).toBe(1);
});

it('首次启动没存档 → load() 返回 null（不是抛错）', () => {
  expect(progressOf(fakeStorage()).load()).toBeNull();
});

it('脏数据洗白：非法字段回落默认值，永不抛错', () => {
  expect(sanitizeProgress(null)).toEqual(DEFAULT_PROGRESS);
  expect(sanitizeProgress('不是对象')).toEqual(DEFAULT_PROGRESS);
  const dirty = sanitizeProgress({
    unlocked: 999,
    clears: -5,
    best: { '2': { timeLeft: -1, burnt: 9 }, x: { timeLeft: 5, burnt: 0 }, '99': { timeLeft: 3, burnt: 0.2 } },
    sound: false,
    music: 'yes',
    itemLeft: { hint: 99, time: -2, slot: 1 },
  });
  expect(dirty.unlocked).toBe(12); // 钳到关卡总数
  expect(dirty.clears).toBe(0);
  expect(dirty.sound).toBe(false);
  expect(dirty.music).toBe(true); // 非 false 一律当开
  expect(dirty.best['2']).toEqual({ timeLeft: 0, burnt: 1 });
  expect(dirty.best['99']).toBeUndefined(); // 越界关卡丢弃
  expect(dirty.best['x']).toBeUndefined();
  expect(dirty.itemLeft).toEqual({ hint: 3, time: 0, slot: 1 });
});

it('存档往返：通关一关 + 改设置 → 新实例读回同样的进度', () => {
  const store = fakeStorage();
  const first = progressOf(store);
  // 造一个「通关第 1 关」的真实状态
  let s = reduce(INITIAL_STATE, { kind: 'startLevel', levelId: 1 });
  s = { ...s, screen: 'iron', iron: { ...s.iron, targets: [0], cells: [1 as const] } };
  s = reduce(s, { kind: 'ironTick', dt: 0.01 });
  expect(s.outcome).toBe('win');
  s = reduce(s, { kind: 'toggleSound' }); // 声音关掉（sfx + bgm 同值）
  expect(first.store(s)).toBe(true);

  // 「刷新页面」= 新建一份 store（同一份底层 KV）
  const second = progressOf(store);
  const loaded = second.load();
  expect(loaded).not.toBeNull();
  expect(loaded!.unlocked).toBe(2);
  expect(loaded!.clears).toBe(1);
  expect(loaded!.sound).toBe(false);
  expect(loaded!.music).toBe(false);
  expect(loaded!.best['1']).toBeDefined();
  // 恢复到状态里
  const restored = reduce(INITIAL_STATE, { kind: 'restore', progress: loaded! });
  expect(restored.unlocked).toBe(2);
  expect(restored.sound).toBe(false);
});

it('toProgress：只抽进度，不带单局盘面', () => {
  const s = reduce(INITIAL_STATE, { kind: 'startLevel', levelId: 1 });
  const p = toProgress(s);
  expect(p.itemLeft).toEqual(FULL_ITEMS);
  expect(Object.keys(p).sort()).toEqual(['best', 'clears', 'itemLeft', 'music', 'sound', 'unlocked']);
});

it('inspect：空存储报 empty，写过后报 ok', () => {
  const store = fakeStorage();
  const p = progressOf(store);
  expect(p.inspect().status).toBe('empty');
  p.store(reduce(INITIAL_STATE, { kind: 'startLevel', levelId: 1 }));
  const after = p.inspect();
  expect(after.status).toBe('ok');
  expect(after.storedVersion).toBe(SAVE_VERSION);
});
