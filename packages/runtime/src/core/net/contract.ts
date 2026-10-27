/**
 * 网络能力契约（HTTP + WebSocket）。
 *
 * **设计前提：错误是数据，不是异常。**
 * AI 生成调用代码时最容易漏 `try/catch`，一漏就静默吞掉失败。所以对外的
 * `NetResponse` 永不抛错，成功失败都是同一个形状 —— 调完只需要 `if (res.ok)`。
 * 错误本身也是可决策的数据：`error.kind` 是枚举、`error.retryable` 是布尔，
 * 不需要调用方去猜「这个错误该不该重试」。
 *
 * 分层：**平台层可以 throw**（实现最简单），**core 层负责兜住并归一**。
 * 别把 try/catch 散进平台实现 —— 那样三端会有三套错误口径。
 *
 * 平台层的「中断」约定：超时与用户取消都 throw 一个 `name === 'AbortError'` 的 Error
 * （web 的 `AbortController` 对两者只有这一个名字）。**core 的判定顺序固定为**：
 *   1. `signal.aborted` 为真 → `kind: 'abort'`（用户取消）
 *   2. 本地计时器到点 → `kind: 'timeout'`
 *   3. 平台自报的 `AbortError` → `kind: 'timeout'`（兼容「平台内部超时后 abort」的老路径）
 *   4. 其余 → `kind: 'network'`
 * **`signal.aborted` 是唯一真源，优先于错误名** —— 顺序反了会把取消误判成可重试的超时，
 * 重试策略就会把已经取消的请求再发一遍。
 */

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export type ResponseType = 'json' | 'text' | 'arraybuffer';

export interface RequestOptions {
  readonly url: string;
  /** 默认 'GET' */
  readonly method?: HttpMethod;
  readonly headers?: Readonly<Record<string, string>>;
  /** 字符串原样发；对象/数组自动 JSON.stringify 并补 Content-Type: application/json */
  readonly body?: unknown;
  /** 默认 8000 */
  readonly timeoutMs?: number;
  /** 默认 'json'；解析失败回落 'text'，只把 kind 设为 'parse' 并把原文放进 data */
  readonly responseType?: ResponseType;
  /**
   * 取消信号（`createCancel().signal`）。已取消时**一个请求都不发**，直接返回
   * `kind: 'abort'`；请求中取消会立刻返回且**不触发重试**。
   */
  readonly signal?: CancelSignal;
}

/**
 * 取消信号。**不用 `AbortSignal`**：小游戏没有 `AbortController`，三端要一个统一的、
 * 自己造的类型（9 行成本），否则业务侧就得写平台分支。
 *
 * 为什么要有取消：「切场景时取消在飞的请求」是游戏里的真实需求 —— 玩家点返回、
 * 请求还在飞，回调打到已销毁的场景上就是幽灵 bug。AI 写代码不会主动想到取消，
 * 所以入口必须由框架摆好。
 */
export interface CancelSignal {
  readonly aborted: boolean;
  /** 若已 aborted，注册时**立即同步**调一次；返回退订函数 */
  onAbort(cb: () => void): () => void;
}

export interface CancelSource {
  readonly signal: CancelSignal;
  /** 幂等：同一次取消只通知一次，重复调用无效 */
  abort(): void;
}

/**
 * 错误种类。
 *
 * 超时与取消都由平台层以 `name === 'AbortError'` 表达（web 的 `AbortController` 天然如此），
 * core 靠 **`signal.aborted`** 区分两者：signal 已取消 → `'abort'`，否则 → `'timeout'`。
 */
export type NetErrorKind = 'timeout' | 'network' | 'http' | 'parse' | 'abort';

export interface NetError {
  readonly kind: NetErrorKind;
  readonly message: string;
  /** timeout / network → true；http 4xx → false；http 5xx → true；parse → false */
  readonly retryable: boolean;
}

export interface NetResponse<T = unknown> {
  readonly ok: boolean;
  /** 网络层失败为 0 */
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly data: T | null;
  readonly error?: NetError;
}

export interface RetryPolicy {
  /** 总尝试次数，默认 1（不重试） */
  readonly attempts?: number;
  /** 默认 300 */
  readonly baseDelayMs?: number;
  /** 默认 2000；指数退避 = min(base * 2^(n-1), max) */
  readonly maxDelayMs?: number;
}

/** 未传 retry 时用的策略：一次都不重试（AI 生成的重试最容易掩盖「服务器挂了」）。 */
export const NO_RETRY: Required<RetryPolicy> = { attempts: 1, baseDelayMs: 300, maxDelayMs: 2000 };

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

export type SocketState = 'idle' | 'connecting' | 'open' | 'closing' | 'closed';

export interface SocketEventMap {
  open: void;
  message: string | ArrayBuffer;
  close: { readonly code: number; readonly reason: string; readonly wasClean: boolean };
  error: { readonly message: string };
}

export interface ReconnectPolicy {
  /** 默认 0 = 不重连 */
  readonly maxAttempts?: number;
  /** 默认 500 */
  readonly baseDelayMs?: number;
  /** 默认 8000 */
  readonly maxDelayMs?: number;
}

export interface Heartbeat {
  readonly data: string;
  readonly intervalMs: number;
}

export interface SocketOptions {
  readonly url: string;
  readonly protocols?: readonly string[];
  /** 连接超时，默认 8000 */
  readonly timeoutMs?: number;
  readonly reconnect?: ReconnectPolicy;
  readonly heartbeat?: Heartbeat;
}

export interface Socket {
  readonly state: SocketState;
  readonly url: string;
  /** 非 open 时返回 false 并入队（队列上限 100，超出丢最旧的并计 droppedCount） */
  send(data: string | ArrayBuffer): boolean;
  on<K extends keyof SocketEventMap>(event: K, cb: (payload: SocketEventMap[K]) => void): () => void;
  close(code?: number, reason?: string): void;
  /** 计数，便于测试与调试 */
  readonly sentCount: number;
  readonly recvCount: number;
  readonly reconnectCount: number;
  readonly droppedCount: number;
}

/** 发送队列上限（契约值：超出丢最旧 + droppedCount++）。 */
export const SOCKET_QUEUE_LIMIT = 100;

/** 默认值集中在这里，实现与测试同源。 */
export const NET_DEFAULTS = {
  /** 请求超时 */
  timeoutMs: 8000,
  /** socket 连接超时 */
  connectTimeoutMs: 8000,
  /** 重连基础退避 */
  reconnectBaseDelayMs: 500,
  /** 重连最大退避 */
  reconnectMaxDelayMs: 8000,
} as const;
