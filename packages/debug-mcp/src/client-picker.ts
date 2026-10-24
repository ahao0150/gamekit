/**
 * 运行时工具的「目标客户端」选择（T24）。
 *
 * 规则（写死，测试逐条锁住）：
 * - `client` 参数指定了 id → 打它；不在线就**明确报错**（带上当前在线列表），
 *   绝不静默落到别人身上——「打错客户端」比「打不到」更难查；
 * - 没指定 → 打**最新连上**的那个（单客户端场景与旧行为完全一致）；
 * - 一条都没有 → 报「游戏没连上」并告诉 AI 下一步怎么做。
 */

import type { DebugClient } from './client-connection';
import type { WsServer } from './ws-server';

/** 给 `clients` 工具用的客户端摘要。 */
export interface ClientSummary {
  readonly id: string;
  readonly platform: string;
  readonly screen: { readonly width: number; readonly height: number; readonly dpr: number } | null;
  /** ISO 时间字符串（人读友好；原始 ms 时间戳在 DebugClient.connectedAt） */
  readonly connectedAt: string;
}

export const NOT_CONNECTED =
  '游戏没连上调试服务端。先跑 `node packages/cli/bin/mg.mjs dev`（web），再打开日志里报的 http://127.0.0.1:<port>/ 页面，' +
  '游戏启动后会自动连 ws://127.0.0.1:7788。多个页面同时打开时先调 clients 看在线列表。';

export interface ClientPicker {
  /** 选目标客户端；出错抛中文（由工具层统一转成 isError 结果）。 */
  pick(params: Record<string, unknown>): DebugClient;
  /** 最新连上的；没有返回 null（watch 轮询用，不能抛）。 */
  latest(): DebugClient | null;
  /** 在线列表（clients 工具用）。 */
  list(): readonly ClientSummary[];
}

/** 客户端 → 摘要（clients 工具的输出形状）。 */
export const summarizeClient = (client: DebugClient): ClientSummary => ({
  id: client.id,
  platform: client.hello?.platform ?? 'unknown',
  screen: client.hello?.screen ?? null,
  connectedAt: new Date(client.connectedAt).toISOString(),
});

/** 造一个选择器（`server()` 返回 null 表示 WebSocket 没起来）。 */
export const createClientPicker = (server: () => WsServer | null): ClientPicker => {
  const online = (): readonly DebugClient[] => server()?.clients() ?? [];
  return {
    list(): readonly ClientSummary[] {
      return online().map(summarizeClient);
    },
    latest(): DebugClient | null {
      return server()?.latest() ?? null;
    },
    pick(params: Record<string, unknown>): DebugClient {
      const ref = server();
      if (ref === null) throw new Error(NOT_CONNECTED);
      const raw = params['client'];
      if (raw !== undefined) {
        if (typeof raw !== 'string' || raw.trim().length === 0) {
          throw new Error(`client 参数需要连接 id（如 c1 / c2），收到「${typeof raw === 'string' ? raw : String(raw)}」`);
        }
        const id = raw.trim();
        const found = ref.get(id);
        if (found === null) {
          const ids = ref.clients().map((client) => client.id);
          throw new Error(`客户端 ${id} 已断开，当前在线：${ids.length > 0 ? ids.join(', ') : '（没有客户端连接）'}`);
        }
        return found;
      }
      const latest = ref.latest();
      if (latest === null) throw new Error(NOT_CONNECTED);
      return latest;
    },
  };
};
