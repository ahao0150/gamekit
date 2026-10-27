/**
 * mock 的网络实现：**可编程的假传输层**。
 *
 * 用途有二：单测驱动 `core/net` 的全部分支（不连真网、不用真 sleep），
 * 以及离线预览时让页面里的网络调用有个确定的应答。
 *
 * 设计取舍：连接**不自动连上**（`autoOpen` 默认 true，但走 `setTimeout(0)`），
 * 保证 core 的 `onOpen` 订阅先挂上、事件不丢。要手写时序的测试传 `autoOpen: false`，
 * 然后自己调 `net.sockets[0].open()`。
 */

import type { CancelSignal, RequestOptions } from '../../core/net/contract';
import type { Unsubscribe } from '../contract';
import type { NetService, RawNetResponse, SocketTransport } from '../net-contract';
import { abortError } from '../net-utils';

/** 一条被 mock 出来的连接：测试可以手动推 open / message / close / error。 */
export interface MockNetSocket {
  readonly url: string;
  readonly protocols: readonly string[];
  /** `transport.send()` 收到的帧（按顺序） */
  readonly sent: readonly (string | ArrayBuffer)[];
  readonly closed: boolean;
  readonly isOpen: boolean;
  open(): void;
  message(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  error(message: string): void;
}

export interface MockNetOptions {
  /** 自定义应答；**throw 表示传输失败**（core 会归一成 network/timeout）。 */
  readonly respond?: (opts: RequestOptions) => RawNetResponse | Promise<RawNetResponse>;
  /** 不传 `respond` 时的固定应答，默认 200 + `'{}'` */
  readonly response?: RawNetResponse;
  /** 应答延迟（ms），用来测超时，默认 0 */
  readonly delayMs?: number;
  /** 建连后自动 open（`setTimeout(0)`），默认 true */
  readonly autoOpen?: boolean;
}

export interface MockNet extends NetService {
  /** 每次 `request()` 收到的参数（含 core 归一化后的 method / body） */
  readonly requests: readonly RequestOptions[];
  /** 建过的连接（按建连顺序） */
  readonly sockets: readonly MockNetSocket[];
}

const DEFAULT_RESPONSE: RawNetResponse = { status: 200, headers: {}, body: '{}' };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 与平台层同一口径：中断一律 `AbortError`，core 靠 `signal.aborted` 分辨取消/超时。 */
const cancelledError = (): Error => abortError('请求已取消');

export const createMockNet = (opts?: MockNetOptions): MockNet => {
  const requests: RequestOptions[] = [];
  const sockets: MockNetSocket[] = [];
  const delayMs = Math.max(0, opts?.delayMs ?? 0);
  const autoOpen = opts?.autoOpen ?? true;

  const request = async (
    options: RequestOptions,
    signal?: CancelSignal,
  ): Promise<RawNetResponse> => {
    requests.push(options);
    if (delayMs > 0) await sleep(delayMs);
    // 模拟平台行为：被取消的请求不该返回成功
    if (signal?.aborted === true) throw cancelledError();
    if (opts?.respond !== undefined) return opts.respond(options);
    return opts?.response ?? DEFAULT_RESPONSE;
  };

  const connect = (url: string, protocols?: readonly string[]): Promise<SocketTransport> => {
    const openCbs = new Set<() => void>();
    const messageCbs = new Set<(data: string | ArrayBuffer) => void>();
    const closeCbs = new Set<(code: number, reason: string) => void>();
    const errorCbs = new Set<(message: string) => void>();
    const sent: (string | ArrayBuffer)[] = [];
    let closed = false;
    let open = false;

    const subscribe = <T>(set: Set<T>, cb: T): Unsubscribe => {
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    };

    const handle: MockNetSocket = {
      url,
      protocols: protocols ?? [],
      get sent(): readonly (string | ArrayBuffer)[] {
        return sent;
      },
      get closed(): boolean {
        return closed;
      },
      get isOpen(): boolean {
        return open;
      },
      open(): void {
        if (closed || open) return;
        open = true;
        for (const cb of [...openCbs]) cb();
      },
      message(data: string | ArrayBuffer): void {
        if (closed) return;
        for (const cb of [...messageCbs]) cb(data);
      },
      close(code = 1000, reason = ''): void {
        if (closed) return;
        closed = true;
        open = false;
        for (const cb of [...closeCbs]) cb(code, reason);
      },
      error(message: string): void {
        for (const cb of [...errorCbs]) cb(message);
      },
    };
    sockets.push(handle);

    const transport: SocketTransport = {
      send(data: string | ArrayBuffer): void {
        if (closed) return;
        sent.push(data);
      },
      close(code?: number, reason?: string): void {
        handle.close(code ?? 1000, reason ?? '');
      },
      onOpen: (cb) => subscribe(openCbs, cb),
      onMessage: (cb) => subscribe(messageCbs, cb),
      onClose: (cb) => subscribe(closeCbs, cb),
      onError: (cb) => subscribe(errorCbs, cb),
    };

    if (autoOpen) setTimeout(() => handle.open(), 0);
    return Promise.resolve(transport);
  };

  return {
    request,
    connect,
    get requests(): readonly RequestOptions[] {
      return requests;
    },
    get sockets(): readonly MockNetSocket[] {
      return sockets;
    },
  };
};
