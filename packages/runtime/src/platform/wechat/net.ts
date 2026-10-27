/**
 * 微信小游戏网络实现：`wx.request` + `wx.connectSocket`。
 *
 * 三处与 web 不同、都在这里抹平（core 不感知）：
 * 1. 字段名：`statusCode` / `header`（fetch 是 status / headers）；
 * 2. **`dataType` 必须显式传 'text'**：微信默认 'json' 会自行 `JSON.parse`，
 *    那样三端「什么时候给字符串」就不一致了，解析权收回 core；
 * 3. header 键名大小写不保证 → 统一小写。
 *
 * 超时：`wx.request` 自身有 timeout，但各基础库默认值不一（有 60s 的）；
 * 这里自己计时并 `task.abort()`，保证与 web 的 8s 口径一致。
 *
 * 已知限制：微信 `method` 合法值不含 **PATCH**（只有 OPTIONS/GET/HEAD/POST/PUT/DELETE/
 * TRACE/CONNECT）。契约保留 PATCH 是为了三端签名统一，微信端如实传下去，
 * 基础库会走 fail，被归一成 `kind: 'network'`。要真用 PATCH 得服务端配合 method override。
 */

import type { CancelSignal, RequestOptions } from '../../core/net/contract';
import type { Unsubscribe } from '../contract';
import type { NetService, RawNetResponse, SocketTransport } from '../net-contract';
import { abortError, failMessage, lowercaseHeaders, normalizeBody } from '../net-utils';
import type { WxApi, WxSocketTask } from './api';

/** 契约的 method 里只有 PATCH 不属于微信的合法集合，其余同名可直接传。 */
const WX_METHODS = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  DELETE: 'DELETE',
  PATCH: 'PATCH',
} as const;

const requestOnce = (api: WxApi, opts: RequestOptions, signal?: CancelSignal): Promise<RawNetResponse> =>
  new Promise<RawNetResponse>((resolve, reject) => {
    const timeoutMs = opts.timeoutMs ?? 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let offAbort: () => void = () => undefined;

    const finish = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      offAbort();
    };

    const task = api.request({
      url: opts.url,
      method: WX_METHODS[opts.method ?? 'GET'],
      header: { ...(opts.headers ?? {}) },
      ...(opts.body === undefined ? {} : { data: opts.body }),
      // 关键：不让微信自己解析
      dataType: 'text',
      responseType: opts.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
      success: (res) => {
        if (settled) return;
        settled = true;
        finish();
        resolve({
          status: res.statusCode,
          headers: lowercaseHeaders(res.header),
          body: normalizeBody(res.data),
        });
      },
      fail: (err) => {
        if (settled) return;
        settled = true;
        finish();
        // 取消也是 fail：按 signal 归成 AbortError，与「真的失败」分开
        reject(signal?.aborted === true
          ? abortError('请求已取消')
          : new Error(failMessage(err, 'wx.request 失败')));
      },
    });

    // 取消桥接：core 的 CancelSignal → RequestTask.abort()
    if (signal !== undefined) {
      offAbort = signal.onAbort(() => {
        try {
          task.abort();
        } catch {
          // abort 失败也要让 core 的 race 立刻返回
        }
      });
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        finish();
        try {
          task.abort();
        } catch {
          // abort 失败不影响「已经超时」这个结论
        }
        reject(abortError(`请求超时（${timeoutMs}ms）`));
      }, timeoutMs);
    }
  });

const connectOnce = (
  api: WxApi,
  url: string,
  protocols?: readonly string[],
): Promise<SocketTransport> =>
  new Promise<SocketTransport>((resolve, reject) => {
    let task: WxSocketTask;
    try {
      task = api.connectSocket({
        url,
        ...(protocols === undefined ? {} : { protocols: [...protocols] }),
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(failMessage(err, 'wx.connectSocket 失败')));
      return;
    }

    // 与 web 同一套形状：事件先收到本地 Set，再转给订阅者。
    // 微信的 SocketTask.onXxx 是「注册监听」，可多次调用；退订靠 Set 移除，
    // 底层回调里 Set 为空自然不再转发（微信没有 offXxx）。
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

    task.onOpen(() => {
      for (const cb of [...openCbs]) cb();
    });
    task.onMessage((res) => {
      const data = res.data;
      for (const cb of [...messageCbs]) cb(data);
    });
    task.onClose((res) => {
      for (const cb of [...closeCbs]) cb(res.code, res.reason);
    });
    task.onError((res) => {
      for (const cb of [...errorCbs]) cb(res.errMsg ?? '微信 socket 错误');
    });

    resolve({
      send(data: string | ArrayBuffer): void {
        try {
          task.send({ data });
        } catch {
          // 已关闭：core 的 send 只在 open 时调用，这里吞掉竞态
        }
      },
      close(code?: number, reason?: string): void {
        try {
          task.close({ code, reason });
        } catch {
          // 重复关闭：忽略
        }
      },
      onOpen: (cb) => subscribe(openCbs, cb),
      onMessage: (cb) => subscribe(messageCbs, cb),
      onClose: (cb) => subscribe(closeCbs, cb),
      onError: (cb) => subscribe(errorCbs, cb),
    });
  });

export const createWechatNet = (api: WxApi): NetService => ({
  request: (opts: RequestOptions, signal?: CancelSignal): Promise<RawNetResponse> =>
    requestOnce(api, opts, signal),
  connect: (url: string, protocols?: readonly string[]): Promise<SocketTransport> =>
    connectOnce(api, url, protocols),
});
