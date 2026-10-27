// @long-file 请求归一化的五件事（默认值、序列化、响应判定、取消、重试退避）必须在一处对照，拆开容易只改一边
/**
 * HTTP 请求的**归一化层**：一次调用 = 平台传输 + 默认值补齐 + 响应判定 + 取消 + 可选重试。
 *
 * 四条铁律：
 * 1. **永不抛错**：任何失败都折成 `NetResponse`（`ok: false` + `error`），调用方只需要 `if (res.ok)`。
 * 2. **错误可决策**：`error.kind` 是枚举、`error.retryable` 是布尔，不用调用方自己猜。
 * 3. **默认值合理**：不传 method 就是 GET、超时 8s、`responseType: 'json'` 且解析失败自动回落
 *    text —— 不因为一个非 JSON 响应让整次调用失败。空响应体算成功（`data: null`）。
 * 4. **取消优先**：`signal` 已取消就一个请求都不发；请求中取消立刻返回且**不重试**。
 *
 * 重试默认**关**（attempts = 1）：AI 生成的重试代码最容易把「服务器挂了」掩盖成「偶尔慢」。
 */

import type {
  CancelSignal,
  HttpMethod,
  NetError,
  NetResponse,
  RequestOptions,
  ResponseType,
  RetryPolicy,
} from './contract';
import { NET_DEFAULTS, NO_RETRY } from './contract';
import type { NetService } from '../../platform/net-contract';

/** 平台层用 `name` 表达「这次是中断」——超时与取消都用这个名字，靠 signal 才能分开。 */
const isAbortError = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { readonly name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
};

/** 把平台层的 throw 折成契约错误。走到这里说明既不是取消也不是超时，一律按传输失败算。 */
const toNetError = (err: unknown): NetError => {
  const message = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : '网络请求失败（平台未给出原因）';
  return { kind: 'network', message, retryable: true };
};

/**
 * 读取消状态。
 *
 * 为什么包成函数而不是内联 `signal?.aborted === true`：`aborted` 是 `readonly` 字段，
 * TS 会把上面的检查结果**窄化**到 `false`，之后的比较会被判成「无重叠」而报错 ——
 * 而运行时它当然会变（这正是取消的本质）。函数调用不参与窄化。
 */
const isCancelled = (signal: CancelSignal | undefined): boolean => signal?.aborted === true;

/** 取消的统一响应（`status: 0`、`retryable: false`）。 */
const abortResponse = <T>(): NetResponse<T> => ({
  ok: false,
  status: 0,
  headers: {},
  data: null,
  error: { kind: 'abort', message: '请求已取消', retryable: false },
});

/** 超时的统一响应（`status: 0`、可重试）。 */
const timeoutResponse = <T>(ms: number): NetResponse<T> => ({
  ok: false,
  status: 0,
  headers: {},
  data: null,
  error: { kind: 'timeout', message: `请求超时（${ms}ms）`, retryable: true },
});

/** 传输层失败的统一响应（可重试）。 */
const networkResponse = <T>(err: unknown): NetResponse<T> => ({
  ok: false,
  status: 0,
  headers: {},
  data: null,
  error: toNetError(err),
});

/** 超时错误（core 侧兜底计时器、以及平台层自己的超时都用这个名字）。 */
const timeoutError = (ms: number): Error => {
  const err = new Error(`请求超时（${ms}ms）`);
  err.name = 'AbortError';
  return err;
};

/** 取消错误：与超时同一个 `name`（平台层两者都是「中断」），靠 `signal.aborted` 区分。 */
const cancelledError = (): Error => {
  const err = new Error('请求已取消');
  err.name = 'AbortError';
  return err;
};

/**
 * 给一次传输套超时。
 *
 * 为什么 core 也要计时：小游戏 API 在某些机型上「既不 success 也不 fail」，
 * 光靠平台层自己超时会挂死整条链路。平台层**也**应该自己设超时并主动 abort。
 *
 * `onTimeout` 把「本地计时器到点」这个事实记下来 —— 判定优先级要用它，
 * 而不是靠错误的 name（平台的取消和超时 name 一样，见 `attempt` 的 catch）。
 */
const withTimeout = <T>(pending: Promise<T>, ms: number, onTimeout: () => void): Promise<T> => {
  if (ms <= 0) return pending;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout();
      reject(timeoutError(ms));
    }, ms);
    pending.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
};

