/**
 * web 端网络实现：`fetch` + 原生 `WebSocket`。
 *
 * 只做传输：不解析 JSON（交 core）、不重试（交 core）、不做状态机（交 core）。
 * 唯一自己多做的两件事都有理由：
 * - **超时用 `AbortController`**：能真正中止请求，而不是只把 Promise 丢掉；
 * - **`binaryType = 'arraybuffer'`**：让二进制帧拿到 ArrayBuffer 而不是 Blob
 *   （Blob 在小游戏端不存在，三端口径要一致）。
 */

import type { CancelSignal, RequestOptions } from '../../core/net/contract';
import type { Unsubscribe } from '../contract';
import type { NetService, RawNetResponse, SocketTransport } from '../net-contract';
import { abortError, lowercaseHeaders, normalizeBody } from '../net-utils';

/** `WebSocket.OPEN` 的常量值（不引用全局 `WebSocket` 对象，测试环境里可能没有）。 */
const WS_OPEN = 1;

const requestOnce = async (opts: RequestOptions, signal?: CancelSignal): Promise<RawNetResponse> => {
  const timeoutMs = opts.timeoutMs ?? 0;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller !== null && timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  // 取消桥接：core 的 CancelSignal → 浏览器 AbortController
  const off = signal?.onAbort(() => controller?.abort()) ?? ((): void => undefined);

  try {
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      ...(opts.headers === undefined ? {} : { headers: { ...opts.headers } }),
      ...(opts.body === undefined ? {} : { body: opts.body as BodyInit }),
      ...(controller === null ? {} : { signal: controller.signal }),
    };
    const response = await fetch(opts.url, init);
    const body = opts.responseType === 'arraybuffer'
      ? await response.arrayBuffer()
      : await response.text();
    return { status: response.status, headers: lowercaseHeaders(response.headers), body };
  } finally {
    off();
    if (timer !== null) clearTimeout(timer);
  }
};

const connectOnce = (url: string, protocols?: readonly string[]): Promise<SocketTransport> =>
  new Promise<SocketTransport>((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = protocols !== undefined && protocols.length > 0
        ? new WebSocket(url, [...protocols])
        : new WebSocket(url);
    } catch (err) {
      reject(err);
      return;
    }
    socket.binaryType = 'arraybuffer';

    const openCbs = new Set<() => void>();
    const messageCbs = new Set<(data: string | ArrayBuffer) => void>();
    const closeCbs = new Set<(code: number, reason: string) => void>();
    const errorCbs = new Set<(message: string) => void>();

    const subscribe = <T>(set: Set<T>, cb: T): Unsubscribe => {
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    };

    socket.onopen = (): void => {
      for (const cb of [...openCbs]) cb();
    };
    socket.onmessage = (event: MessageEvent): void => {
      const data = typeof event.data === 'string'
        ? event.data
        : event.data instanceof ArrayBuffer
          ? event.data
          : normalizeBody(event.data) ?? '';
      for (const cb of [...messageCbs]) cb(data);
    };
    socket.onclose = (event: CloseEvent): void => {
      for (const cb of [...closeCbs]) cb(event.code, event.reason);
    };
    socket.onerror = (): void => {
      for (const cb of [...errorCbs]) cb('WebSocket 连接错误');
    };

    resolve({
      send(data: string | ArrayBuffer): void {
        if (socket.readyState !== WS_OPEN) return;
        socket.send(data);
      },
      close(code?: number, reason?: string): void {
        try {
          socket.close(code, reason);
        } catch {
          // 已关闭的句柄再关一次：忽略
        }
      },
      onOpen: (cb) => subscribe(openCbs, cb),
      onMessage: (cb) => subscribe(messageCbs, cb),
      onClose: (cb) => subscribe(closeCbs, cb),
      onError: (cb) => subscribe(errorCbs, cb),
    });
  });

export const createWebNet = (): NetService => ({
  async request(opts: RequestOptions, signal?: CancelSignal): Promise<RawNetResponse> {
    try {
      return await requestOnce(opts, signal);
    } catch (err) {
      // 浏览器在 abort 时抛 DOMException(name='AbortError')，超时与取消都走这里；
      // 两者的区别由 core 用 signal.aborted 判定，这里只保证 name 一致。
      if (typeof err === 'object' && err !== null && (err as { readonly name?: unknown }).name === 'AbortError') {
        throw abortError(signal?.aborted === true ? '请求已取消' : `请求超时（${opts.timeoutMs ?? 0}ms）`);
      }
      throw err;
    }
  },
  connect(url: string, protocols?: readonly string[]): Promise<SocketTransport> {
    return connectOnce(url, protocols);
  },
});
