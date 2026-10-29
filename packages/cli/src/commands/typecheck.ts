/**
 * 在游戏项目根跑 `tsc --noEmit`。
 * 挂进 `mg build`（构建前必过）与 `mg check`（有 tsconfig 就跑）。
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { findFrameworkRoot } from '../shared';
import type { CliContext } from '../shared';

export interface TypecheckResult {
  readonly ok: boolean;
  readonly skipped: boolean;
  readonly detail: string;
}

/**
 * 解析本仓库的 tsc 入口；找不到返回 null（调用方决定跳过还是报错）。
 */
export const resolveTsc = (projectRoot: string): string | null => {
  const workspace = findFrameworkRoot(projectRoot);
  const candidates = [
    join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    join(workspace, 'node_modules', 'typescript', 'bin', 'tsc'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
};

/** 跑类型检查。无 tsconfig → skipped；tsc 非 0 → ok=false。 */
export const runTypecheck = (projectRoot: string, ctx: CliContext): TypecheckResult => {
  const tsconfig = join(projectRoot, 'tsconfig.json');
  if (!existsSync(tsconfig)) {
    return { ok: true, skipped: true, detail: '无 tsconfig.json，跳过 typecheck' };
  }
  const tsc = resolveTsc(projectRoot);
  if (tsc === null) {
    ctx.stderr('mg typecheck: 找不到 typescript/bin/tsc，请先在仓库根 pnpm install');
    return { ok: false, skipped: false, detail: 'tsc 不存在' };
  }
  ctx.stdout('[mg] typecheck …');
  const result = spawnSync(process.execPath, [tsc, '--noEmit', '--pretty', 'false', '-p', tsconfig], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  const stdout = (result.stdout ?? '').trim();
  const stderr = (result.stderr ?? '').trim();
  if (stdout !== '') ctx.stdout(stdout);
  if (stderr !== '') ctx.stderr(stderr);
  if (result.status === 0) {
    ctx.stdout('[mg] typecheck 通过');
    return { ok: true, skipped: false, detail: 'ok' };
  }
  ctx.stderr(`[mg] typecheck 失败（exit ${result.status ?? 'null'}）`);
  return { ok: false, skipped: false, detail: `exit ${result.status ?? 'null'}` };
};
