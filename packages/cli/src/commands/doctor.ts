/**
 * `mg doctor`：环境与仓库体检。
 * 只读：不改文件、不装依赖。error 决定退出码，warn 只提示。
 */

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs, stringFlag } from '../args';
import { findFrameworkRoot, readGameConfig } from '../shared';
import type { CliContext, CommandRunner } from '../shared';

/** 与根 package.json engines.node 对齐。 */
export const REQUIRED_NODE_MAJOR = 22;

export type CheckLevel = 'ok' | 'warn' | 'error';

export interface DoctorCheck {
  readonly level: CheckLevel;
  readonly message: string;
  readonly hint?: string;
}

const SYMBOL: Readonly<Record<CheckLevel, string>> = { ok: '✔', warn: '⚠', error: '✘' };

const CONTRACT_FILES: readonly string[] = [
  'packages/runtime/src/platform/contract.ts',
  'packages/runtime/src/core/loop/contract.ts',
  'packages/runtime/src/core/stage/contract.ts',
  'packages/runtime/src/core/input/contract.ts',
  'packages/runtime/src/core/assets/contract.ts',
  'packages/runtime/src/core/audio/contract.ts',
  'packages/runtime/src/core/ads/contract.ts',
  'packages/runtime/src/core/save/contract.ts',
  'packages/runtime/src/core/ui/contract.ts',
  'packages/runtime/src/core/render/contract.ts',
];

const PACKAGE_DIRS: readonly string[] = ['packages/runtime', 'packages/vite-plugin', 'packages/cli'];
const TARGET_DIRS: readonly string[] = ['web', 'wx', 'tt'];

const detectPnpm = (): string | null => {
  try {
    const out = execSync('pnpm --version', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    const version = out.trim();
    return version === '' ? null : version;
  } catch {
    return null;
  }
};

/** 纯组装：按 root 收集体检项。pnpm 版本可注入，便于单测跳过子进程。 */
export const collectChecks = (root: string, pnpmVersion: string | null = detectPnpm()): DoctorCheck[] => {
  const checks: DoctorCheck[] = [];

  const nodeVersion = process.versions.node;
  const nodeMajor = Number.parseInt(nodeVersion.split('.')[0] ?? '0', 10);
  checks.push(
    nodeMajor >= REQUIRED_NODE_MAJOR
      ? {
          level: 'ok',
          message: `Node.js ${nodeVersion}，符合要求（需要 ≥ ${REQUIRED_NODE_MAJOR}）`,
        }
      : {
          level: 'error',
          message: `当前 Node.js 是 ${nodeVersion}，太旧了（需要 ≥ ${REQUIRED_NODE_MAJOR}）`,
          hint: `请升级到 Node ${REQUIRED_NODE_MAJOR} 或更高（推荐 fnm / nvm：nvm install ${REQUIRED_NODE_MAJOR}）`,
        },
  );

  checks.push(
    pnpmVersion !== null
      ? { level: 'ok', message: `pnpm ${pnpmVersion} 已安装` }
      : {
          level: 'warn',
          message: '本机还没有 pnpm',
          hint: '在仓库根执行：corepack enable && corepack prepare pnpm@latest --activate',
        },
  );

  checks.push(
    existsSync(join(root, 'node_modules'))
      ? { level: 'ok', message: '依赖已安装（找到 node_modules）' }
      : {
          level: 'warn',
          message: '还没装依赖（没有 node_modules）',
          hint: '在仓库根执行：pnpm install',
        },
  );

  const missingPackages = PACKAGE_DIRS.filter((dir) => !existsSync(join(root, dir)));
  checks.push(
    missingPackages.length === 0
      ? { level: 'ok', message: `包目录齐全（${PACKAGE_DIRS.length} 个）` }
      : { level: 'error', message: `缺少包目录：${missingPackages.join(' / ')}` },
  );

  const missingContracts = CONTRACT_FILES.filter((file) => !existsSync(join(root, file)));
  checks.push(
    missingContracts.length === 0
      ? { level: 'ok', message: `契约文件齐全（${CONTRACT_FILES.length} 份）` }
      : {
          level: 'error',
          message: `缺少契约文件：${missingContracts.join(' / ')}`,
          hint: '契约是冻结文件，缺失说明仓库被裁剪或不完整',
        },
  );

  checks.push(
    existsSync(join(root, 'templates', 'iaa-ui'))
      ? { level: 'ok', message: '默认模板 templates/iaa-ui 就绪' }
      : { level: 'warn', message: '默认模板 templates/iaa-ui 不存在', hint: 'mg create 默认用它' },
  );

  return checks;
};

/** 项目检查与仓库环境检查分开，避免在仓库根误报游戏配置和产物缺失。 */
export const collectProjectChecks = (project: string): DoctorCheck[] => {
  const config = readGameConfig(project);
  const checks: DoctorCheck[] = [];
  checks.push(config?.design !== undefined
    ? { level: 'ok', message: '项目配置有效（design 分辨率已设置）' }
    : { level: 'error', message: `项目配置缺失或无效：${project}`, hint: '设置 game.config.json（或 package.json 的 mg 字段）中的 design.width / height' });
  const built = TARGET_DIRS.filter(target => existsSync(join(project, 'build', target, 'game.js')));
  checks.push(built.length === TARGET_DIRS.length
    ? { level: 'ok', message: '三端构建入口齐全（build/web · wx · tt）；包体与配置请继续运行 mg check' }
    : { level: 'warn', message: `项目产物：${built.length === 0 ? '尚未构建' : `已有 ${built.join(' / ')}`}`, hint: '在项目目录执行 pnpm build，或 mg build --root <项目路径> --all' });
  return checks;
};

/** 打印体检结果。 */
export const printChecks = (ctx: CliContext, checks: readonly DoctorCheck[]): void => {
  for (const check of checks) {
    ctx.stdout(`${SYMBOL[check.level]} ${check.message}`);
    if (check.hint !== undefined) ctx.stdout(`   ↳ ${check.hint}`);
  }
};

/** 有 error 就退出码 1。 */
export const exitCodeOf = (checks: readonly DoctorCheck[]): number =>
  checks.some((check) => check.level === 'error') ? 1 : 0;

export const runDoctor: CommandRunner = async (argv, ctx) => {
  const parsed = parseArgs(argv);
  const project = resolve(ctx.cwd, stringFlag(parsed, 'root') ?? '.');
  const root = findFrameworkRoot(project);
  ctx.stdout(`mg doctor: 仓库根 ${root}`);

  const checks = collectChecks(root);
  const underGames = relative(root, project).split(sep)[0] === 'games';
  const explicitProject = stringFlag(parsed, 'root') !== undefined && project !== root;
  if (underGames || explicitProject || readGameConfig(project) !== null) {
    ctx.stdout(`mg doctor: 游戏项目 ${project}`);
    checks.push(...collectProjectChecks(project));
  } else {
    ctx.stdout('仓库级体检；检查游戏请使用 mg doctor --root games/<name>');
  }
  printChecks(ctx, checks);
  const errors = checks.filter((check) => check.level === 'error').length;
  ctx.stdout(errors === 0 ? '✔ 体检通过' : `✘ 体检发现 ${errors} 个错误`);
  return exitCodeOf(checks);
};
