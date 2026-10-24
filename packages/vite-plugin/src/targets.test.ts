import { describe, expect, it } from 'vitest';
import { buildOptions, indexHtml, platformFiles } from './targets';
import type { MgTarget, ResolvedOptions } from './types';

const options = (target: MgTarget): ResolvedOptions => ({
  target,
  root: '/proj',
  design: { width: 960, height: 640 },
  fit: 'contain',
  entry: '/proj/src/main.ts',
  assetsDir: '/proj/assets',
  packDir: '/proj/assets-pack',
  subpackages: {},
  outDir: `/proj/build/${target}`,
  title: 'demo',
  projectName: 'demo',
  atlas: null,
  economyDir: null,
});

const parse = (files: Record<string, string>, name: string): Record<string, unknown> =>
  JSON.parse(files[name] ?? '{}') as Record<string, unknown>;

describe('platformFiles', () => {
  it('web 不产任何平台文件', () => {
    expect(platformFiles(options('web'), [])).toEqual({});
  });

  it('wx：game.json 带 networkTimeout 与分包根目录，appid 用 touristappid', () => {
    const files = platformFiles(options('wx'), ['city']);
    const game = parse(files, 'game.json');
    expect(game['deviceOrientation']).toBe('landscape');
    expect(game['showStatusBar']).toBe(false);
    expect(game['networkTimeout']).toEqual({ request: 10000 });
    expect(game['subpackages']).toEqual([{ name: 'city', root: 'subpackages/city/' }]);
    const project = parse(files, 'project.config.json');
    expect(project['appid']).toBe('touristappid');
    expect(project['compileType']).toBe('game');
    expect(project['projectname']).toBe('demo');
  });

  it('tt：appid 用 testappid，不带 networkTimeout', () => {
    const files = platformFiles(options('tt'), []);
    const game = parse(files, 'game.json');
    expect(game['networkTimeout']).toBeUndefined();
    expect(game['subpackages']).toBeUndefined();
    expect(parse(files, 'project.config.json')['appid']).toBe('testappid');
  });

  it('没有分包时 game.json 不出现 subpackages 字段（空分包会构建报错）', () => {
    const game = parse(platformFiles(options('wx'), []), 'game.json');
    expect('subpackages' in game).toBe(false);
  });

  it('竖屏设计分辨率产出 portrait', () => {
    const portrait: ResolvedOptions = { ...options('wx'), design: { width: 390, height: 844 } };
    expect(parse(platformFiles(portrait, []), 'game.json')['deviceOrientation']).toBe('portrait');
  });
});

describe('buildOptions', () => {
  it('iife 单文件 + codeSplitting:false（替代 inlineDynamicImports）', () => {
    const output = buildOptions(options('wx')).output;
    const single = Array.isArray(output) ? output[0] : output;
    expect(single?.format).toBe('iife');
    expect((single as Record<string, unknown>)['codeSplitting']).toBe(false);
    expect(single?.entryFileNames).toBe('game.js');
  });
});

describe('indexHtml', () => {
  it('含 canvas 与普通 script，不是 module script', () => {
    const html = indexHtml('game.js', options('web'));
    expect(html).toContain('<canvas id="game"');
    expect(html).toContain('src="./game.js"');
    expect(html).not.toContain('type="module"');
    expect(html).toContain('<title>demo</title>');
  });

  it('canvas 带设计分辨率尺寸（backing 不再停在默认 300×150）', () => {
    const html = indexHtml('game.js', options('web'));
    expect(html).toContain('width="960"');
    expect(html).toContain('height="640"');
  });

  it('不写死 canvas 的 CSS 尺寸（窄视口下不能被裁）', () => {
    const html = indexHtml('game.js', options('web'));
    // CSS 里不能出现固定像素的 width/height；显示尺寸由平台按 design+fit 算
    expect(html).not.toContain('width:960px');
    expect(html).not.toContain('height:640px');
    expect(html).toContain('max-width:100%');
    expect(html).toContain('max-height:100%');
  });

  it('dev 模式是 module 入口（mg dev 之前 404 的修复）', () => {
    const html = indexHtml('src/main.ts', options('web'), 'dev');
    expect(html).toContain('<script type="module" src="/src/main.ts"></script>');
    expect(html).not.toContain('src="./src/main.ts"');
    // canvas 与视口规则和 build 版一致
    expect(html).toContain('<canvas id="game" width="960" height="640">');
    expect(html).toContain('max-height:100%');
  });
});
