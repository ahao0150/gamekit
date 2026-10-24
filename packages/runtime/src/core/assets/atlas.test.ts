import { describe, expect, it } from 'vitest';
import type { AssetManifest, AtlasManifest } from './contract';
import { createAssets } from './index';
import { image, makeLoader, ok } from './test-helpers';
import type { Loader } from './test-helpers';

// ---------------------------------------------------------------------------
// 图集（atlas）：帧切片、同页共享、单图回落
// ---------------------------------------------------------------------------

describe('图集：帧切片与共享', () => {
  /** 两页图集：atlas-0 放小图标，atlas-1 放一张大图。 */
  const ATLAS: AtlasManifest = {
    version: 1,
    atlases: {
      'atlas-0.png': { w: 512, h: 512 },
      'atlas-1.png': { w: 512, h: 512 },
    },
    frames: {
      'icons/coin': { atlas: 'atlas-0.png', x: 0, y: 0, w: 64, h: 64 },
      'icons/clock': { atlas: 'atlas-0.png', x: 64, y: 0, w: 32, h: 48 },
      'ui/big': { atlas: 'atlas-1.png', x: 0, y: 0, w: 512, h: 256 },
    },
  };

  /**
   * 资源清单：图集图用 `@atlas/<文件名>` 这个约定 key 登记，
   * 这样它们跟业务图走同一套候选路径（含 webp → png 降级）。
   */
  const ATLAS_MANIFEST: AssetManifest = {
    '@atlas/atlas-0.png': ['atlas-0.webp', 'atlas-0.png'],
    '@atlas/atlas-1.png': ['atlas-1.png'],
    'bg/bg-warehouse': ['bg/bg-warehouse.webp'],
  };

  it('帧命中：width/height 是**帧尺寸**，sx/sy/sw/sh 是图集矩形', async () => {
    const { loadImage, calls } = makeLoader({ 'atlas-0.webp': ok(512, 512, 'atlas-native') });
    const assets = createAssets({ manifest: ATLAS_MANIFEST, atlas: ATLAS, loadImage });

    const coin = await assets.load('icons/coin');
    expect(coin).toEqual({
      key: 'icons/coin',
      // 关键：不是整张图集的 512×512，而是帧的 64×64
      width: 64,
      height: 64,
      src: '@atlas/atlas-0.png',
      native: 'atlas-native',
      sx: 0, sy: 0, sw: 64, sh: 64,
    });
    expect(calls).toEqual(['atlas-0.webp']);
    expect(assets.has('icons/coin')).toBe(true);
    expect(assets.status('icons/coin')).toBe('ready');
  });

  it('同页多帧只加载一次图集图，多帧共享同一个 native', async () => {
    const { loadImage, calls } = makeLoader({ 'atlas-0.webp': ok(512, 512, 'atlas-native') });
    const assets = createAssets({ manifest: ATLAS_MANIFEST, atlas: ATLAS, loadImage });

    const result = await assets.loadAll(['icons/coin', 'icons/clock'], { concurrency: 4 });
    expect(result).toEqual({ loaded: 2, total: 2, failed: {} });
    expect(calls).toEqual(['atlas-0.webp']); // 整页只请求一次
    expect(assets.get('icons/coin')?.native).toBe('atlas-native');
    expect(assets.get('icons/clock')?.native).toBe('atlas-native');
    expect(assets.get('icons/clock')).toMatchObject({
      width: 32, height: 48, sx: 64, sy: 0, sw: 32, sh: 48,
    });
  });

  it('不同页各自加载一次；每帧矩形跟随清单', async () => {
    const { loadImage, calls } = makeLoader({
      'atlas-0.webp': ok(512, 512, 'a0'),
      'atlas-1.png': ok(512, 512, 'a1'),
    });
    const assets = createAssets({ manifest: ATLAS_MANIFEST, atlas: ATLAS, loadImage });

    await assets.loadAll(['icons/coin', 'ui/big']);
    expect([...calls].sort()).toEqual(['atlas-0.webp', 'atlas-1.png']);
    expect(assets.get('ui/big')).toMatchObject({
      width: 512, height: 256, native: 'a1', sx: 0, sy: 0, sw: 512, sh: 256,
    });
  });

  it('图集里没有的 key 照旧走单图候选路径（矩形退化为全图）', async () => {
    const { loadImage, calls } = makeLoader({
      'bg/bg-warehouse.webp': ok(780, 1688, 'bg-native'),
    });
    const assets = createAssets({ manifest: ATLAS_MANIFEST, atlas: ATLAS, loadImage });

    const bg = await assets.load('bg/bg-warehouse');
    expect(bg).toMatchObject({
      width: 780, height: 1688, sx: 0, sy: 0, sw: 780, sh: 1688, native: 'bg-native',
    });
    expect(calls).toEqual(['bg/bg-warehouse.webp']);
  });

  it('图集图加载失败 → 该帧 failed 且不抛错', async () => {
    const { loadImage } = makeLoader({});
    const assets = createAssets({ manifest: ATLAS_MANIFEST, atlas: ATLAS, loadImage });

    expect(await assets.load('icons/coin')).toBeNull();
    expect(assets.status('icons/coin')).toBe('failed');
  });

  it('图集图失败后再加载会重试（失败不永久留在缓存里）', async () => {
    // 只给一个候选，第一次「整页加载」必然失败；第二次应能重试成功
    const oneCandidate: AssetManifest = { '@atlas/atlas-0.png': ['atlas-0.webp'] };
    let attempt = 0;
    const flaky: Loader = () => {
      attempt += 1;
      return attempt === 1 ? Promise.resolve(null) : Promise.resolve(image(512, 512, 'late-native'));
    };
    const assets = createAssets({ manifest: oneCandidate, atlas: ATLAS, loadImage: flaky });
    expect(await assets.load('icons/coin')).toBeNull();
    const retried = await assets.load('icons/coin');
    expect(retried?.native).toBe('late-native');
    expect(attempt).toBe(2);
  });

  it('不传 atlas 时行为与接入前一致（单图整张）', async () => {
    const { loadImage } = makeLoader({ 'icons/coin': ok(64, 64, 'plain') });
    const assets = createAssets({ manifest: { 'icons/coin': ['icons/coin'] }, loadImage });
    const plain = await assets.load('icons/coin');
    expect(plain).toMatchObject({ width: 64, height: 64, sx: 0, sy: 0, sw: 64, sh: 64 });
  });

  it('clear() 会连图集图缓存一起清掉', async () => {
    const { loadImage, calls } = makeLoader({ 'atlas-0.webp': ok(512, 512, 'atlas-native') });
    const assets = createAssets({ manifest: ATLAS_MANIFEST, atlas: ATLAS, loadImage });
    await assets.load('icons/coin');
    expect(calls.length).toBe(1);
    assets.clear();
    await assets.load('icons/coin');
    // 清空后重新请求整页图集（说明图集图缓存确实被清了）
    expect(calls.length).toBe(2);
  });
});
