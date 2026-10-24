/**
 * `mg` 命令入口：只做「解析命令名 → 找到命令 → 交给它执行 → 返回退出码」。
 * 具体逻辑全在 commands/ 里；这里不碰文件系统、不读写配置。
 *
 * 入口由 `bin/mg.mjs` 提供（Node 原生类型剥离 + resolve 钩子，零构建产物直接跑），
 * 本文件以库的形式导出 `main()`，供宿主脚本与测试调用。
 */

import { runBuild } from './commands/build';
import { runCheck } from './commands/check';
import { runCreate } from './commands/create';
import { runDev } from './commands/dev';
import { runDoctor } from './commands/doctor';
import { runPack } from './commands/pack';
import { createCliContext, messageOf } from './shared';
import type { CliContext, CommandRunner } from './shared';

export const USAGE = [
  'mg —— gamekit 命令行',
  '',
  '用法：mg <命令> [选项]',
  '',
  '命令：',
  '  create <name> [--template <名>]               从模板创建 games/<name>/（默认 iaa-ui）',
  '  dev [--target web|wx|tt] [--port <n>] [--host <addr>]',
  '                                                开发：web 起 dev server，wx/tt 构建监听',
  '  build [--target web|wx|tt] [--all]            构建产物到 build/<target>/（先 typecheck）',
  '  check [--target web|wx|tt] [--all] [--out-dir <dir>]',
  '                                                先 typecheck，再查包体红线 / game.json / 资源清单',
  '  pack [--write]                                美术资源压缩（骨架，流水线待接）',
  '  doctor                                        环境与仓库体检',
  '',
  '通用：--root <dir> 指定仓库根（默认从 cwd 向上找 pnpm-workspace.yaml）',
  '      -h, --help  显示帮助（`mg <命令> --help` 只看该命令）',
].join('\n');

/** 通用选项说明：每个子命令帮助都带一段，避免各写一份。 */
const COMMON = [
  '',
  '通用选项：',
  '  --root <dir>   指定仓库根（默认从 cwd 向上找 pnpm-workspace.yaml）',
  '  -h, --help     显示本命令帮助',
].join('\n');

/**
 * 子命令帮助：`mg <命令> --help` 打这个，而不是整份总帮助。
 *
 * 为什么不从 USAGE 里截行：一行摘要装不下参数语义，而「`--help` 打出来的是别的
 * 命令的用法」正是探针会误判成「命令不存在」的地方。
 */
export const COMMAND_HELP: Readonly<Record<string, string>> = {
  create: [
    '用法：mg create <name> [--template <名>]',
    '',
    '把 templates/<名>/ 复制到 games/<name>/（必须在 gamekit 仓库内），并替换 package.json name。',
    '  --template <名>  模板目录名，默认 iaa-ui；templates/ 下的目录都能用',
    '                   （iaa-ui = .ui 界面链，推荐；iaa-simple = 手写布局链）',
    COMMON,
  ].join('\n'),
  dev: [
    '用法：mg dev [--target web|wx|tt] [--port <端口>] [--host <地址>] [--strict-port]',
    '',
    'web：起 dev server（默认绑 127.0.0.1，日志报实际 host:port）；wx/tt：构建监听。',
    '  --port <端口>   指定端口（默认 5173）',
    '  --host <地址>   指定监听地址（默认 127.0.0.1；0.0.0.0 可在局域网预览）',
    '  --strict-port   端口被占直接报错退出（exit 1），不静默顺延',
    COMMON,
  ].join('\n'),
  build: [
    '用法：mg build [--target web|wx|tt] [--all] [--skip-typecheck]',
    '',
    '产物到 build/<target>/；设计分辨率与 fit 取自 game.config.json（唯一真源）。',
    '默认先跑 tsc --noEmit；.ui 是否都被 import 由 ui-plugin 在构建结束时强制检查。',
    '  --all              三端都构建',
    '  --skip-typecheck   跳过类型检查（不推荐）',
    COMMON,
  ].join('\n'),
  check: [
    '用法：mg check [--target web|wx|tt] [--all] [--out-dir <dir>] [--skip-typecheck]',
    '',
    '先 typecheck（有 tsconfig 时），再查包体红线 / game.json / 资源清单。',
    '  --out-dir <dir>       报告输出目录',
    '  --skip-typecheck      跳过类型检查',
    COMMON,
  ].join('\n'),
  pack: [
    '用法：mg pack [--write]',
    '',
    '美术资源压缩（骨架，流水线待接）。',
    '  --write         真的写回压缩结果（不加只打印计划）',
    COMMON,
  ].join('\n'),
  doctor: ['用法：mg doctor', '', '环境与仓库体检（error 决定退出码，warning 只提示）。', COMMON].join('\n'),
};

/** 命令表：命令名 → 实现。未知命令由 main 报错。 */
export const COMMANDS: Readonly<Record<string, CommandRunner>> = {
  create: runCreate,
  dev: runDev,
  build: runBuild,
  check: runCheck,
  pack: runPack,
  doctor: runDoctor,
};

/**
 * 执行一次 CLI 调用，返回进程退出码（0 成功 / 1 失败）。
 * 不调用 process.exit，方便宿主与测试接管。
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  ctx: CliContext = createCliContext(),
): Promise<number> {
  const command = argv[0];
  if (command === undefined || command === 'help' || command === '-h' || command === '--help') {
    ctx.stdout(USAGE);
    return 0;
  }

  const runner = COMMANDS[command];
  if (runner === undefined) {
    ctx.stderr(`mg: 未知命令 ${command}`);
    ctx.stderr(USAGE);
    return 1;
  }

  const rest = argv.slice(1);
  if (rest.includes('-h') || rest.includes('--help')) {
    // 子命令帮助优先：`mg check --help` 要看到 check 的用法，不是整份命令表
    ctx.stdout(COMMAND_HELP[command] ?? USAGE);
    return 0;
  }

  try {
    return await runner(rest, ctx);
  } catch (error) {
    ctx.stderr(`mg ${command}: ${messageOf(error)}`);
    return 1;
  }
}
