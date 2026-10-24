/**
 * WebSocket 客户端：游戏（浏览器里）→ 调试 MCP 服务端（Node，127.0.0.1:7788）。
 *
 * 为什么是「游戏主动连服务端」而不是服务端开 CDP 连浏览器：
 * 真机与开发者工具里没有 CDP；而 WebSocket 是 web / 微信 / 抖音三端都有的
 * 最小公分母（小游戏用 `wx.connectSocket`，接口形状一致）。8a 期只做 web，
 * 但协议从第一天就按「客户端主动连」设计，后面接小游戏不用改协议。
 *
 * 只做三件事：连上 → 上报 hello → 收命令、回结果。断线自动重连（dev 模式下
 * 服务端比游戏晚起是常态）。
 */

import type { Bridge, BridgeState, CommandMessage, CommandHandlers, CreateBridge, HelloPayload, ResultMessage } from './contract';

/** 断线重连间隔（ms）。dev 工具，不必指数退避。 */
const RETRY_MS = 1000;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 判断 socket 是否处于 OPEN（各端常量值都是 1，但用常量名更清楚）。 */
const isOpen = (socket: WebSocket | null): socket is WebSocket => socket !== null && socket.readyState === 1;

export const createBridge: CreateBridge = (options: {
  readonly url: string;
  readonly hello: HelloPayload;
  readonly handlers: CommandHandlers;
  readonly onEvent?: (event: string, detail?: string) => void;
}) => {
  const { url, hello, handlers, onEvent } = options;
  const report = (event: string, detail?: string): void => {
    if (onEvent !== undefined) onEvent(event, detail);
  };

  let state: BridgeState = 'idle';
  let socket: WebSocket | null = null;
  let disposed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const send = (message: unknown): void => {
    if (!isOpen(socket)) return;
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      report('send-failed', messageOf(error));
    }
  };

  /** 一条命令：找 handler、执行、回包。handler 可以是 async。 */
  const dispatch = (raw: string): void => {
    let message: CommandMessage;
    try {
      message = JSON.parse(raw) as CommandMessage;
    } catch {
      report('bad-json', raw.slice(0, 120));
      return;
    }
    if (typeof message.id !== 'number' || typeof message.method !== 'string') {
      report('bad-message', raw.slice(0, 120));
      return;
    }
    const id = message.id;
    const method = message.method;
    const handler = handlers[method];
    if (handler === undefined) {
      const missing: ResultMessage = { id, ok: false, error: `未知工具：${method}（可用：${Object.keys(handlers).join(', ')}）` };
      send(missing);
      return;
    }
    const params = message.params ?? {};
    report('command', method);
    void Promise.resolve()
      .then(() => handler(params))
      .then((result) => {
        send({ id, ok: true, result } satisfies ResultMessage);
      })
      .catch((error: unknown) => {
        // 错误信息用中文：这条会直接显示在 AI 的工具结果里
        send({ id, ok: false, error: messageOf(error) } satisfies ResultMessage);
      });
  };

  const scheduleRetry = (): void => {
    if (disposed || retry !== null) return;
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, RETRY_MS);
  };

  const connect = (): void => {
    if (disposed) return;
    if (typeof WebSocket === 'undefined') {
      state = 'closed';
      report('unsupported', '当前环境没有 WebSocket：运行时调试只在 web dev 下可用');
      return;
    }
    state = 'connecting';
    let next: WebSocket;
    try {
      next = new WebSocket(url);
    } catch (error) {
      state = 'closed';
      report('connect-failed', messageOf(error));
      scheduleRetry();
      return;
    }
    socket = next;
    next.onopen = (): void => {
      state = 'open';
      report('open', url);
      send({ type: 'hello', hello });
    };
    next.onmessage = (event: MessageEvent): void => {
      if (typeof event.data === 'string') dispatch(event.data);
    };
    next.onclose = (): void => {
      if (socket === next) socket = null;
      state = 'closed';
      report('close');
      scheduleRetry();
    };
    next.onerror = (): void => {
      // 浏览器的 error 事件没有可用信息；close 一定会跟着来，这里只记一笔
      report('error');
    };
  };

  connect();

  const bridge: Bridge = {
    get state(): BridgeState {
      return state;
    },
    close(): void {
      disposed = true;
      if (retry !== null) {
        clearTimeout(retry);
        retry = null;
      }
      const current = socket;
      socket = null;
      state = 'closed';
      if (current !== null) {
        try {
          current.close();
        } catch {
          // 已经关掉了：忽略
        }
      }
    },
    send(message: unknown): void {
      send(message);
    },
  };

  return bridge;
};

export type { Bridge, CommandHandlers };
