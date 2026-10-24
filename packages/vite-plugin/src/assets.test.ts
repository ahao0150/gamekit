import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildManifest,
  declaredSubpackages,
  manifestCode,
  outPathOf,
  packageOf,
  pickAssets,
  walkAssets,
} from './assets';
import type { MgSubpackages, ResolvedOptions } from './types';

let root = '';

const write = (files: Record<string, number>): void => {
  for (const [rel, bytes] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, Buffer.alloc(bytes, 1));
  }
};

const options = (subpackages: MgSubpackages = {}): ResolvedOptions => ({
  target: 'web',
  root,
  design: { width: 960, height: 640 },
  fit: 'contain',
  entry: join(root, 'src/main.ts'),
  assetsDir: join(root, 'assets'),
  packDir: join(root, 'assets-pack'),
  subpackages,
  outDir: join(root, 'build/web'),
  title: 't',
  projectName: 't',
  atlas: null,
  economyDir: null,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mg-assets-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('walkAssets', () => {
  it('只收白名单扩展名，目录缺失返回空', () => {
    write({ 'assets/a.png': 10, 'assets/b.txt': 10, 'assets/c.mp3': 10 });
    const rels = walkAssets(join(root, 'assets')).map((file) => file.rel);
    expect(rels).toEqual(['a.png', 'c.mp3']);
    expect(walkAssets(join(root, 'missing'))).toEqual([]);
  });
});

describe('pickAssets 择优', () => {
  it('同名 png/webp 只打较小的那份', () => {
    write({ 'assets/ui/btn.png': 500, 'assets/ui/btn.webp': 300 });
    const { assets, warnings } = pickAssets(options());
    expect(assets).toHaveLength(1);
    expect(assets[0]?.rel).toBe('ui/btn.webp');
    expect(warnings).toEqual([]);
  });

  it('png 比 webp 还小时打 png 并告警（过期版本隐患）', () => {
    write({ 'assets/ui/btn.png': 100, 'assets/ui/btn.webp': 400 });
    const { assets, warnings } = pickAssets(options());
    expect(assets[0]?.rel).toBe('ui/btn.png');
    expect(warnings.join()).toContain('png 比 webp 小');
  });

  it('0 字节文件跳过并告警', () => {
    write({ 'assets/ui/empty.png': 0, 'assets/ui/ok.png': 20 });
    const { assets, warnings } = pickAssets(options());
    expect(assets.map((a) => a.rel)).toEqual(['ui/ok.png']);
    expect(warnings.join()).toContain('0 字节');
  });

  it('assets-pack 同名图片顶替 assets 原图', () => {
    write({ 'assets/bg/far.png': 900, 'assets-pack/bg/far.webp': 120 });
    const { assets } = pickAssets(options());
    expect(assets).toHaveLength(1);
    expect(assets[0]?.rel).toBe('bg/far.webp');
    expect(assets[0]?.bytes).toBe(120);
  });

  it('assets-pack 的 mp3 顶替同名 wav', () => {
    write({ 'assets/audio/bgm.wav': 900, 'assets-pack/audio/bgm.mp3': 300 });
    const { assets } = pickAssets(options());
    expect(assets.map((a) => a.rel)).toEqual(['audio/bgm.mp3']);
  });

  it('assets 内部同名 mp3 顶替 wav（无 pack 时）', () => {
    write({ 'assets/audio/bgm.wav': 900, 'assets/audio/bgm.mp3': 300 });
    const { assets } = pickAssets(options());
    expect(assets.map((a) => a.rel)).toEqual(['audio/bgm.mp3']);
  });
});

describe('分包', () => {
  it('前缀命中进分包，其余进主包', () => {
    write({ 'assets/bg/city_1.webp': 10, 'assets/ui/btn.webp': 10 });
    const { assets } = pickAssets(options({ city: ['bg/city_'] }));
    expect(assets.find((a) => a.rel === 'bg/city_1.webp')?.pkg).toBe('city');
    expect(assets.find((a) => a.rel === 'ui/btn.webp')?.pkg).toBeNull();
  });

  it('packageOf 按配置顺序取第一个命中', () => {
    const subpackages: MgSubpackages = { a: ['bg/'], b: ['bg/city_'] };
    expect(packageOf('bg/city_1.webp', subpackages)).toBe('a');
    expect(packageOf('ui/btn.webp', subpackages)).toBeNull();
  });

  it('空分包不声明（否则 wx/tt 构建报错）', () => {
    write({ 'assets/ui/btn.webp': 10 });
    const subpackages: MgSubpackages = { empty: ['nothing/'], used: ['ui/'] };
    const { assets } = pickAssets(options(subpackages));
    expect(declaredSubpackages(assets, subpackages)).toEqual(['used']);
  });

  it('分包资源的产物路径在 subpackages/<name>/ 下', () => {
    write({ 'assets/bg/city_1.webp': 10 });
    const { assets } = pickAssets(options({ city: ['bg/city_'] }));
    const asset = assets[0];
    expect(asset).toBeDefined();
    if (asset) expect(outPathOf(asset)).toBe('subpackages/city/assets/bg/city_1.webp');
  });
});

describe('清单', () => {
  it('key 去扩展名，值只含真进包的路径', () => {
    write({ 'assets/ui/btn.png': 500, 'assets/ui/btn.webp': 300, 'assets/ui/skip.png': 0 });
    const { assets } = pickAssets(options());
    const manifest = buildManifest(assets);
    expect(manifest).toEqual({ 'ui/btn': ['assets/ui/btn.webp'] });
  });

  it('json 保留扩展名，避免与同名图片撞 key', () => {
    write({ 'assets/data/level.png': 10, 'assets/data/level.json': 10 });
    const { assets } = pickAssets(options());
    const keys = Object.keys(buildManifest(assets)).sort();
    expect(keys).toEqual(['data/level', 'data/level.json']);
  });

  it('manifestCode 生成可执行模块源码', () => {
    write({ 'assets/ui/btn.webp': 10 });
    const { assets } = pickAssets(options());
    const code = manifestCode(assets);
    expect(code).toContain('export const manifest');
    expect(code).toContain('"ui/btn":["assets/ui/btn.webp"]');
  });
});
