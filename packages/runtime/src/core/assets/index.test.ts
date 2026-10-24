import { describe, expect, it } from 'vitest';
import type { AssetManifest, AtlasManifest } from './contract';
import { createAssets, DEFAULT_CONCURRENCY, DEFAULT_TIMEOUT_MS } from './index';
import { image, makeLoader, ok } from './test-helpers';
import type { Loader, MockImage } from './test-helpers';

describe('createAssets：单个加载与候选回退', () => {
  it('命中第一个候选：缓存、get、status 都到位', async () => {
    const manifest: AssetManifest = { hero: ['hero.webp', 'hero.png'] };
    const { loadImage, calls } = makeLoader({ 'hero.webp': ok(64, 32, 'webp-native') });
    const assets = createAssets({ manifest, loadImage });

    const asset = await assets.load('hero');
    expect(asset).toEqual({
      key: 'hero', width: 64, height: 32, src: 'hero.webp', native: 'webp-native',
      sx: 0, sy: 0, sw: 64, sh: 32,
    });
    expect(calls).toEqual(['hero.webp']);
    expect(assets.get('hero')).toBe(asset);
    expect(assets.status('hero')).toBe('ready');
    expect(assets.has('hero')).toBe(true);
    expect(assets.manifest).toBe(manifest);
  });

  it('第一个候选失败 → 按序试下一个，src 记录实际命中路径', async () => {
    const manifest: AssetManifest = { hero: ['hero.webp', 'hero.png'] };
    const { loadImage, calls } = makeLoader({ 'hero.png': ok(48, 24, 'png-native') });
    const assets = createAssets({ manifest, loadImage });

    const asset = await assets.load('hero');
    expect(asset?.src).toBe('hero.png');
    expect(asset?.native).toBe('png-native');
    expect(calls).toEqual(['hero.webp', 'hero.png']);
  });

  it('候选抛出异常也算失败，继续下一个（不向上抛）', async () => {
    const manifest: AssetManifest = { hero: ['a.png', 'b.png'] };
    const { loadImage } = makeLoader({
      'a.png': () => Promise.reject(new Error('解码失败')),
      'b.png': ok(10, 10),
    });
    const assets = createAssets({ manifest, loadImage });
    expect((await assets.load('hero'))?.src).toBe('b.png');
  });

  it('全部候选失败：返回 null、status failed、get null', async () => {
    const manifest: AssetManifest = { hero: ['a.png'] };
    const { loadImage } = makeLoader({});
    const assets = createAssets({ manifest, loadImage });
    await expect(assets.load('hero')).resolves.toBeNull();
    expect(assets.status('hero')).toBe('failed');
    expect(assets.get('hero')).toBeNull();
  });

  it('清单未登记的 key：返回 null、不调用平台加载', async () => {
    const { loadImage, calls } = makeLoader({});
    const assets = createAssets({ manifest: {}, loadImage });
    await expect(assets.load('nope')).resolves.toBeNull();
    expect(calls).toEqual([]);
    expect(assets.has('nope')).toBe(false);
    expect(assets.status('nope')).toBe('failed');
  });

  it('已缓存时不再请求平台（调用次数仍是 1）', async () => {
    const { loadImage, calls } = makeLoader({ 'hero.png': ok() });
    const assets = createAssets({ manifest: { hero: ['hero.png'] }, loadImage });
    await assets.load('hero');
    await assets.load('hero');
    expect(calls).toEqual(['hero.png']);
  });
});

describe('createAssets：超时与单飞', () => {
  it('单张超时后按失败处理，继续试下一个候选', async () => {
    const manifest: AssetManifest = { hero: ['slow.png', 'fast.png'] };
    const { loadImage } = makeLoader({
      'slow.png': () => new Promise<MockImage | null>(() => undefined), // 永不返回
      'fast.png': ok(12, 12, 'fast'),
    });
    const assets = createAssets({ manifest, loadImage });
    const asset = await assets.load('hero', { timeoutMs: 20 });
    expect(asset?.src).toBe('fast.png');
    expect(asset?.native).toBe('fast');
  });

  it('同一 key 并发 load 只真正加载一次', async () => {
    const { loadImage, calls } = makeLoader({ 'hero.png': ok(8, 8) });
    const assets = createAssets({ manifest: { hero: ['hero.png'] }, loadImage });
    const [a, b] = await Promise.all([assets.load('hero'), assets.load('hero')]);
    expect(calls).toEqual(['hero.png']);
    expect(a).toBe(b);
  });

  it('默认参数与契约一致', () => {
    expect(DEFAULT_CONCURRENCY).toBe(4);
    expect(DEFAULT_TIMEOUT_MS).toBe(10000);
  });
});

