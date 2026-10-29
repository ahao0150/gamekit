/**
 * CLI 公共设施：运行上下文、工作区定位、文件遍历、游戏配置读取、目标解析、格式化。
 * 只放无副作用的小工具；命令的实现留在 commands/ 各自文件里。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative as pathRelative, resolve, sep } from 'node:path';
import type { MgAtlasOptions, MgFit, MgTarget } from '@mg/vite-plugin';
import { boolFlag, stringFlag } from './args';
import type { ParsedArgs } from './args';

/** 命令执行上下文：把 stdout/stderr/cwd 注入进来，测试可替换。 */
export interface CliContext {
  readonly cwd: string;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

/** 命令实现：argv 已去掉命令名本身，返回进程退出码。 */
export type CommandRunner = (argv: readonly string[], ctx: CliContext) => Promise<number>;

/** 三端目标。顺序即构建/检查顺序。 */
export const TARGETS: readonly MgTarget[] = ['web', 'wx', 'tt'];

export const isTarget = (value: string): value is MgTarget =>
  value === 'web' || value === 'wx' || value === 'tt';

/** 解析 `--target` / `--all`；非法值返回 null，由命令报错。 */
export const resolveTargets = (
  parsed: ParsedArgs,
  fallback: MgTarget | 'all',
): readonly MgTarget[] | null => {
  const single = stringFlag(parsed, 'target');
  if (boolFlag(parsed, 'all')) return TARGETS;
  if (single !== undefined) return isTarget(single) ? [single] : null;
  return fallback === 'all' ? TARGETS : [fallback];
};

/** 从 cwd 向上找带 pnpm-workspace.yaml 的目录；找不到就退回起点。 */
export const findWorkspaceRoot = (start: string): string => {
  const origin = resolve(start);
  let dir = origin;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return origin;
    dir = parent;
  }
};

/** 读 JSON；文件不存在或解析失败返回 null（调用方决定报错文案）。 */
export const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
};

/** 外部游戏通过本地配置指向唯一框架；仓库内项目仍自动向上定位。 */
export const findFrameworkRoot = (project: string): string => {
  const config = readJson(join(project, 'gamekit.config.json'));
  if (isRecord(config) && typeof config['frameworkRoot'] === 'string' && config['frameworkRoot'].trim() !== '') {
    return resolve(project, config['frameworkRoot']);
  }
  return findWorkspaceRoot(project);
};

/**
 * 游戏项目根（含 src/ 与 assets/）。
 * 与「仓库根」区分：build/dev/check/pack 都作用于游戏项目，默认就是 cwd；
 * 只有 create/doctor 需要仓库根（要去 templates/、packages/）。
 */
export const projectRoot = (ctx: CliContext, parsed: ParsedArgs): string =>
  resolve(ctx.cwd, stringFlag(parsed, 'root') ?? '.');

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 递归列目录得到的文件条目。路径统一 `/` 分隔，与插件产物清单同一口径。 */
export interface WalkedFile {
  readonly relative: string;
  readonly bytes: number;
}

export const walkFiles = (root: string): WalkedFile[] => {
  const out: WalkedFile[] = [];
  const visit = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) visit(full);
      else out.push({ relative: pathRelative(root, full).split(sep).join('/'), bytes: stat.size });
    }
  };
  visit(root);
  return out;
};

/** 游戏配置：build/dev 需要 design；其余字段可选（见 docs/CONVENTIONS.md）。 */
export interface GameConfig {
  readonly design?: { readonly width: number; readonly height: number };
  readonly fit?: MgFit;
  readonly assetsDir?: string;
  readonly subpackages?: Readonly<Record<string, readonly string[]>>;
  /**
   * 页面标题（中文名）。不给就退回 `package.json` 的 `name`。
   *
   * 为什么要这个字段：包名必须是 kebab-case 英文 id（如 `my-game`），
   * 但浏览器标签页和分享卡片要显示中文名（`我的游戏`）。没有这个字段时
   * title 只能取包名，线上标签页显示的是英文 id。
   */
  readonly title?: string;
  /**
   * 图集配置。`{ "enabled": true }` 即启用，其余字段有默认值：
   * maxTextureSize 2048 / maxFrameSize 512 / padding 2 / compress auto。
   */
  readonly atlas?: MgAtlasOptions;
}

const asAtlas = (value: unknown): MgAtlasOptions | undefined => {
  if (!isRecord(value)) return undefined;
  const out: {
    enabled?: boolean; maxTextureSize?: number; maxFrameSize?: number; padding?: number;
    compress?: 'auto' | 'none';
  } = {};
  if (typeof value['enabled'] === 'boolean') out.enabled = value['enabled'];
  if (typeof value['maxTextureSize'] === 'number') out.maxTextureSize = value['maxTextureSize'];
  if (typeof value['maxFrameSize'] === 'number') out.maxFrameSize = value['maxFrameSize'];
  if (typeof value['padding'] === 'number') out.padding = value['padding'];
  if (value['compress'] === 'auto' || value['compress'] === 'none') out.compress = value['compress'];
  return out;
};

const asDesign = (value: unknown): GameConfig['design'] => {
  if (!isRecord(value)) return undefined;
  const width = value['width'];
  const height = value['height'];
  if (typeof width !== 'number' || typeof height !== 'number') return undefined;
  if (!(width > 0) || !(height > 0)) return undefined;
  return { width, height };
};

const asFit = (value: unknown): MgFit | undefined =>
  value === 'height' || value === 'width' || value === 'contain' || value === 'fill' ? value : undefined;

const readSubpackages = (
  source: Record<string, unknown>,
): Readonly<Record<string, readonly string[]>> | undefined => {
  const out: Record<string, readonly string[]> = {};
  for (const [name, paths] of Object.entries(source)) {
    if (!Array.isArray(paths)) continue;
    out[name] = paths.filter((item): item is string => typeof item === 'string');
  }
  return out;
};

const pickGameConfig = (source: Record<string, unknown>): GameConfig => {
  const rawSubpackages = source['subpackages'];
  const rawTitle = source['title'];
  return {
    design: asDesign(source['design']),
    fit: asFit(source['fit']),
    assetsDir: typeof source['assetsDir'] === 'string' ? source['assetsDir'] : undefined,
    subpackages: isRecord(rawSubpackages) ? readSubpackages(rawSubpackages) : undefined,
    title: typeof rawTitle === 'string' && rawTitle.trim() !== '' ? rawTitle.trim() : undefined,
    atlas: asAtlas(source['atlas']),
  };
};

/**
 * 读游戏配置：优先 `game.config.json`，其次 `package.json` 的 `mg` 字段。
 * 两种约定都支持，见 docs/CONVENTIONS.md。
 */
export const readGameConfig = (root: string): GameConfig | null => {
  const fileConfig = readJson(join(root, 'game.config.json'));
  if (isRecord(fileConfig)) return pickGameConfig(fileConfig);

  const pkg = readJson(join(root, 'package.json'));
  if (isRecord(pkg) && isRecord(pkg['mg'])) return pickGameConfig(pkg['mg']);
  return null;
};

/** 人类可读体积。 */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb * 10) / 10} KB`;
  return `${Math.round((kb / 1024) * 100) / 100} MB`;
};

/** 把异常归一成一行可读文案。 */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 生产上下文：真 stdout / stderr / cwd。 */
export const createCliContext = (): CliContext => ({
  cwd: process.cwd(),
  stdout: (line) => {
    process.stdout.write(`${line}\n`);
  },
  stderr: (line) => {
    process.stderr.write(`${line}\n`);
  },
});
