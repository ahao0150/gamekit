// @long-file 状态机 + 队列 + 心跳 + 重连是一段不可拆的时序逻辑，拆成几个文件会让「谁在什么时候改 state」散落
/**
 * WebSocket 的**状态机层**：连接、排队、心跳、重连。
 *
 * 平台层只提供「搬事件的传输句柄」（见 `platform/net-contract.ts`），
 * 状态、队列、重连策略全在这里，三端行为因此完全一致。
 *
 * 两条刻意的默认值：
 * - **不重连**（`reconnect.maxAttempts` 默认 0）：AI 生成的重连最容易把「服务器挂了」
 *   掩盖成「一直连不上但也没报错」。要重连必须显式写进 options。
 * - **非 open 时 send 入队**（上限 100）：连接刚建立就发的首批消息不会凭空丢掉，
 *   但也绝不无限堆积 —— 溢出丢最旧的并计 `droppedCount`，让调用方能观察到。
 */

import type {
  ReconnectPolicy,
  Socket,
  SocketEventMap,
  SocketOptions,
  SocketState,
} from './contract';
import { NET_DEFAULTS, SOCKET_QUEUE_LIMIT } from './contract';
import type { NetService, SocketTransport } from '../../platform/net-contract';

type AnyListener = (payload: unknown) => void;

const safeClose = (transport: SocketTransport, code: number, reason: string): void => {
  try {
    transport.close(code, reason);
  } catch {
    // 已经关掉的句柄再关一次：平台可能抛错，吞掉即可
  }
};

const messageOf = (err: unknown, fallback: string): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
};

const resolveReconnect = (policy?: ReconnectPolicy): Required<ReconnectPolicy> => ({
  maxAttempts: Math.max(0, Math.floor(policy?.maxAttempts ?? 0)),
  baseDelayMs: Math.max(0, policy?.baseDelayMs ?? NET_DEFAULTS.reconnectBaseDelayMs),
  maxDelayMs: Math.max(0, policy?.maxDelayMs ?? NET_DEFAULTS.reconnectMaxDelayMs),
});

/** 第 n 次重连的等待时长：`min(base * 2^(n-1), max)`。 */
export const reconnectDelay = (attempt: number, policy: Required<ReconnectPolicy>): number =>
  Math.min(policy.baseDelayMs * 2 ** Math.max(0, attempt - 1), policy.maxDelayMs);

/**
 * 开一条长连接。**同步返回** Socket，连接在后台进行 —— 调用方拿到的对象立刻可用
 * （`on()` 订阅、`send()` 入队），不需要 await 就能开始写业务。
 *
 * `net` 允许为 `null`（平台没有网络能力）：此时立即 `closed` 并触发一次 `error`。
 */
