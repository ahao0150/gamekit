/** 选项解析：所有路径在这一步变成绝对路径，后续模块不再碰 cwd。 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { MgPluginOptions, MgTarget, ResolvedOptions } from './types';
const TARGETS: readonly MgTarget[] = ['web', 'wx', 'tt'];
const ENTRIES: readonly string[] = ['src/main.ts', 'src/main.js', 'src/index.ts'];
const packageName = (root: string): string | null => {
  try {
    const raw = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: unknown };
    return typeof raw.name === 'string' && raw.name !== '' ? raw.name : null;
  } catch {
    return null; // 没有 package.json 是合法情况（fixture）
  }
};
const resolveEntry = (root: string, given: string | undefined): string => {
  if (given !== undefined) return resolve(root, given);
  for (const rel of ENTRIES) if (existsSync(join(root, rel))) return join(root, rel);
  throw new Error(`mgPlugin: ${root} 下找不到入口（${ENTRIES.join(' / ')}）`);
};
/** 图集默认值：2048 单页 / 512 帧上限 / 2px 间距。 */
export const ATLAS_DEFAULTS = { maxTextureSize: 2048, maxFrameSize: 512, padding: 2 } as const;
const positiveInt = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : fallback;
};
/** 图集选项：未启用返回 null（后续所有分支都要能处理 null）。 */
const resolveAtlas = (raw: MgPluginOptions['atlas']): ResolvedOptions['atlas'] => {
  if (raw === undefined || raw.enabled === false) return null;
  return {
    maxTextureSize: positiveInt(raw.maxTextureSize, ATLAS_DEFAULTS.maxTextureSize),
    maxFrameSize: positiveInt(raw.maxFrameSize, ATLAS_DEFAULTS.maxFrameSize),
    padding: typeof raw.padding === 'number' && raw.padding >= 0 ? Math.floor(raw.padding) : ATLAS_DEFAULTS.padding,
    compress: raw.compress === 'none' ? 'none' : 'auto',
  };
};
/** 校验并补齐默认值；非法输入在构建前抛错，不留到产物阶段。 */
export const resolveOptions = (options: MgPluginOptions): ResolvedOptions => {
  const { target, design } = options;
  if (!TARGETS.includes(target)) throw new Error(`mgPlugin: target 只能是 web/wx/tt，收到 ${target}`);
  if (!(design.width > 0) || !(design.height > 0)) throw new Error('mgPlugin: design 必须正数');
  const root = resolve(options.root ?? process.cwd());
  const title = options.title ?? packageName(root) ?? 'game';
  return {
    target, root, design: { width: design.width, height: design.height },
    fit: options.fit ?? 'contain', entry: resolveEntry(root, options.entry),
    assetsDir: resolve(root, options.assetsDir ?? 'assets'),
    packDir: resolve(root, options.packDir ?? 'assets-pack'),
    subpackages: options.subpackages ?? {},
    outDir: resolve(root, options.outDir ?? join('build', target)),
    title, projectName: options.projectName ?? title,
    atlas: resolveAtlas(options.atlas),
    economyDir:
      options.economyDir !== undefined && options.economyDir.trim().length > 0
        ? resolve(root, options.economyDir)
        : null,
  };
};
/** 设计分辨率决定小游戏屏幕方向。 */
export const orientationOf = (o: ResolvedOptions): 'landscape' | 'portrait' =>
  o.design.width > o.design.height ? 'landscape' : 'portrait';
