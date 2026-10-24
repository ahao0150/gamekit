/**
 * `@mg/debug-mcp` 入口：MCP stdio 服务 + WebSocket 服务端（游戏侧）。
 *
 * 两组工具，生命周期不同：
 * - **离线 `ui.*`**（check / layout / preview / grammar / pattern）：纯 Node 调 runtime
 *   的纯函数，**不需要启动游戏、不需要连 WebSocket**；
 * - **运行时 `canvas/tree/state/screenshot/click`**：需要游戏连上 WebSocket。
 *
 * 因此 WebSocket 起不来（端口被占等）**不影响 MCP 启动**：离线工具照常可用，
 * 运行时工具会返回「游戏没连上」的中文提示。stdin 关闭（MCP 客户端退出）时自己收摊，
 * 不留孤儿进程。
 *
 * **stdout 是协议通道**：这里所有日志都写 stderr。
 */

import { resolve } from 'node:path';
import { createAnalysisTools } from './analysis-tools';
import { createClientPicker } from './client-picker';
import { createClientsTool } from './clients-tool';
import { startMcpServer } from './mcp';
import type { McpServer } from './mcp';
import { callSaveStub, SAVE_STUB_SPECS } from './save-stub-tools';
import { createTools } from './tools';
import { createUiTools } from './ui-tools';
import { createWsServer } from './ws-server';
import type { DebugClient, WsServer } from './ws-server';
import type { WatchEvent } from './watch';

/** 默认端口。和游戏侧 `bridge.ts` 的默认地址保持一致。 */
export const DEFAULT_PORT = 7788;

const log = (line: string): void => void process.stderr.write(`[mg-debug-mcp] ${line}\n`);

/** 解析 `--port <n>`；非法值抛中文错误。 */
export function parsePort(argv: readonly string[]): number {
  const at = argv.indexOf('--port');
  if (at < 0) return DEFAULT_PORT;
  const raw = argv[at + 1];
  const port = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--port 需要 1-65535 的整数端口，收到「${raw ?? '（缺值）'}」`);
  }
  return port;
}

export const main = async (argv: readonly string[] = process.argv.slice(2)): Promise<number> => {
  let port: number;
  try {
    port = parsePort(argv);
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const outDir = resolve(process.cwd(), 'out', 'debug');
  const snapshotDir = resolve(process.cwd(), 'out', 'mcp-snapshots');
  let ws: WsServer | null = null;
  let closeMcp: () => void = () => undefined;
  let mcpRef: McpServer | null = null;

  // 多客户端：所有运行时工具通过 picker 选目标（默认最新连上的，可用 client 参数指定）
  const picker = createClientPicker(() => ws);
  const runtimeTools = createTools({ resolve: (params) => picker.pick(params), outDir: () => outDir });
  const uiTools = createUiTools();
  const clientsTool = createClientsTool(picker);
  const analysisTools = createAnalysisTools({
    resolve: (params) => picker.pick(params),
    latest: () => picker.latest(),
    snapshotDir: () => snapshotDir,
    notify: (event: WatchEvent): void => {
      mcpRef?.notify('notifications/message', { level: 'info', logger: 'mg.watch', data: event });
    },
  });

  const shutdown = (): void => {
    analysisTools.dispose();
    closeMcp();
    if (ws !== null) {
      void ws.close().catch(() => undefined);
      ws = null;
    }
    process.exitCode = 0;
  };

  // 先起 MCP：即使 WebSocket 端口被占，离线工具也必须可用
  const mcp = startMcpServer({
    specs: [...uiTools.specs, ...runtimeTools.specs, ...analysisTools.specs, ...clientsTool.specs, ...SAVE_STUB_SPECS],
    call: (name, params) => {
      const stub = callSaveStub(name);
      if (stub !== null) return Promise.resolve(stub);
      return uiTools.handles(name)
        ? uiTools.call(name, params)
        : clientsTool.handles(name)
          ? clientsTool.call(name, params)
          : analysisTools.handles(name)
            ? analysisTools.call(name, params)
            : runtimeTools.call(name, params);
    },
    log,
    onInputClose: shutdown,
  });
  mcpRef = mcp;
  closeMcp = mcp.close;

  try {
    ws = await createWsServer(port);
    ws.onClient((client: DebugClient) => {
      const screen = client.hello?.screen;
      const detail =
        screen === undefined ? `平台 ${client.hello?.platform ?? '?'}` : `平台 ${client.hello?.platform ?? '?'}，画面 ${screen.width}×${screen.height} @${screen.dpr}x`;
      log(`游戏已连上：${client.id}（${detail}），当前在线 ${ws?.clients().length ?? 1} 个`);
    });
    ws.onGone((client: DebugClient) => {
      log(`客户端 ${client.id} 已断开（当前在线 ${ws?.clients().length ?? 0} 个）`);
    });
    log(`WebSocket 已监听 ws://127.0.0.1:${port}，等游戏连上来`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(
      `WebSocket 未启动（127.0.0.1:${port}：${reason}）。离线工具 ui.* 照常可用；` +
        '运行时工具需要游戏连接。换端口：--port 7789',
    );
  }

  log('MCP 离线工具：ui.check / ui.layout / ui.preview / ui.grammar / ui.pattern');
  log('MCP 运行时工具：canvas / tree / state / screenshot / click（多客户端时加 client: c2）');
  log('MCP 分析工具：snapshot / snapshotList / diff / checkRender / watch');
  log('MCP 客户端列表：clients（多客户端并存时先用它看 id）');
  log(`截图默认输出：${outDir}`);
  log(`快照目录：${snapshotDir}`);

  // 退出时把 WebSocket 服务关掉，避免端口被占住（关不掉也不影响退出码）
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return 0;
};
