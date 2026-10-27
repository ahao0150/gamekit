/**
 * 网络适配的共用小工具：三端实现里重复的三件事。
 *
 * 与 `keyboard-utils.ts` / `wheel-utils.ts` 同一定位 —— **纯函数，不碰平台 API**。
 * 平台差异（header 大小写、statusCode 字段名、是否自动 JSON.parse）都在这里抹平，
 * 让 `core/net` 只需要面对一种形状。
 */

/** 有 `entries()` 的头容器（web 的 `Headers`）。结构探测而非 `instanceof`：小游戏环境没有 `Headers`。 */
interface HeadersLike {
  entries(): Iterable<[string, string]>;
}

const hasEntries = (value: object): value is HeadersLike =>
  typeof (value as { readonly entries?: unknown }).entries === 'function';

/**
 * 响应头统一小写。
 *
 * **web 传进来的是 `Headers` 实例，必须走 `entries()`**：`Headers` 没有可枚举自有属性，
 * `Object.entries(headers)` 会返回 `[]` —— 那会让 web 端响应头恒为 `{}`（分页总数、
 * Content-Type 判断、服务端 token 全读不到），而 wx/tt 传的是普通对象、行为正常，
 * 属于「只在 web 崩、三端测试不一定覆盖」的不一致 bug（2026-10-27 实测）。
 */
export const lowercaseHeaders = (header: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (typeof header !== 'object' || header === null) return out;
  const source: Iterable<readonly [string, unknown]> = hasEntries(header)
    ? header.entries()
    : Object.entries(header as Record<string, unknown>);
  for (const [key, value] of source) {
    if (typeof value === 'string') out[key.toLowerCase()] = value;
    else if (typeof value === 'number') out[key.toLowerCase()] = String(value);
  }
  return out;
};

/**
 * 响应体归一成 `string | ArrayBuffer | null`。
 *
 * 为什么要兜一层：微信 `wx.request` 的 `dataType` 在**老基础库里默认 'json'**，
 * 会自行 `JSON.parse` —— 解析责任必须收回 core，否则三端的「什么时候是字符串、
 * 什么时候是对象」永远对不齐。这里把意外拿到的对象序列化回文本。
 */
export const normalizeBody = (data: unknown): string | ArrayBuffer | null => {
  if (data === undefined || data === null) return null;
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
};

/**
 * 造一个「超时」错误。
 *
 * `name === 'AbortError'` 是平台层与 core 层的约定（见 `platform/net-contract.ts`）：
 * web 的 `AbortController` 天然抛这个名字，小游戏端手动对齐同一个名字，
 * 于是 core 不必给契约加字段就能区分「超时」与「网络错」。
 */
export const abortError = (message: string): Error => {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
};

/** 从平台错误里抠一句人话（wx/tt 的 fail 参数通常是 `{ errMsg }`）。 */
export const failMessage = (err: unknown, fallback: string): string => {
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    const errMsg = (err as { readonly errMsg?: unknown }).errMsg;
    if (typeof errMsg === 'string' && errMsg.length > 0) return errMsg;
    const message = (err as { readonly message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return fallback;
};
