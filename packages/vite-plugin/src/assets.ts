/**
 * 资源管线：照搬老 build.js，不交给 Vite。顺序：assets-pack 顶替 → 同名 PNG/WebP/JPEG 取较小
 * → 0 字节跳过 → png 比 webp 小告警 → 清单只登记真进包的文件 → 分包按前缀、空分包不声明。
 */
import { join } from 'node:path';
import { listFiles } from './report';
import type { AssetFile, MgManifest, MgSubpackages, ResolvedOptions } from './types';
const MEDIA_RE = /\.(png|webp|jpe?g|wav|mp3|json)$/i;
const IMAGE_RE = /\.(png|webp|jpe?g)$/i;
/** 容易被误认为能直接进包的媒体；说明、配表源文件仍允许留在资源目录。 */
const UNSUPPORTED_MEDIA_RE = /\.(svg|gif|avif|bmp|tiff?|ico|psd|mp4|webm|ogg|m4a|aac|flac|ttf|otf|woff2?|glb|gltf)$/i;
interface RawFile {
  readonly rel: string;
  readonly from: string;
  readonly bytes: number;
}
/** 递归收集；目录不存在返回空（assets/ 允许缺失）。 */
export const walkAssets = (dir: string): RawFile[] => {
  const files = listFiles(dir);
  const unsupported = files.filter(file => UNSUPPORTED_MEDIA_RE.test(file.relative));
  if (unsupported.length > 0) {
    throw new Error(
      `[mg assets] 不支持的媒体文件：${unsupported.map(f => join(dir, f.relative)).join(' / ')}。` +
      '图片请转换为 PNG、WebP 或 JPEG；音频请转换为 WAV 或 MP3；原稿请移至 artifacts/。',
    );
  }
  return files
    .filter((file) => MEDIA_RE.test(file.relative))
    .sort((a, b) => a.relative.localeCompare(b.relative))
    .map((file) => ({ rel: file.relative, from: join(dir, file.relative), bytes: file.bytes }));
};
const extOf = (rel: string): string =>
  rel.includes('.') ? rel.slice(rel.lastIndexOf('.') + 1).toLowerCase() : '';
/** 去掉扩展名的 base，用于「同名不同格式」分组。 */
export const baseOf = (rel: string): string =>
  rel.includes('.') ? rel.slice(0, rel.lastIndexOf('.')) : rel;
/** 清单 key：图/音去扩展名；json 保留扩展名（避免与同名图撞 key）。 */
const keyOf = (rel: string): string => (extOf(rel) === 'json' ? rel : baseOf(rel));
/** 分包归属：配置顺序优先，第一个命中前缀的分包赢。 */
export const packageOf = (rel: string, subpackages: MgSubpackages): string | null => {
  for (const [name, prefixes] of Object.entries(subpackages)) {
    if (prefixes.some((prefix) => rel.startsWith(prefix))) return name;
  }
  return null;
};
/** 主包 `assets/<rel>`，分包 `subpackages/<name>/assets/<rel>`。 */
export const outPathOf = (asset: AssetFile): string =>
  asset.pkg === null ? `assets/${asset.rel}` : `subpackages/${asset.pkg}/assets/${asset.rel}`;
export interface PickResult {
  readonly assets: readonly AssetFile[];
  readonly warnings: readonly string[];
}
/** 收集 + 择优。watch 模式下每次 buildStart 重跑。 */
export const pickAssets = (options: ResolvedOptions): PickResult => {
  const raw = walkAssets(options.assetsDir);
  const pack = walkAssets(options.packDir);
  const warnings: string[] = [];
  const bases = (list: readonly RawFile[], test: (rel: string) => boolean): Set<string> =>
    new Set(list.filter((file) => test(file.rel)).map((file) => baseOf(file.rel)));
  const packImages = bases(pack, (rel) => IMAGE_RE.test(rel));
  const packMp3 = bases(pack, (rel) => extOf(rel) === 'mp3');
  const rawMp3 = bases(raw, (rel) => extOf(rel) === 'mp3');
  const candidates: RawFile[] = [];
  for (const file of raw) {
    const base = baseOf(file.rel);
    if (IMAGE_RE.test(file.rel) && packImages.has(base)) continue; // pack 图顶替原图
    if (extOf(file.rel) === 'wav' && (packMp3.has(base) || rawMp3.has(base))) continue; // mp3 顶替 wav
    candidates.push(file);
  }
  for (const file of pack) {
    if (IMAGE_RE.test(file.rel) || extOf(file.rel) === 'mp3') candidates.push(file);
  }
  const best = new Map<string, RawFile>();
  for (const file of candidates) {
    if (file.bytes === 0) {
      warnings.push(`跳过 0 字节文件：${file.rel}`);
      continue;
    }
    const key = keyOf(file.rel);
    const prev = best.get(key);
    if (prev !== undefined && IMAGE_RE.test(prev.rel) !== IMAGE_RE.test(file.rel)) {
      throw new Error(`[mg assets] 清单键 '${key}' 冲突：${prev.rel} / ${file.rel}。图片与音频请使用不同路径或名称。`);
    }
    if (prev === undefined || file.bytes < prev.bytes) best.set(keyOf(file.rel), file);
  }
  // 安全阀：png 比 webp 还小说明两份内容可能不同版，静默打旧图会穿帮
  const stalePng = [...best.values()].filter(
    (file) =>
      extOf(file.rel) === 'png' &&
      candidates.some((o) => baseOf(o.rel) === baseOf(file.rel) && extOf(o.rel) === 'webp'),
  );
  if (stalePng.length > 0) {
    warnings.push(
      `⚠ 同名 png 比 webp 小，实际打进包的是 png（可能过期）：${stalePng.map((f) => f.rel).join(', ')}`,
    );
  }
  const assets: AssetFile[] = [...best].map(([key, file]) => ({
    key,
    rel: file.rel,
    from: file.from,
    bytes: file.bytes,
    pkg: packageOf(file.rel, options.subpackages),
  }));
  assets.sort((a, b) => a.key.localeCompare(b.key));
  return { assets, warnings };
};
/**
 * 清单：单图条目 + 额外条目（图集页）。
 *
 * 图集页也用清单登记（key 形如 `@atlas/atlas-0.png`），这样 runtime 加载改后的
 * 图集图能复用同一套「候选路径 + 超时 + 失败回落」逻辑，不需要知道 URL 怎么拼。
 */
export const buildManifest = (
  assets: readonly AssetFile[],
  extra: Readonly<Record<string, readonly string[]>> = {},
): MgManifest => {
  const manifest: Record<string, readonly string[]> = { ...extra };
  for (const asset of assets) manifest[asset.key] = [outPathOf(asset)];
  return manifest;
};
export const manifestCode = (
  assets: readonly AssetFile[],
  extra: Readonly<Record<string, readonly string[]>> = {},
): string =>
  `export const manifest = ${JSON.stringify(buildManifest(assets, extra))};\nexport default manifest;\n`;
/** 只声明真有文件的分包：空分包会被 wx/tt 构建报错。 */
export const declaredSubpackages = (
  assets: readonly AssetFile[],
  subpackages: MgSubpackages,
): string[] => {
  const used = new Set(assets.map((a) => a.pkg).filter((pkg): pkg is string => pkg !== null));
  return Object.keys(subpackages).filter((name) => used.has(name));
};