/**
 * 让一次传输**可被取消**。
 *
 * 为什么不等平台层自己 abort：小游戏 Task.abort() 在个别机型上不回调 fail，
 * 只等平台会让取消形同虚设。这里 race 一个取消 Promise，保证「abort() 立刻返回」。
 */
const runAbortable = <T>(pending: Promise<T>, signal: CancelSignal | undefined): Promise<T> => {
  if (signal === undefined) return pending;
  if (signal.aborted) return Promise.reject(cancelledError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const off = signal.onAbort(() => {
      if (settled) return;
      settled = true;
      reject(cancelledError());
    });
    pending.then(
      (value) => {
        if (settled) return;
        settled = true;
        off();
        resolve(value);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        off();
        reject(err);
      },
    );
  });
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const resolveMethod = (method?: HttpMethod): HttpMethod => method ?? 'GET';

const resolveTimeout = (value?: number): number => {
  if (value === undefined || !Number.isFinite(value)) return NET_DEFAULTS.timeoutMs;
  return value > 0 ? value : 0;
};

const resolveResponseType = (value?: ResponseType): ResponseType => value ?? 'json';

const hasHeader = (headers: Readonly<Record<string, string>>, name: string): boolean =>
  Object.keys(headers).some((key) => key.toLowerCase() === name);

/**
 * body 归一化：字符串原样、二进制原样、其余一律 JSON。
 *
 * 序列化放在 core 而不是平台：三端各写一次 `JSON.stringify` 必然出现口径差异
 * （有的补 Content-Type、有的不补）。
 */
const encodeBody = (
  body: unknown,
  headers: Readonly<Record<string, string>>,
): { readonly data: string | ArrayBuffer | undefined; readonly headers: Record<string, string> } => {
  const next: Record<string, string> = { ...headers };
  if (body === undefined || body === null) return { data: undefined, headers: next };
  if (typeof body === 'string') return { data: body, headers: next };
  if (body instanceof ArrayBuffer) return { data: body, headers: next };
  const text = JSON.stringify(body);
  if (!hasHeader(next, 'content-type')) next['Content-Type'] = 'application/json';
  return { data: text, headers: next };
};

interface ParsedBody<T> {
  readonly data: T | null;
  readonly parseFailed: boolean;
}

/**
 * 解析响应体（2xx 与非 2xx 共用同一套）。
 *
 * 三条口径：
 * - **空体算成功**：204 / 200 无 body 一律 `data: null`，不当解析失败；
 * - `json` 解析失败回落原文（`parseFailed` 为 true，由调用方决定算不算错）；
 * - 非 2xx 也照样解析 —— 4xx 常带 `{ code, message }`，丢掉会让调用方只剩状态码。
 */
const parseBody = <T>(body: string | ArrayBuffer | null, responseType: ResponseType): ParsedBody<T> => {
  if (responseType === 'arraybuffer') return { data: (body as T) ?? null, parseFailed: false };
  const text = typeof body === 'string' ? body : body === null ? '' : null;
  if (text === null) return { data: (body as T) ?? null, parseFailed: false };
  if (text.trim() === '') return { data: null, parseFailed: false };
  if (responseType === 'text') return { data: text as T, parseFailed: false };
  try {
    return { data: JSON.parse(text) as T, parseFailed: false };
  } catch {
    return { data: text as T, parseFailed: true };
  }
};

const buildResponse = <T>(
  status: number,
  headers: Readonly<Record<string, string>>,
  body: string | ArrayBuffer | null,
  responseType: ResponseType,
): NetResponse<T> => {
  const parsed = parseBody<T>(body, responseType);
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      status,
      headers,
      // 错误响应体照样给出去：4xx 的 { code, message } 常常要直接显示给玩家
      data: parsed.data,
      error: {
        kind: 'http',
        message: `HTTP ${status}`,
        // 4xx 是「请求本身不对」，重试没意义；5xx 是「服务端这次不行」，可以再来
        retryable: status >= 500,
      },
    };
  }
  if (parsed.parseFailed) {
    // 解析失败不让整次调用用不上数据：原文照样给出去，只把 kind 标成 parse
    return {
      ok: false,
      status,
      headers,
      data: parsed.data,
      error: { kind: 'parse', message: '响应不是合法 JSON，已按原始文本返回', retryable: false },
    };
  }
  return { ok: true, status, headers, data: parsed.data };
};

