/**
 * `mg check [--target web|wx|tt] [--all] [--out-dir <dir>]`
 *
 * 读产物目录做三件事：主包红线、game.json 与产物目录一致、资源清单与产物一致。
 * 判定逻辑 `inspectArtifacts` 是纯函数（输入文件列表 + 两份 JSON），可单测；
 * 命令本身只负责读目录、打印、给退出码。
 *
 * 红线有两条，别混用：
 * - **4MB** = 微信 / 抖音主包硬限（插件构建时的告警线，见 `@mg/vite` 的 MAIN_LIMIT_BYTES）；
 * - **3MB** = 团队发布保守线（`mg check` 卡发布，给后续迭代和平台差异留余量）。
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_FILE, computeReport } from '@mg/vite-plugin';
import type { MgTarget } from '@mg/vite-plugin';
import { boolFlag, parseArgs, stringFlag } from '../args';
import {
  formatBytes,
  isRecord,
  projectRoot,
  readJson,
  resolveTargets,
  walkFiles,
} from '../shared';
import type { CliContext, CommandRunner } from '../shared';
import { runTypecheck } from './typecheck';

/** 团队发布保守线：3MB（平台硬限 4MB，见文件头注释）。 */
export const MAIN_LIMIT_BYTES = 3 * 1024 * 1024;

export type IssueLevel = 'error' | 'warn';

export interface ArtifactIssue {
  readonly level: IssueLevel;
  readonly message: string;
}

/**
 * 产物内一个文件（路径统一 `/` 分隔）。
 * 显式导出：`inspectArtifacts` 的调用方与测试都按这个结构传数据，
 * 与 `@mg/vite` 内部的 `FileSize` 保持隔离（那边字段名变化不影响这里）。
 */
export interface ArtifactFile {
  readonly relative: string;
  readonly bytes: number;
}

export interface CheckInput {
  readonly target: MgTarget;
  readonly files: readonly ArtifactFile[];
  readonly gameJson: unknown;
  readonly manifest: unknown;
}

export interface CheckOutcome {
  readonly target: MgTarget;
  readonly issues: readonly ArtifactIssue[];
  readonly mainBytes: number;
  readonly totalBytes: number;
  readonly ok: boolean;
}

interface SubpackageDecl {
  readonly name: string;
  readonly root: string;
}

const parseSubpackages = (gameJson: unknown): SubpackageDecl[] => {
  if (!isRecord(gameJson)) return [];
  const list = gameJson['subpackages'];
  if (!Array.isArray(list)) return [];
  const out: SubpackageDecl[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const name = typeof item['name'] === 'string' ? item['name'] : '';
    if (name === '') continue;
    const rawRoot = typeof item['root'] === 'string' ? item['root'] : `subpackages/${name}/`;
    out.push({ name, root: rawRoot.replace(/\/+$/g, '') });
  }
  return out;
};

const topLevelDirs = (files: readonly ArtifactFile[]): string[] => {
  const dirs = new Set<string>();
  for (const file of files) {
    const slash = file.relative.indexOf('/');
    if (slash > 0) dirs.add(file.relative.slice(0, slash));
  }
  return [...dirs];
};

const subpackageDirs = (files: readonly ArtifactFile[]): string[] => {
  const names = new Set<string>();
  for (const file of files) {
    const parts = file.relative.split('/');
    if (parts[0] === 'subpackages' && parts.length >= 3 && parts[1] !== undefined) {
      names.add(parts[1]);
    }
  }
  return [...names];
};

const isUnder = (rel: string, root: string): boolean => rel === root || rel.startsWith(`${root}/`);

