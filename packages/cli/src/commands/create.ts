/**
 * `mg create <name> [--template iaa-ui]`
 *
 * 把 `templates/<template>/` 复制到 `games/<name>/`，并把 package.json 的
 * name 换成项目名。游戏必须落在 gamekit 仓库的 `games/*` 下。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { parseArgs, stringFlag } from '../args';
import { findWorkspaceRoot, isRecord, messageOf, readJson } from '../shared';
import type { CommandRunner } from '../shared';

const NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const TEMPLATE_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** 默认模板：开箱即用的 .ui 界面链（见 docs/START-HERE.md）。 */
export const DEFAULT_TEMPLATE = 'iaa-ui';

/** 纯函数：校验项目名。合法返回 null，否则返回中文原因。 */
export const validateGameName = (name: string): string | null =>
  NAME_PATTERN.test(name) ? null : '项目名只能用小写字母、数字和 -，须字母开头，最长 32 位';

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** 把目标目录里的 package.json name 换成项目名；缺失或坏了返回 false。 */
const replacePackageName = (gameDir: string, name: string): boolean => {
  const pkgPath = join(gameDir, 'package.json');
  const pkg = readJson(pkgPath);
  if (!isRecord(pkg)) return false;
  pkg['name'] = name;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return true;
};

/** 复制模板时按「目录名」跳过：依赖、构建产物、vite/vitest 缓存。 */
const SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules', 'build', 'dist', '.vite']);

/**
 * 按「相对模板根的路径」跳过的产物目录（只看模板根下一层，不按目录名全局匹配）
 * —— 按目录名匹配抓不到嵌套的 `tools/out`。
 */
const SKIP_PATHS: readonly string[] = ['tools/out', 'artifacts'];

/** 相对模板根、统一用 `/` 的路径；模板根本身为 `''`。 */
const relativePath = (root: string, path: string): string =>
  relative(root, path).split(sep).join('/');

const shouldCopy = (templateDir: string, src: string): boolean => {
  const rel = relativePath(templateDir, src);
  if (rel === '') return true;
  if (SKIP_DIRS.has(basename(src))) return false;
  return !SKIP_PATHS.some((skip) => rel === skip || rel.startsWith(`${skip}/`));
};

/** 可用模板名（templates/ 下的目录）；读不到就当空 —— 只用于报错提示，不该抛。 */
const listTemplates = (root: string): readonly string[] => {
  try {
    return readdirSync(join(root, 'templates'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
};

const copyTemplate = (from: string, to: string): void => {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, {
    recursive: true,
    filter: (src) => shouldCopy(from, src),
  });
};

/** 必须是带 pnpm-workspace / templates / packages 的 gamekit 仓库根。 */
export const assertGamekitRoot = (root: string): string | null => {
  if (!existsSync(join(root, 'pnpm-workspace.yaml'))) {
    return '找不到 gamekit 仓库根（需要 pnpm-workspace.yaml）。请在仓库内执行；游戏只能建在 gamekit/games/<name>/';
  }
  if (!isDirectory(join(root, 'templates')) || !isDirectory(join(root, 'packages'))) {
    return '当前目录不像 gamekit 仓库（缺少 templates/ 或 packages/）。游戏必须创建在 gamekit/games/* 下';
  }
  return null;
};

/** 目标必须落在 `<root>/games/<name>`，拒绝仓库外路径。 */
export const assertInsideGames = (root: string, gameDir: string): string | null => {
  const gamesRoot = resolve(root, 'games');
  const resolved = resolve(gameDir);
  const prefix = gamesRoot.endsWith(sep) ? gamesRoot : `${gamesRoot}${sep}`;
  if (resolved !== gamesRoot && !resolved.startsWith(prefix)) {
    return `拒绝仓库外路径：只能创建在 ${gamesRoot}${sep}<name> 下`;
  }
  return null;
};

export const runCreate: CommandRunner = async (argv, ctx) => {
  const parsed = parseArgs(argv);
  const name = parsed.positionals[0];
  if (name === undefined) {
    ctx.stderr(`mg create: 缺少项目名。用法：mg create <name> [--template ${DEFAULT_TEMPLATE}]`);
    return 1;
  }

  const invalid = validateGameName(name);
  if (invalid !== null) {
    ctx.stderr(`mg create: ${invalid}`);
    return 1;
  }

  const template = stringFlag(parsed, 'template') ?? DEFAULT_TEMPLATE;
  if (!TEMPLATE_PATTERN.test(template)) {
    ctx.stderr(`mg create: 非法模板名 ${template}`);
    return 1;
  }

  const root = findWorkspaceRoot(stringFlag(parsed, 'root') ?? ctx.cwd);
  const rootIssue = assertGamekitRoot(root);
  if (rootIssue !== null) {
    ctx.stderr(`mg create: ${rootIssue}`);
    return 1;
  }

  const templateDir = join(root, 'templates', template);
  const gameDir = join(root, 'games', name);
  const outside = assertInsideGames(root, gameDir);
  if (outside !== null) {
    ctx.stderr(`mg create: ${outside}`);
    return 1;
  }

  if (!isDirectory(templateDir)) {
    ctx.stderr(`mg create: 模板不存在：templates/${template}（可用：${listTemplates(root).join(' / ') || '无'}）`);
    return 1;
  }
  if (existsSync(gameDir)) {
    ctx.stderr(`mg create: 目标已存在：games/${name}`);
    return 1;
  }

  try {
    copyTemplate(templateDir, gameDir);
  } catch (error) {
    ctx.stderr(`mg create: 复制模板失败：${messageOf(error)}`);
    return 1;
  }

  const renamed = replacePackageName(gameDir, name);
  ctx.stdout(`✔ 已创建 games/${name}/（模板 ${template}）`);
  if (!renamed) ctx.stdout('  ⚠ 模板里没有可解析的 package.json，未替换项目名');
  if (existsSync(join(gameDir, 'AGENTS.md'))) {
    ctx.stdout(`  先读：games/${name}/AGENTS.md（给 AI 的工程约定：该读哪份文档、目录约定、禁止事项）`);
  }
  ctx.stdout('  下一步（任选其一，命令可直接复制）：');
  ctx.stdout(`    cd games/${name} && node ../../packages/cli/bin/mg.mjs dev`);
  ctx.stdout(`    pnpm mg -- dev --root games/${name}`);
  return 0;
};
