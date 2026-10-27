/**
 * 网络能力的 barrel：HTTP 请求 + WebSocket。
 *
 * 业务侧只需要两个函数，且**两个都不抛错**：
 * ```ts
 * const res = await request(platform.net ?? null, { url });   // res.ok / res.error
 * const ws = openSocket(platform.net ?? null, { url });
 * ```
 * 类型与默认值都在 `./contract`，实现分别在 `./request` / `./socket`。
 */

export {
  NET_DEFAULTS,
  NO_RETRY,
  SOCKET_QUEUE_LIMIT,
} from './contract';
export type {
  CancelSignal,
  CancelSource,
  Heartbeat,
  HttpMethod,
  NetError,
  NetErrorKind,
  NetResponse,
  ReconnectPolicy,
  RequestOptions,
  ResponseType,
  RetryPolicy,
  Socket,
  SocketEventMap,
  SocketOptions,
  SocketState,
} from './contract';

export { createCancel } from './cancel';
export { backoffDelay, request } from './request';
export { openSocket, reconnectDelay } from './socket';
