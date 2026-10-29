/**
 * `mg create <name> [--template iaa-ui]`
 *
 * 把 `templates/<template>/` 复制到 `games/<name>/`，并把 package.json 的
 * name 换成项目名。默认games/<name>，--dir可指定独立项目目录。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareExternalProject } from '../external-project';
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
    return '找不到 gamekit 仓库根（需要 pnpm-workspace.yaml）。请指定--root <框架根>，或在框架内执行';
  }
  if (!isDirectory(join(root, 'templates')) || !isDirectory(join(root, 'packages'))) {
    return '当前目录不像 gamekit 仓库（缺少 templates/ 或 packages/）。请确认--root指向框架目录';
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

  const dir = stringFlag(parsed, 'dir');
  if (parsed.flags['dir'] !== undefined && (dir === undefined || dir.trim() === '')) {
    ctx.stderr('mg create: --dir需要一个目标项目目录');
    return 1;
  }
  let root = findWorkspaceRoot(resolve(ctx.cwd, stringFlag(parsed, 'root') ?? '.'));
  // 显式--dir固定使用当前CLI所属框架，避免被调用目录中的另一套工作区劫持；--root可覆盖。
  if (dir !== undefined && stringFlag(parsed, 'root') === undefined) {
    root = fileURLToPath(new URL('../../../../', import.meta.url));
  }
  const rootIssue = assertGamekitRoot(root);
  if (rootIssue !== null) {
    ctx.stderr(`mg create: ${rootIssue}`);
    return 1;
  }

  const templateDir = join(root, 'templates', template);
  const gameDir = dir === undefined ? join(root, 'games', name) : resolve(ctx.cwd, dir);
  const games = resolve(root, 'games');
  const external = relative(games, dirname(gameDir)) !== '';
  const display = external ? gameDir : `games/${relative(games, gameDir).split(sep).join('/')}`;

  if (!isDirectory(templateDir)) {
    ctx.stderr(`mg create: 模板不存在：templates/${template}（可用：${listTemplates(root).join(' / ') || '无'}）`);
    return 1;
  }
  if (existsSync(gameDir)) {
    ctx.stderr(`mg create: 目标已存在：${display}`);
    return 1;
  }

  try {
    copyTemplate(templateDir, gameDir);
  } catch (error) {
    ctx.stderr(`mg create: 复制模板失败：${messageOf(error)}`);
    return 1;
  }

  const renamed = replacePackageName(gameDir, name);
  if (external) {
    try { prepareExternalProject(gameDir, root); }
    catch (error) { ctx.stderr(`mg create: 独立项目配置失败：${messageOf(error)}。已复制文件保留在${gameDir}`); return 1; }
  }
  ctx.stdout(`✔ 已创建 ${display}/（模板 ${template}）`);
  if (!renamed) ctx.stdout('  ⚠ 模板里没有可解析的 package.json，未替换项目名');
  if (existsSync(join(gameDir, 'AGENTS.md'))) {
    ctx.stdout(`  先读：${display}/AGENTS.md（给 AI 的工程约定：该读哪份文档、目录约定、禁止事项）`);
  }
  if (dir !== undefined) {
    ctx.stdout(external
      ? '  独立项目已链接本地框架；进入该目录执行pnpm install，然后pnpm dev / pnpm test / pnpm build / pnpm check'
      : '  在框架根执行pnpm install，再进入上述目录执行pnpm dev / pnpm test / pnpm build / pnpm check');
    return 0;
  }
  ctx.stdout('  下一步（任选其一，命令可直接复制）：');
  ctx.stdout(`    cd ${display} && node ../../packages/cli/bin/mg.mjs dev`);
  ctx.stdout(`    pnpm mg -- dev --root ${display}`);
  return 0;
};