describe('createAssets：批量加载', () => {
  it('并发上限生效：8 个资源、上限 2，实际最多同时 2 个', async () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const manifest: AssetManifest = Object.fromEntries(keys.map((k) => [k, [`${k}.png`]]));
    let active = 0;
    let maxActive = 0;
    const loadImage: Loader = async (src) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return image(1, 1, src);
    };
    const assets = createAssets({ manifest, loadImage });

    const result = await assets.loadAll(keys, { concurrency: 2 });
    expect(maxActive).toBe(2);
    expect(result.loaded).toBe(8);
    expect(result.total).toBe(8);
    expect(result.failed).toEqual({});
  });

  it('单个失败不影响其余，结果汇总失败原因', async () => {
    const manifest: AssetManifest = { a: ['a.png'], b: ['b.png'], c: ['c.png', 'c.webp'] };
    const { loadImage } = makeLoader({ 'a.png': ok(), 'b.png': ok() });
    const assets = createAssets({ manifest, loadImage });

    const result = await assets.loadAll(['a', 'b', 'c', 'missing'], { concurrency: 2 });
    expect(result.loaded).toBe(2);
    expect(result.total).toBe(4);
    expect(Object.keys(result.failed).sort()).toEqual(['c', 'missing']);
    expect(result.failed.c).toBe('候选路径全部加载失败（2 个）');
    expect(result.failed.missing).toBe('清单未登记该 key 或候选路径为空');
  });

  it('进度回调：完成数从 1 走到 total，失败也计数', async () => {
    const manifest: AssetManifest = { a: ['a.png'], b: ['b.png'] };
    const { loadImage } = makeLoader({ 'a.png': ok() });
    const assets = createAssets({ manifest, loadImage });
    const progress: Array<[number, number, string]> = [];

    const result = await assets.loadAll(['a', 'b'], {
      onProgress: (loaded, total, key) => progress.push([loaded, total, key]),
    });
    expect(result.loaded).toBe(1);
    expect(progress.map((p) => p[0])).toEqual([1, 2]);
    expect(progress.every((p) => p[1] === 2)).toBe(true);
    expect(progress.map((p) => p[2]).sort()).toEqual(['a', 'b']);
  });

  it('进度回调抛错不中断加载', async () => {
    const { loadImage } = makeLoader({ 'a.png': ok() });
    const assets = createAssets({ manifest: { a: ['a.png'] }, loadImage });
    const result = await assets.loadAll(['a'], {
      onProgress: () => {
        throw new Error('业务回调炸了');
      },
    });
    expect(result.loaded).toBe(1);
  });

  it('重复 key 去重：total 按去重后计算', async () => {
    const { loadImage, calls } = makeLoader({ 'a.png': ok() });
    const assets = createAssets({ manifest: { a: ['a.png'] }, loadImage });
    const result = await assets.loadAll(['a', 'a']);
    expect(result.total).toBe(1);
    expect(result.loaded).toBe(1);
    expect(calls.length).toBe(1);
  });
});

describe('createAssets：release / clear', () => {
  it('release 后回到 idle，重新 load 会再次请求平台', async () => {
    const { loadImage, calls } = makeLoader({ 'hero.png': ok() });
    const assets = createAssets({ manifest: { hero: ['hero.png'] }, loadImage });
    await assets.load('hero');
    assets.release('hero');
    expect(assets.get('hero')).toBeNull();
    expect(assets.status('hero')).toBe('idle');
    await assets.load('hero');
    expect(calls).toHaveLength(2);
  });

  it('clear 清空全部缓存，状态回到 idle', async () => {
    const { loadImage } = makeLoader({ 'a.png': ok(), 'b.png': ok() });
    const assets = createAssets({ manifest: { a: ['a.png'], b: ['b.png'] }, loadImage });
    await assets.loadAll(['a', 'b']);
    assets.clear();
    expect(assets.get('a')).toBeNull();
    expect(assets.get('b')).toBeNull();
    expect(assets.status('a')).toBe('idle');
    expect(assets.status('b')).toBe('idle');
    expect(assets.has('a')).toBe(true);
  });

  it('加载途中 clear：在途结果返回但不写回缓存', async () => {
    let resolveTask: ((value: MockImage) => void) | null = null;
    const loadImage: Loader = () =>
      new Promise<MockImage>((resolve) => {
        resolveTask = resolve;
      });
    const assets = createAssets({ manifest: { hero: ['hero.png'] }, loadImage });

    const pending = assets.load('hero');
    expect(assets.status('hero')).toBe('loading');
    assets.clear();
    expect(assets.status('hero')).toBe('idle');

    expect(resolveTask).not.toBeNull();
    resolveTask!(image(10, 10, 'late'));
    const asset = await pending;
    expect(asset?.src).toBe('hero.png');
    expect(assets.get('hero')).toBeNull();
    expect(assets.status('hero')).toBe('idle');
  });
});
