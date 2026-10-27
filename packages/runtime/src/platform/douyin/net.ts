/**
 * 抖音小游戏网络实现：`tt.request` + `tt.connectSocket`。
 *
 * 与微信端同形（字段、`dataType` 陷阱、SocketTask 回调式都一样），所以这里
 * 保留一份独立实现而不是共享：**平台差异只准出现在各自平台的实现里**
 * （AGENTS §3），两端将来任何一端改口径都不该牵动另一端。
 *
 * 与微信同样已知限制：`method` 合法值不含 **PATCH**，如实传下去由基础库 fail，
 * core 归一成 `kind: 'network'`。要真用 PATCH 得服务端配合 method override。
 */

import type { CancelSignal, RequestOptions } from '../../core/net/contract';
import type { Unsubscribe } from '../contract';
import type { NetService, RawNetResponse, SocketTransport } from '../net-contract';
import { abortError, failMessage, lowercaseHeaders, normalizeBody } from '../net-utils';
import type { TtApi, TtSocketTask } from './api';

/** 契约的 method 里只有 PATCH 不属于小游戏合法集合，其余同名可直接传。 */
const TT_METHODS = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  DELETE: 'DELETE',
  PATCH: 'PATCH',
} as const;

const requestOnce = (api: TtApi, opts: RequestOptions, signal?: CancelSignal): Promise<RawNetResponse> =>
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
      method: TT_METHODS[opts.method ?? 'GET'],
      header: { ...(opts.headers ?? {}) },
      ...(opts.body === undefined ? {} : { data: opts.body }),
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
          : new Error(failMessage(err, 'tt.request 失败')));
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
  api: TtApi,
  url: string,
  protocols?: readonly string[],
): Promise<SocketTransport> =>
  new Promise<SocketTransport>((resolve, reject) => {
    let task: TtSocketTask;
    try {
      task = api.connectSocket({
        url,
        ...(protocols === undefined ? {} : { protocols: [...protocols] }),
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(failMessage(err, 'tt.connectSocket 失败')));
      return;
    }

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
      for (const cb of [...errorCbs]) cb(res.errMsg ?? '抖音 socket 错误');
    });

    resolve({
      send(data: string | ArrayBuffer): void {
        try {
          task.send({ data });
        } catch {
          // 已关闭：core 只在 open 时 send，这里吞掉竞态
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

export const createDouyinNet = (api: TtApi): NetService => ({
  request: (opts: RequestOptions, signal?: CancelSignal): Promise<RawNetResponse> =>
    requestOnce(api, opts, signal),
  connect: (url: string, protocols?: readonly string[]): Promise<SocketTransport> =>
    connectOnce(api, url, protocols),
});
