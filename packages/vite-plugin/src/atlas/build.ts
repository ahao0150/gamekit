/**
 * 图集产物构建：磁盘上的图 → 解码 → 排布打包。
 *
 * **dev 与 build 都调这里的同一个函数**（`buildAtlas`），保证两条路径产出的
 * `atlas.json` 结构完全一致 —— 否则「dev 能跑、打包上线切图错」这类问题无法提前暴露。
 */

import { readFileSync } from 'node:fs';
import type { AssetFile, ResolvedAtlas } from '../types';
import { decodePng } from './png';
import { pack } from './pack';
import type { AtlasBuild, PackInput } from './types';

/**
 * 图集图在资源清单里的 key 前缀（与 runtime `core/assets/atlas.ts` 的常量一致）。
 *
 * 加前缀的原因：业务 key 是 `icons/coin` 这类路径形式，图集是构建产物，
 * 用独立命名空间才不会撞，也便于一眼认出「这是图集，不是业务图」。
 */
export const ATLAS_KEY_PREFIX = '@atlas/';

/** 图集图在产物里的相对路径（相对 outDir）。 */
export const atlasOutPath = (name: string): string => `assets/${name}`;

export interface AtlasResult {
  readonly build: AtlasBuild;
  /** 要合并进 `virtual:mg-manifest` 的图集条目 */
  readonly manifest: Readonly<Record<string, readonly string[]>>;
  /** 已进图集的 key：这些图不能再当单图拷贝，也不能留在清单里 */
  readonly packedKeys: ReadonlySet<string>;
  readonly warnings: readonly string[];
}

/**
 * 只有 PNG 参与图集。
 *
 * 为什么排除 webp：webp 本身已经更小，且本项目没有 webp 解码器（不引原生依赖）；
 * 把它塞进图集要么解码不了，要么得先转码，收益不值得。
 * 单边超 `maxFrameSize` 的图（背景这类）自动退回单图直连，由 `pack()` 报出来。
 */
const ATLAS_SOURCE_RE = /\.png$/i;

export const buildAtlas = (assets: readonly AssetFile[], opts: ResolvedAtlas): AtlasResult => {
  const warnings: string[] = [];
  const inputs: PackInput[] = [];

  for (const asset of assets) {
    if (!ATLAS_SOURCE_RE.test(asset.rel)) continue;
    if (asset.pkg !== null) {
      // 分包资源不进图集：图集页是主包文件，放进来等于把分包图复制进主包
      warnings.push(`图集跳过分包资源（避免主包重复）：${asset.rel}`);
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(asset.from);
    } catch {
      warnings.push(`图集跳过读不到的文件：${asset.rel}`);
      continue;
    }
    const decoded = decodePng(new Uint8Array(bytes));
    if (decoded === null) {
      warnings.push(`图集跳过不支持的 PNG（16 位 / 隔行 / 损坏）：${asset.rel}`);
      continue;
    }
    inputs.push({ key: asset.key, width: decoded.width, height: decoded.height, rgba: decoded.rgba });
  }

  const build = pack(inputs, opts);
  for (const excluded of build.excluded) {
    warnings.push(
      `图集排除 ${excluded.key}：${excluded.reason === 'too-large' ? '单边超过 maxFrameSize，退回单图直连' : '排不进任何一页'}`,
    );
  }

  const manifest: Record<string, readonly string[]> = {};
  for (const page of build.pages) manifest[`${ATLAS_KEY_PREFIX}${page.name}`] = [atlasOutPath(page.name)];

  // 量化降级要说出来：这是「体积换画质」的取舍，静默降级会让人以为压缩生效了
  for (const page of build.pages) {
    if (opts.compress !== 'auto' || page.mode !== 'rgba') continue;
    const q = page.quality;
    const detail = q === undefined
      ? '未跑量化'
      : `PSNR ${Number.isFinite(q.psnr) ? q.psnr.toFixed(1) : '∞'} dB / 最大色差 ${q.maxChannelDiff} / 差异像素 ${(q.diffRatio * 100).toFixed(2)}% / 唯一色 ${q.uniqueColors}`;
    warnings.push(`图集页 ${page.name} 量化质量不达标，降级为无损 RGBA（${detail}）`);
  }

  return {
    build,
    manifest,
    packedKeys: new Set(Object.keys(build.atlas.frames)),
    warnings,
  };
};
