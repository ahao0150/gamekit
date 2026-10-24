import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Connect } from 'vite';
import { buildAtlas } from './build';
import { ATLAS_JSON_NAME, ATLAS_URL_PREFIX, atlasManifestFor, createAtlasDevServer, devAtlasPaths } from './dev';
import { encodePng } from './png';
import type { AssetFile, ResolvedAtlas } from '../types';

const OPTS: ResolvedAtlas = { maxTextureSize: 128, maxFrameSize: 512, padding: 2, compress: 'auto' };

/** 造一张纯色 PNG 落到临时目录，返回一条 AssetFile。 */
const writeImage = (dir: string, rel: string, key: string, width: number, height: number, color: readonly [number, number, number, number]): AssetFile => {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = color[3];
  }
  const png = encodePng(width, height, rgba);
  const from = join(dir, rel);
  mkdirSync(dirname(from), { recursive: true });
  writeFileSync(from, png);
  return { key, rel, from, bytes: png.length, pkg: null };
};

interface FakeResponse {
  statusCode?: number;
  headers: Record<string, string>;
  body?: Uint8Array | string;
  setHeader(name: string, value: string): void;
  end(body: Uint8Array | string): void;
}

const callMiddleware = (
  middleware: Connect.NextHandleFunction,
  url: string,
): Promise<{ response: FakeResponse; nextCalled: boolean }> =>
  new Promise((resolve) => {
    const response: FakeResponse = {
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(body) { this.body = body; },
    };
    const request = { url };
    let nextCalled = false;
    middleware(request as never, response as never, (() => { nextCalled = true; }) as never);
    // 中间件是同步的（本地读盘 + 内存缓存），setTimeout 0 只为拿到调用后的状态
    setTimeout(() => resolve({ response, nextCalled }), 0);
  });

const asText = (body: Uint8Array | string | undefined): string =>
  body === undefined ? '' : typeof body === 'string' ? body : Buffer.from(body).toString('utf8');