/** 纯函数：检查一个产物目录。不读文件系统。 */
export const inspectArtifacts = (input: CheckInput): CheckOutcome => {
  const { target, files, gameJson, manifest } = input;
  const issues: ArtifactIssue[] = [];
  const push = (level: IssueLevel, message: string): void => {
    issues.push({ level, message });
  };

  const byRel = new Map<string, number>();
  for (const file of files) byRel.set(file.relative, file.bytes);

  // 1. 各端必需入口文件（三端产物都是单文件 game.js，web 另有 index.html）
  const required =
    target === 'web' ? ['index.html', 'game.js'] : ['game.js', 'game.json', 'project.config.json'];
  for (const name of required) {
    if (!byRel.has(name)) push('error', `缺少产物文件 ${name}`);
  }

  // 2. wx/tt：game.json 与产物目录一致
  const subpackages = target === 'web' ? [] : parseSubpackages(gameJson);
  const declaredNames = subpackages.map((item) => item.name);

  if (target !== 'web') {
    if (gameJson === null || gameJson === undefined) {
      push('error', 'game.json 缺失或无法解析');
    } else if (!isRecord(gameJson)) {
      push('error', 'game.json 结构非法（应为对象）');
    }
    for (const item of subpackages) {
      if (item.root !== `subpackages/${item.name}`) {
        push('error', `分包 ${item.name} 的 root 应为 subpackages/${item.name}/，实际 ${item.root}/`);
      }
      if (!files.some((file) => isUnder(file.relative, item.root))) {
        push('error', `game.json 声明的分包 ${item.name}（${item.root}/）在产物里没有文件`);
      }
    }
    for (const dir of topLevelDirs(files)) {
      if (dir !== 'assets' && dir !== 'subpackages') {
        push('error', `产物顶层目录 ${dir}/ 不属于主包 assets/ 或分包 subpackages/`);
      }
    }
    for (const name of subpackageDirs(files)) {
      if (!declaredNames.includes(name)) {
        push('error', `产物分包目录 subpackages/${name}/ 未在 game.json.subpackages 声明`);
      }
    }
  }

  // 3. 主包体积：复用 @mg/vite 的分包归账口径（subpackages/<name>/ 不计主包）。
  // 这里做显式映射而不是直接把 files 传进去：FileSize 是插件的内部类型，
  // 字段一旦改名，这行会在编译期报错，而不是静默算错主包体积。
  const report = computeReport(
    files.map((file) => ({ relative: file.relative, bytes: file.bytes })),
    declaredNames,
  );
  if (report.main > MAIN_LIMIT_BYTES) {
    push(
      'error',
      `主包 ${formatBytes(report.main)} 超过 3MB 团队发布线（上限 ${formatBytes(MAIN_LIMIT_BYTES)}）`,
    );
  }

  // 4. 资源清单与产物一致（清单里登记的候选路径必须真打进包，否则客户端会 404）
  if (manifest === null || manifest === undefined) {
    push('error', `缺少资源清单 ${MANIFEST_FILE}`);
  } else if (!isRecord(manifest)) {
    push('error', `${MANIFEST_FILE} 结构非法（应为 key → 候选路径数组）`);
  } else {
    let listed = 0;
    for (const [key, paths] of Object.entries(manifest)) {
      listed += 1;
      if (!Array.isArray(paths) || paths.length === 0) {
        push('error', `清单条目 ${key} 没有候选路径`);
        continue;
      }
      for (const path of paths) {
        if (typeof path !== 'string' || path === '') {
          push('error', `清单条目 ${key} 含非法路径：${String(path)}`);
          continue;
        }
        if (!byRel.has(path)) {
          push('error', `清单登记了产物里不存在的资源：${path}（客户端会 404）`);
        }
      }
    }
    if (listed === 0) push('warn', '资源清单为空（本项目没有美术资源？）');
  }

  return {
    target,
    issues,
    mainBytes: report.main,
    totalBytes: report.total,
    ok: !issues.some((issue) => issue.level === 'error'),
  };
};

const printOutcome = (ctx: CliContext, outDir: string, outcome: CheckOutcome): void => {
  const mark = outcome.ok ? '✔' : '✘';
  ctx.stdout(
    `${mark} ${outcome.target}: 主包 ${formatBytes(outcome.mainBytes)} / 合计 ${formatBytes(outcome.totalBytes)}（${outDir}）`,
  );
  for (const issue of outcome.issues) {
    ctx.stdout(`   ${issue.level === 'error' ? '✘' : '⚠'} ${issue.message}`);
  }
};

export const runCheck: CommandRunner = async (argv, ctx) => {
  const parsed = parseArgs(argv);
  const root = projectRoot(ctx, parsed);

  // 有 tsconfig 就先 typecheck（与 mg build 同口径；--skip-typecheck 可跳过）
  if (!boolFlag(parsed, 'skip-typecheck')) {
    const tc = runTypecheck(root, ctx);
    if (!tc.ok) return 1;
  }
  const explicitTarget = stringFlag(parsed, 'target');
  const targets = resolveTargets(parsed, 'all');
  if (targets === null) {
    ctx.stderr('mg check: --target 只能是 web / wx / tt');
    return 1;
  }

  const outDirFlag = stringFlag(parsed, 'out-dir');
  let checked = 0;
  let failed = 0;

  for (const target of targets) {
    const outDir = outDirFlag ?? join(root, 'build', target);
    if (!existsSync(outDir)) {
      if (explicitTarget !== undefined) {
        ctx.stderr(`mg check: 产物目录不存在：${outDir}`);
        failed += 1;
      } else {
        ctx.stdout(`- ${target}: 未构建（${outDir} 不存在），跳过`);
      }
      continue;
    }
    const outcome = inspectArtifacts({
      target,
      files: walkFiles(outDir),
      gameJson: readJson(join(outDir, 'game.json')),
      manifest: readJson(join(outDir, MANIFEST_FILE)),
    });
    checked += 1;
    printOutcome(ctx, outDir, outcome);
    if (!outcome.ok) failed += 1;
  }

  if (checked === 0) {
    ctx.stderr('mg check: 没有任何可检查的产物，先跑 mg build --all');
    return 1;
  }
  ctx.stdout(
    failed === 0 ? `✔ check 通过（${checked} 个产物）` : `✘ check 失败（${failed}/${checked} 个产物）`,
  );
  return failed === 0 ? 0 : 1;
};