const resolveRetry = (retry?: RetryPolicy): Required<RetryPolicy> => ({
  attempts: Math.max(1, Math.floor(retry?.attempts ?? NO_RETRY.attempts)),
  baseDelayMs: Math.max(0, retry?.baseDelayMs ?? NO_RETRY.baseDelayMs),
  maxDelayMs: Math.max(0, retry?.maxDelayMs ?? NO_RETRY.maxDelayMs),
});

/** 第 attempt 次失败后该等多久：`min(base * 2^(attempt-1), max)`。 */
export const backoffDelay = (attempt: number, policy: Required<RetryPolicy>): number =>
  Math.min(policy.baseDelayMs * 2 ** Math.max(0, attempt - 1), policy.maxDelayMs);

/**
 * 单次传输 + 归一化（不含重试）。
 *
 * **catch 的判定顺序是硬约定**（三端都走这里）：
 * 1. `signal.aborted` —— **唯一真源**，用户取消最优先。平台层取消与超时都抛
 *    `AbortError`（web 的 AbortController 只有一个名字），只有 signal 能分辨；
 * 2. 本地 `timedOut` —— 我们自己的计时器到点；
 * 3. 平台自报的 `AbortError` —— 平台内部超时后 abort 的老路径，兼容它；
 * 4. 其余 → network。
 *
 * 顺序错了的后果很具体：取消被当成 timeout（`retryable: true`）→ 重试策略
 * 会把已经取消的请求再发一遍，等于没取消。
 */
const attempt = async <T>(
  net: NetService,
  opts: RequestOptions,
  timeoutMs: number,
  responseType: ResponseType,
): Promise<NetResponse<T>> => {
  const headers = opts.headers ?? {};
  const encoded = encodeBody(opts.body, headers);
  const payload: RequestOptions = {
    url: opts.url,
    method: resolveMethod(opts.method),
    headers: encoded.headers,
    ...(encoded.data === undefined ? {} : { body: encoded.data }),
    timeoutMs,
    responseType,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  };
  let timedOut = false;
  try {
    const raw = await runAbortable(
      withTimeout(net.request(payload, opts.signal), timeoutMs, () => {
        timedOut = true;
      }),
      opts.signal,
    );
    return buildResponse<T>(raw.status, raw.headers, raw.body, responseType);
  } catch (err) {
    if (isCancelled(opts.signal)) return abortResponse<T>();
    if (timedOut) return timeoutResponse<T>(timeoutMs);
    if (isAbortError(err)) return timeoutResponse<T>(timeoutMs);
    return networkResponse<T>(err);
  }
};

/**
 * 发一次请求。**永不抛错。**
 *
 * `net` 允许为 `null`（平台没实现网络能力时直接用 `platform.net`），此时返回一条
 * `kind: 'network'` 的失败响应 —— 比让调用方到处判空更省事，也符合「错误是数据」。
 */
export const request = async <T = unknown>(
  net: NetService | null,
  opts: RequestOptions,
  retry?: RetryPolicy,
): Promise<NetResponse<T>> => {
  if (net === null || net === undefined) {
    return {
      ok: false,
      status: 0,
      headers: {},
      data: null,
      error: { kind: 'network', message: '当前平台没有网络能力（platform.net 缺失）', retryable: false },
    };
  }
  // 已取消：一个请求都不发给平台
  if (isCancelled(opts.signal)) return abortResponse<T>();

  const timeoutMs = resolveTimeout(opts.timeoutMs);
  const responseType = resolveResponseType(opts.responseType);
  const policy = resolveRetry(retry);

  let last = await attempt<T>(net, opts, timeoutMs, responseType);
  for (let done = 1; done < policy.attempts; done += 1) {
    if (last.ok) return last;
    if (last.error === undefined) return last;
    // 取消不重试，哪怕 policy 写了 attempts > 1
    if (last.error.kind === 'abort' || !last.error.retryable) return last;
    if (isCancelled(opts.signal)) return abortResponse<T>();
    await sleep(backoffDelay(done, policy));
    // 退避期间被取消：别再把下一发打出去
    if (isCancelled(opts.signal)) return abortResponse<T>();
    last = await attempt<T>(net, opts, timeoutMs, responseType);
  }
  return last;
};
