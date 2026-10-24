/**
 * 快照层测试：布局树归一化、存盘/读回、版本与名字校验。
 *
 * 用临时目录，测完删掉；不依赖游戏、不依赖浏览器。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SNAPSHOT_VERSION,
  assertSnapshotName,
  listSnapshots,
  normalizeLayout,
  readSnapshot,
  saveSnapshot,
  snapshotPath,
} from './snapshot';
import type { McpSnapshot } from './snapshot';

const dirs: string[] = [];

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'mg-snapshot-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const makeSnapshot = (name: string): McpSnapshot => ({
  version: SNAPSHOT_VERSION,
  name,
  at: '2026-10-20T14:00:00.000Z',
  game: { platform: 'web', screen: { width: 390, height: 844, dpr: 2 } },
  canvas: { screen: { width: 390, height: 844, dpr: 2 }, fps: 60, drawsPerFrame: 12 },
  layout: { primary: { x: 20, y: 680, w: 168, h: 63 } },
  draws: [{ z: 0, kind: 'rect', rect: { x: 20, y: 680, w: 168, h: 63 }, color: '#123456' }],
  frame: { frame: 7, at: 1234, ms: 1.5, count: 1 },
  state: { phase: 'home' },
});

describe('normalizeLayout：把任意布局对象压成 path → Rect', () => {
  it('扁平 Rect、数组、嵌套对象都能归一化，非矩形字段跳过', () => {
    const layout = normalizeLayout({
      safe: { x: 0, y: 0, w: 390, h: 844 },
      title: { x: 19.5, y: 21.1, w: 351, h: 42.2 },
      grid: { x: 50, y: 211, w: 290, h: 270 },
      cell: 48,
      cards: [
        { x: 19.5, y: 515, w: 167.6, h: 67.5 },
        { x: 202.9, y: 515, w: 167.6, h: 67.5 },
      ],
      nested: { panel: { x: 1, y: 2, w: 3, h: 4 } },
      bad: { x: 'NaN', y: 0, w: 1, h: 1 },
    });
    expect(layout['safe']).toEqual({ x: 0, y: 0, w: 390, h: 844 });
    expect(layout['title']?.w).toBe(351);
    expect(layout['grid']?.h).toBe(270);
    expect(layout['cards[0]']?.w).toBe(167.6);
    expect(layout['cards[1]']?.x).toBe(202.9);
    expect(layout['nested.panel']).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(layout['cell']).toBeUndefined();
    expect(layout['bad']).toBeUndefined();
  });

  it('null / 数字 / 字符串布局返回空表，不抛错', () => {
    expect(normalizeLayout(null)).toEqual({});
    expect(normalizeLayout(42)).toEqual({});
    expect(normalizeLayout('layout')).toEqual({});
  });
});

describe('快照存取：磁盘 → 另一个进程能读回', () => {
  it('save 后文件存在，read 回来内容一致（含 layout/draws/frame）', () => {
    const dir = tempDir();
    const snapshot = makeSnapshot('baseline');
    const file = saveSnapshot(dir, snapshot);
    expect(file).toBe(snapshotPath(dir, 'baseline'));
    expect(existsSync(file)).toBe(true);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as McpSnapshot;
    expect(raw.version).toBe(SNAPSHOT_VERSION);
    expect(raw.layout['primary']?.w).toBe(168);
    const back = readSnapshot(dir, 'baseline');
    expect(back.state).toEqual({ phase: 'home' });
    expect(back.draws).toHaveLength(1);
    expect(back.frame?.frame).toBe(7);
  });

  it('list 按时间新→旧，带文件路径与条数', () => {
    const dir = tempDir();
    saveSnapshot(dir, makeSnapshot('old'));
    saveSnapshot(dir, { ...makeSnapshot('new'), at: '2026-10-21T09:00:00.000Z' });
    const items = listSnapshots(dir);
    expect(items.map((item) => item.name)).toEqual(['new', 'old']);
    expect(items[0]?.layoutCount).toBe(1);
    expect(items[0]?.drawCount).toBe(1);
    expect(items[0]?.bytes).toBeGreaterThan(0);
  });

  it('目录不存在时 list 返回空数组', () => {
    expect(listSnapshots(join(tempDir(), 'nope'))).toEqual([]);
  });

  it('版本不匹配拒绝读取，报中文错误', () => {
    const dir = tempDir();
    saveSnapshot(dir, { ...makeSnapshot('bad'), version: 99 } as McpSnapshot);
    expect(() => readSnapshot(dir, 'bad')).toThrow(/版本不匹配/);
  });

  it('文件不存在时报中文错误并提示先 snapshot', () => {
    expect(() => readSnapshot(tempDir(), 'missing')).toThrow(/快照读不出来/);
  });

  it('快照名挡住路径穿越（../ 与绝对路径）', () => {
    expect(() => assertSnapshotName('../etc/passwd')).toThrow(/快照名只允许/);
    expect(() => assertSnapshotName('C:/secret')).toThrow(/快照名只允许/);
    expect(assertSnapshotName('baseline-1.a')).toBe('baseline-1.a');
  });
});