export const openSocket = (net: NetService | null, opts: SocketOptions): Socket => {
  const listeners = new Map<keyof SocketEventMap, Set<AnyListener>>();
  const reconnectPolicy = resolveReconnect(opts.reconnect);
  const connectTimeoutMs = opts.timeoutMs ?? NET_DEFAULTS.connectTimeoutMs;

  let state: SocketState = 'idle';
  let transport: SocketTransport | null = null;
  const queue: (string | ArrayBuffer)[] = [];
  let sentCount = 0;
  let recvCount = 0;
  let reconnectCount = 0;
  let droppedCount = 0;
  let manualClose = false;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribers: (() => void)[] = [];

  const emit = <K extends keyof SocketEventMap>(event: K, payload: SocketEventMap[K]): void => {
    const set = listeners.get(event);
    if (set === undefined || set.size === 0) return;
    for (const cb of [...set]) {
      try {
        cb(payload);
      } catch {
        // 订阅者抛错不该打断状态机
      }
    }
  };

  const clearConnectTimer = (): void => {
    if (connectTimer === null) return;
    clearTimeout(connectTimer);
    connectTimer = null;
  };

  const clearHeartbeat = (): void => {
    if (heartbeatTimer === null) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  const clearReconnectTimer = (): void => {
    if (reconnectTimer === null) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  /** 退订传输事件再关句柄：先退订保证 close 不会重入状态机。 */
  const dropTransport = (code: number, reason: string): void => {
    const current = transport;
    transport = null;
    for (const unsub of unsubscribers) {
      try {
        unsub();
      } catch {
        // 退订失败不影响后续
      }
    }
    unsubscribers = [];
    if (current !== null) safeClose(current, code, reason);
  };

  const flush = (): void => {
    const current = transport;
    if (current === null) return;
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) break;
      current.send(item);
      sentCount += 1;
    }
  };

  const startHeartbeat = (): void => {
    clearHeartbeat();
    const heartbeat = opts.heartbeat;
    if (heartbeat === undefined || heartbeat.intervalMs <= 0) return;
    heartbeatTimer = setInterval(() => {
      const current = transport;
      if (state !== 'open' || current === null) return;
      current.send(heartbeat.data);
      sentCount += 1;
    }, heartbeat.intervalMs);
  };

  const scheduleReconnect = (): void => {
    if (reconnectCount >= reconnectPolicy.maxAttempts) return;
    reconnectCount += 1;
    state = 'connecting'; // 重连期间如实标 connecting，调用方据此显示「重连中」
    const delay = reconnectDelay(reconnectCount, reconnectPolicy);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  /** 传输层报关闭：先收尾，再决定是否重连。 */
  const handleClosed = (code: number, reason: string): void => {
    clearConnectTimer();
    clearHeartbeat();
    if (state === 'closed') return; // 已经收过尾（超时兜底 + 真实 close 可能都到达）
    dropTransport(code, reason);
    state = 'closed';
    // wasClean：我们自己主动关的、或对端正常关闭（1000）都算干净
    emit('close', { code, reason, wasClean: manualClose || code === 1000 });
    if (!manualClose) scheduleReconnect();
  };

  const connect = (): void => {
    const service = net;
    if (service === null) {
      state = 'closed';
      // 事件推迟到微任务：`openSocket()` 是同步返回的，调用方要在返回之后才有机会 `on()`。
      // 同步 emit 会让「平台没有网络能力」这条错误永远收不到。
      void Promise.resolve().then(() => {
        emit('error', { message: '当前平台没有网络能力（platform.net 缺失）' });
        emit('close', { code: 0, reason: 'no-net', wasClean: false });
      });
      return;
    }
    state = 'connecting';
    if (connectTimeoutMs > 0) {
      connectTimer = setTimeout(() => {
        connectTimer = null;
        if (state !== 'connecting') return;
        emit('error', { message: `连接超时（${connectTimeoutMs}ms）` });
        handleClosed(0, 'connect-timeout');
      }, connectTimeoutMs);
    }

    service.connect(opts.url, opts.protocols).then(
      (handle) => {
        // 注意：**不在这里清连接超时定时器**。拿到句柄 ≠ 连上了 —— 真正的握手
        // 由 `onOpen` 通知。若此时就清掉计时器，「句柄到手但永远不 open」的宿主
        // 会让连接卡在 connecting 无限等待（正是超时兜底要解决的场景）。
        if (state !== 'connecting') {
          // 等待期间被 close() 了：句柄直接丢掉，不进入事件循环
          safeClose(handle, 1000, 'closed-before-open');
          return;
        }
        transport = handle;
        unsubscribers = [
          handle.onOpen(() => {
            if (state !== 'connecting') return;
            clearConnectTimer();
            state = 'open';
            flush();
            startHeartbeat();
            emit('open', undefined);
          }),
          handle.onMessage((data) => {
            recvCount += 1;
            emit('message', data);
          }),
          handle.onClose((code, reason) => {
            handleClosed(code, reason);
          }),
          handle.onError((message) => {
            emit('error', { message });
          }),
        ];
      },
      (err: unknown) => {
        clearConnectTimer();
        if (state !== 'connecting') return;
        emit('error', { message: messageOf(err, '连接失败') });
        handleClosed(0, 'connect-failed');
      },
    );
  };

  const socket: Socket = {
    get state(): SocketState {
      return state;
    },
    url: opts.url,
    send(data: string | ArrayBuffer): boolean {
      if (state === 'open' && transport !== null) {
        transport.send(data);
        sentCount += 1;
        return true;
      }
      if (queue.length >= SOCKET_QUEUE_LIMIT) {
        queue.shift();
        droppedCount += 1;
      }
      queue.push(data);
      return false;
    },
    on<K extends keyof SocketEventMap>(event: K, cb: (payload: SocketEventMap[K]) => void): () => void {
      const set = listeners.get(event) ?? new Set<AnyListener>();
      const wrapped: AnyListener = (payload) => {
        cb(payload as SocketEventMap[K]);
      };
      set.add(wrapped);
      listeners.set(event, set);
      return () => {
        set.delete(wrapped);
      };
    },
    close(code = 1000, reason = ''): void {
      manualClose = true;
      clearReconnectTimer();
      clearConnectTimer();
      clearHeartbeat();
      if (state === 'closed') return;
      const wasLive = state === 'open' || state === 'connecting' || transport !== null;
      // 'closing' 是 close() 执行期间的瞬时内部态：对外能观察到的是 'closed'
      state = 'closing';
      dropTransport(code, reason);
      state = 'closed';
      if (wasLive) emit('close', { code, reason, wasClean: true });
    },
    get sentCount(): number {
      return sentCount;
    },
    get recvCount(): number {
      return recvCount;
    },
    get reconnectCount(): number {
      return reconnectCount;
    },
    get droppedCount(): number {
      return droppedCount;
    },
  };

  connect();
  return socket;
};
