import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orientationOf, resolveOptions } from './options';
import type { MgPluginOptions, MgTarget } from './types';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mg-options-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/main.ts'), 'export const a = 1;\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const plugin = (over: Partial<MgPluginOptions> = {}): MgPluginOptions => ({
  target: 'web' as MgTarget,
  root,
  design: { width: 960, height: 640 },
  ...over,
});

describe('resolveOptions', () => {
  it('默认 assets / assets-pack / build/<target>，入口自动找 src/main.ts', () => {
    const resolved = resolveOptions(plugin());
    expect(resolved.assetsDir).toBe(join(root, 'assets'));
    expect(resolved.packDir).toBe(join(root, 'assets-pack'));
    expect(resolved.outDir).toBe(join(root, 'build', 'web'));
    expect(resolved.entry).toBe(join(root, 'src/main.ts'));
    expect(resolved.fit).toBe('contain');
  });

  it('三端默认产物目录按 target 分开', () => {
    expect(resolveOptions(plugin({ target: 'wx' })).outDir).toBe(join(root, 'build', 'wx'));
    expect(resolveOptions(plugin({ target: 'tt' })).outDir).toBe(join(root, 'build', 'tt'));
  });

  it('显式 outDir / assetsDir 覆盖默认值', () => {
    const resolved = resolveOptions(plugin({ outDir: 'dist/out', assetsDir: 'art' }));
    expect(resolved.outDir).toBe(join(root, 'dist/out'));
    expect(resolved.assetsDir).toBe(join(root, 'art'));
  });

  it('target 非法抛错', () => {
    expect(() => resolveOptions(plugin({ target: 'xx' as MgTarget }))).toThrow(/target/);
  });

  it('design 非正数抛错', () => {
    expect(() => resolveOptions(plugin({ design: { width: 0, height: 640 } }))).toThrow(/design/);
  });

  it('找不到入口抛错', () => {
    const empty = mkdtempSync(join(tmpdir(), 'mg-empty-'));
    try {
      expect(() => resolveOptions(plugin({ root: empty }))).toThrow(/入口/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('orientationOf 按宽高比判方向', () => {
    expect(orientationOf(resolveOptions(plugin()))).toBe('landscape');
    const portrait = resolveOptions(plugin({ design: { width: 390, height: 844 } }));
    expect(orientationOf(portrait)).toBe('portrait');
  });
});
