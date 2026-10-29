/**
 * 最小 WebSocket 服务端（RFC 6455 子集）+ **多客户端集合**（T24）。
 *
 * 为什么不用 `ws` 包：这个仓库是「零运行时依赖」，加包要动 `pnpm-lock.yaml`；
 * 手写一个 200 行的子集成本更低。帧格式在 `frame.ts`，单条连接在 `client-connection.ts`。
 *
 * T24 修的真问题：以前服务端只保留「单个当前客户端」，页面一热更就重新执行 `boot()`，
 * 旧 bridge 不销毁 → 两个 bridge 交替连上、互相顶掉 → 验收状态被清（dev-bot 实测
 * hits 走 1→2→0）。现在改成**集合**：
 * - 每条连接分配稳定 id（`c1` / `c2`…，断开不复用），hello 时回给游戏侧；
 * - 默认目标 = 最新连上的（单客户端行为不变），也可用 `client: 'c2'` 精确指定；
 * - 断开只移除自己，**不顶掉**别人。
 */

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { ClientConnection } from './client-connection';
import type { DebugClient } from './client-connection';

export type { DebugClient } from './client-connection';

/** RFC 6455 规定的握手 GUID，固定值。 */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface WsServer {
  /** 实际监听端口（传 0 时是系统分配的，测试用） */
  readonly port: number;
  /** 某个客户端 hello 完成（真正可用）时回调；多个客户端各自回调。 */
  onClient(cb: (client: DebugClient) => void): void;
  /** 客户端断开时回调（清理该客户端的状态用）。 */
  onGone(cb: (client: DebugClient) => void): void;
  /** 当前在线客户端（按 hello 顺序；只有 hello 过的才算「可用」）。 */
  clients(): readonly DebugClient[];
  /** 按 id 找在线客户端；不在线返回 null。 */
  get(id: string): DebugClient | null;
  /** 最新连上的那个（单客户端场景的默认目标）。 */
  latest(): DebugClient | null;
  close(): Promise<void>;
}

export const createWsServer = (port: number, host = '127.0.0.1'): Promise<WsServer> => {
  const httpServer = createServer((_req, res) => {
    res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('这里只接受 WebSocket 升级请求（游戏侧 bridge 会自动连上来）');
  });
  /** id 自增且**不复用**：断开后新连接是 c3，不会又变成 c1。 */
  let nextClientId = 1;
  /** id → 连接（按 hello 顺序插入，latest() 依赖这个顺序） */
  const connections = new Map<string, ClientConnection>();
  const helloHandlers: ((client: DebugClient) => void)[] = [];
  const goneHandlers: ((client: DebugClient) => void)[] = [];

  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket) => {
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string' || key.length === 0) {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const id = `c${nextClientId}`;
    nextClientId += 1;
    // 注意：不关闭已存在的连接（T24 的核心变化：多客户端并存，不互相顶掉）
    const created = new ClientConnection(
      socket,
      id,
      (client: ClientConnection): void => {
        connections.set(client.id, client);
        for (const handler of helloHandlers) handler(client);
      },
      (client: ClientConnection): void => {
        connections.delete(client.id);
        for (const handler of goneHandlers) handler(client);
      },
    );
    void created;
  });

  const online = (): readonly DebugClient[] => [...connections.values()].filter((client) => client.connected);

  const server: WsServer = {
    port,
    onClient(cb: (client: DebugClient) => void): void {
      helloHandlers.push(cb);
    },
    onGone(cb: (client: DebugClient) => void): void {
      goneHandlers.push(cb);
    },
    clients(): readonly DebugClient[] {
      return online();
    },
    get(id: string): DebugClient | null {
      const client = connections.get(id);
      return client !== undefined && client.connected ? client : null;
    },
    latest(): DebugClient | null {
      const list = online();
      return list.length > 0 ? (list[list.length - 1] ?? null) : null;
    },
    close(): Promise<void> {
      // 先复制再关：close() 会触发 onGone → connections.delete，边遍历边删会漏
      const all = [...connections.values()];
      connections.clear();
      for (const client of all) client.close();
      return new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    },
  };

  return new Promise<WsServer>((resolve, reject) => {
    httpServer.once('error', (error: Error) => reject(error));
    httpServer.listen(port, host, () => {
      const address = httpServer.address() as AddressInfo | null;
      const bound = address === null ? port : address.port;
      // port=0 时返回系统分配的端口（测试用随机端口，避免和真实 mg dev 撞车）
      resolve(bound === port ? server : { ...server, port: bound });
    });
  });
};
