/**
 * `mg dev [--target web|wx|tt] [--port <n>] [--host <addr>] [--strict-port]`
 *
 * web：起 Vite dev server（保存即刷新）；wx/tt：`build --watch`，配合开发者工具。
 * 构建行为全部在 `@mg/vite`，这里只做启动与日志。
 *
 * `--port` / `--host` / `--strict-port`（web 端）：
 * - `--port <n>` 指定端口，不传就 5173 起、被占则自动往后顺延（老行为不变）。
 * - `--host <addr>` 指定监听地址，默认 127.0.0.1；`0.0.0.0` 可让同网段设备预览。
 * - `--strict-port` 传了以后，端口被占用**直接报错退出**，绝不静默换端口。
 *   门禁与 CI 必须能确定自己打的是哪一个端口 —— 静默换端口的后果是
 *   测到了同机另一个服务还全绿。
 * - 默认 host 用 127.0.0.1（不用 localhost）：双栈机器上 localhost 会解析到 ::1，
 *   同一个端口的 IPv4 可能被别的服务占着，按 127.0.0.1 访问就打到了别人。
 */

import { build as viteBuild, createServer } from 'vite';
import { mgPlugin } from '@mg/vite-plugin';
import { boolFlag, parseArgs, portFlag, stringFlag } from '../args';
import type { ParsedArgs } from '../args';
import { messageOf, projectRoot, readGameConfig, resolveTargets } from '../shared';
import type { CommandRunner } from '../shared';

/** web dev server 默认只绑本机回环。局域网预览显式传 `--host 0.0.0.0`。 */
export const DEFAULT_DEV_HOST = '127.0.0.1';

export interface DevHostResult {
  readonly host: string;
  /** 有值表示 --host 传了但缺值/空值，由命令报错退出。 */
  readonly error?: string;
}

/**
 * 解析 `--host`：未传用默认值；传了但缺值（`--host` 后面直接跟选项）或空值就报错。
 * 不在解析层校验 IP 格式：host 也允许 localhost / 域名 / IPv6，交给 Vite 绑定失败时报错。
 */
export function resolveDevHost(parsed: ParsedArgs): DevHostResult {
  const raw = parsed.flags['host'];
  if (raw === undefined) return { host: DEFAULT_DEV_HOST };
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') {
    return {
      host: DEFAULT_DEV_HOST,
      error: 'mg dev: --host 需要一个监听地址（如 127.0.0.1 / 0.0.0.0），收到「（缺值）」',
    };
  }
  return { host: value };
}

export const runDev: CommandRunner = async (argv, ctx) => {
  const parsed = parseArgs(argv);
  const root = projectRoot(ctx, parsed);
  const targets = resolveTargets(parsed, 'web');
  if (targets === null || targets.length !== 1) {
    ctx.stderr('mg dev: --target 只能是 web / wx / tt，且一次只跑一个端');
    return 1;
  }
  const target = targets[0];
  if (target === undefined) return 1;

  // 端口参数：解析层只收 1-65535 的整数，非法值在这里就报错退出，
  // 不让一个怪端口流到 Vite 那边去猜。
  const hasPort = parsed.flags['port'] !== undefined;
  const port = portFlag(parsed, 'port');
  if (hasPort && port === undefined) {
    const shown = stringFlag(parsed, 'port') ?? '（缺值）';
    ctx.stderr(`mg dev: --port 必须是 1-65535 的整数端口，收到「${shown}」`);
    return 1;
  }
  const strictPort = boolFlag(parsed, 'strict-port');

  // host：默认 127.0.0.1；缺值在启动前就报错，不让空字符串流到 Vite。
  const hostResult = resolveDevHost(parsed);
  if (hostResult.error !== undefined) {
    ctx.stderr(hostResult.error);
    return 1;
  }
  const host = hostResult.host;
  const hasHost = parsed.flags['host'] !== undefined;

  const config = readGameConfig(root);
  const design = config?.design;
  if (design === undefined) {
    ctx.stderr(
      'mg dev: 找不到设计分辨率。在 game.config.json 写 {"design":{"width":390,"height":844}}（或 package.json 的 mg 字段）',
    );
    return 1;
  }

  const plugin = mgPlugin({
    target,
    root,
    design,
    fit: config?.fit,
    assetsDir: config?.assetsDir,
    subpackages: config?.subpackages,
    title: config?.title,
    atlas: config?.atlas,
  });

  // server 声明在 try 外：启动失败时要能拿到它并关掉。
  // 不关的话 Vite 留下的 watcher / 依赖扫描器会吊住进程 —— 退出码出不来，
  // 门禁和 CI 就会卡在这儿（端口被占时必须**报错退出**，这是硬要求）。
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    if (target === 'web') {
      server = await createServer({
        plugins: [plugin],
        logLevel: 'info',
        server: {
          // 默认 host 是 IPv4 回环：localhost 在双栈机器上会解析到 ::1，而同一个端口的
          // IPv4 可能被别的服务占着 —— 按 127.0.0.1 访问就会打到别人的服务上。
          // 需要局域网预览时显式传 --host 0.0.0.0。
          host,
          ...(port === undefined ? {} : { port }),
          ...(strictPort ? { strictPort: true } : {}),
        },
      });
      await server.listen();
      // 报**实际**绑定的 host:port：strictPort 关着时 Vite 会自动顺延（5173 被占 → 5174…），
      // 报期望端口会让人打错端口。地址按 --host 拼，默认仍是 127.0.0.1。
      const address = server.httpServer?.address();
      const actualPort =
        address !== null && address !== undefined && typeof address === 'object' && typeof address.port === 'number'
          ? address.port
          : (port ?? 5173);
      ctx.stdout(`mg dev: http://${host}:${actualPort}/`);
      ctx.stdout(
        `mg dev: 实际绑定 ${host}:${actualPort}` +
          (strictPort ? '（--strict-port：端口被占直接失败）' : '（端口被占会自动顺延）'),
      );
      if (host === '0.0.0.0') {
        ctx.stdout(
          `mg dev: 正在监听全部网卡：本机访问 http://127.0.0.1:${actualPort}/，` +
            `局域网设备访问 http://<本机局域网IP>:${actualPort}/`,
        );
      }
      ctx.stdout('mg dev: 保存即刷新；Ctrl+C 停止');
    } else {
      await viteBuild({ plugins: [plugin], logLevel: 'info', build: { watch: {} } });
      ctx.stdout(`mg dev: ${target} 构建监听中（没有 HMR，产物在 build/${target}/）`);
      if (hasPort) ctx.stdout('mg dev: --port 只对 web 端生效，wx/tt 走构建监听');
      if (hasHost) ctx.stdout('mg dev: --host 只对 web 端生效，wx/tt 走构建监听');
    }
  } catch (error) {
    ctx.stderr(`mg dev: 启动失败：${messageOf(error)}`);
    if (server !== undefined) {
      await server.close().catch(() => {
        // 关不掉就往下走：退出码比清理更重要
      });
    }
    return 1;
  }
  return 0;
};