describe('dev 中间件：/__atlas/*', () => {
  const setup = (): { assets: AssetFile[]; dir: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'mg-atlas-dev-'));
    const assets: AssetFile[] = [
      writeImage(dir, 'icons/red.png', 'icons/red', 8, 8, [255, 0, 0, 255]),
      writeImage(dir, 'icons/blue.png', 'icons/blue', 16, 16, [0, 0, 255, 255]),
      writeImage(dir, 'bg/big.png', 'bg/big', 600, 400, [0, 255, 0, 255]),
    ];
    return { assets, dir };
  };

  it('/__atlas/atlas-0.png 返回与 build 完全相同的 PNG 字节', async () => {
    const { assets } = setup();
    const built = buildAtlas(assets, OPTS);
    const dev = createAtlasDevServer(() => built);
    const { response } = await callMiddleware(dev.middleware, `${ATLAS_URL_PREFIX}atlas-0.png`);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(Buffer.from(response.body as Uint8Array).equals(Buffer.from(built.build.pages[0]!.png))).toBe(true);
  });

  it('/__atlas/atlas.json 与 build 产出的清单结构等价（dev 与 build 同源）', async () => {
    const { assets } = setup();
    const built = buildAtlas(assets, OPTS);
    const dev = createAtlasDevServer(() => built);
    const { response } = await callMiddleware(dev.middleware, `${ATLAS_URL_PREFIX}${ATLAS_JSON_NAME}`);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(asText(response.body))).toEqual(built.build.atlas);
    // 与构建产物里的形状一致：version / atlases / frames 三件套
    const parsed = JSON.parse(asText(response.body)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['atlases', 'frames', 'version']);
  });

  it('懒打包：首次请求前不构建，请求后才缓存', async () => {
    const { assets } = setup();
    let calls = 0;
    const dev = createAtlasDevServer(() => { calls += 1; return buildAtlas(assets, OPTS); });
    expect(dev.hasCache).toBe(false);
    expect(calls).toBe(0);

    await callMiddleware(dev.middleware, `${ATLAS_URL_PREFIX}atlas-0.png`);
    expect(calls).toBe(1);
    expect(dev.hasCache).toBe(true);

    await callMiddleware(dev.middleware, `${ATLAS_URL_PREFIX}atlas-0.png`);
    expect(calls).toBe(1); // 命中缓存，不重打
  });

  it('invalidate() 之后重建（assets 变化的标脏路径）', async () => {
    const { assets } = setup();
    let calls = 0;
    const dev = createAtlasDevServer(() => { calls += 1; return buildAtlas(assets, OPTS); });
    await callMiddleware(dev.middleware, `${ATLAS_URL_PREFIX}atlas-0.png`);
    dev.invalidate();
    expect(dev.hasCache).toBe(false);
    await callMiddleware(dev.middleware, `${ATLAS_URL_PREFIX}atlas-0.png`);
    expect(calls).toBe(2);
  });

  it('目录里的图进了图集，超 maxFrameSize 的退回单图（不进 frames）', async () => {
    const { assets } = setup();
    const built = buildAtlas(assets, OPTS);
    expect(built.build.atlas.frames['icons/red']).toBeDefined();
    expect(built.build.atlas.frames['icons/blue']).toBeDefined();
    expect(built.build.atlas.frames['bg/big']).toBeUndefined();
    expect(built.build.excluded).toEqual([{ key: 'bg/big', reason: 'too-large' }]);
    // 图集页进清单（带 @atlas/ 前缀），背景仍走单图
    expect(built.manifest['@atlas/atlas-0.png']).toEqual(['assets/atlas-0.png']);
    expect(built.packedKeys.has('bg/big')).toBe(false);
  });

  it('未知图集页 404；非 /__atlas 请求交给下一个中间件', async () => {
    const { assets } = setup();
    const dev = createAtlasDevServer(() => buildAtlas(assets, OPTS));

    const missing = await callMiddleware(dev.middleware, `${ATLAS_URL_PREFIX}nope.png`);
    expect(missing.response.statusCode).toBe(404);

    const other = await callMiddleware(dev.middleware, '/src/main.ts');
    expect(other.nextCalled).toBe(true);
  });
});

/**
 * T73 修的 bug：`buildAtlas` 给 manifest 登记的是打包后路径 `assets/atlas-0.png`，
 * 而 dev 下这个文件不存在（图集由 `/__atlas/*` 现打现发）→ dev 模式图集帧 100% 404。
 * 这两条钉住「dev 改写 / build 原样」。
 */
describe('manifest 的图集路径：dev 改写、build 原样', () => {
  const PROD = {
    '@atlas/atlas-0.png': ['assets/atlas-0.png'],
    '@atlas/atlas-1.png': ['assets/atlas-1.png'],
  } as const;

  it('dev 命令下改成中间件路径', () => {
    expect(atlasManifestFor(PROD, 'serve')).toEqual({
      '@atlas/atlas-0.png': [`${ATLAS_URL_PREFIX}atlas-0.png`],
      '@atlas/atlas-1.png': [`${ATLAS_URL_PREFIX}atlas-1.png`],
    });
  });

  it('build 命令下保持生产路径（不能动线上清单）', () => {
    expect(atlasManifestFor(PROD, 'build')).toEqual(PROD);
    expect(devAtlasPaths(PROD)['@atlas/atlas-0.png']).toEqual([`${ATLAS_URL_PREFIX}atlas-0.png`]);
  });

  it('改写的 URL 以中间件前缀开头（防止有人单改一处）', () => {
    const url = devAtlasPaths({ k: ['a/b/c.png'] })['k']?.[0] ?? '';
    expect(url).toBe(`${ATLAS_URL_PREFIX}c.png`);
  });

  it('空清单不崩', () => {
    expect(devAtlasPaths({})).toEqual({});
  });
});
