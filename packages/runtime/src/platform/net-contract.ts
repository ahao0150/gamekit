/**
 * 平台网络能力契约（传输层）。
 *
 * 这一层只做两件事：**把请求发出去**、**把 socket 事件搬回来**。
 * 不解析、不判断业务成败、不重试、不做状态机 —— 那些全在 `core/net/`。
 *
 * 为什么和 `platform/contract.ts` 分开：那个文件已经 281 行贴着 300 行上限
 * （AGENTS 铁律 2），网络是独立能力面，拆开不影响「契约只在一处」——
 * `PlatformAdapter.net` 直接引用这里的 `NetService`。
 *
 * **失败就用 throw 表达**（平台实现越简单越好），由 core 归一化成 `NetError`：
 * - 超时 → `throw` 一个 `name === 'AbortError'` 的 Error（web 的 AbortController 天然如此）
 * - 其它传输失败 → 随便 throw 什么，core 一律归成 `kind: 'network'`
 */

import type { CancelSignal, RequestOptions } from '../core/net/contract';
import type { Unsubscribe } from './contract';

/** 平台层返回的原始响应：还没解析、没判断业务成败。 */
export interface RawNetResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | ArrayBuffer | null;
}

/** 平台层的 socket 传输句柄：只搬事件，不做状态机、不做重连。 */
export interface SocketTransport {
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onOpen(cb: () => void): Unsubscribe;
  onMessage(cb: (data: string | ArrayBuffer) => void): Unsubscribe;
  onClose(cb: (code: number, reason: string) => void): Unsubscribe;
  onError(cb: (message: string) => void): Unsubscribe;
}

/**
 * 平台网络能力。**一次请求、不重试、不解析** —— 失败就 throw，由 core 兜住归一。
 *
 * `signal` 由 core 传进来，平台层只负责「把它桥到自己的取消机制」：
 * web 用 `AbortController`，微信/抖音用 `RequestTask.abort()`。
 * **被取消时也要 throw 一个 `name === 'AbortError'` 的 Error**（`net-utils.abortError()`），
 * core 靠 `signal.aborted` 把「取消」与「超时」区分开。
 */
export interface NetService {
  request(opts: RequestOptions, signal?: CancelSignal): Promise<RawNetResponse>;
  connect(url: string, protocols?: readonly string[]): Promise<SocketTransport>;
}
