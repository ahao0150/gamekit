/**
 * web 平台网络的**真链路**测试：真 `fetch` + 真 `Headers` + 真 HTTP 服务（只打 127.0.0.1）。
 *
 * 为什么需要它：`core/net` 的测试用 mock 平台，mock 返回的是普通对象 —— 恰恰绕过了
 * 「web 传的是 `Headers` 实例」这个差异。响应头 bug 就是这样漏掉的（core 全绿、web 全空）。
 * 这两条用例覆盖的是「平台层 + core 一起」的行为。
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createCancel } from '../../core/net/cancel';
import { request } from '../../core/net/request';
import { createWebNet } from './net';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const servers: { close: () => Promise<void> }[] = [];

const serve = async (handler: Handler): Promise<number> => {
  const server = createServer(handler);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  servers.push({
    close: () => new Promise<void>((ok) => {
      server.close(() => ok());
      server.closeAllConnections?.();
    }),
  });
  return port;
};

afterEach(async () => {
  while (servers.length > 0) {
    const entry = servers.pop();
    if (entry !== undefined) await entry.close();
  }
});

describe('createWebNet + request（真 fetch）', () => {
  it('自定义响应头能读回来（Headers → lowercaseHeaders，曾因 Object.entries 恒为空）', async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-total-count': '42' }).end('{"ok":true}');
    });
    const res = await request(createWebNet(), { url: `http://127.0.0.1:${port}/` });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ ok: true });
    expect(res.headers['x-total-count']).toBe('42');
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('请求中取消 → kind=abort（不是 timeout，也不会被重试）', async () => {
    const port = await serve((_req, res) => {
      setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end('{"late":true}'), 300);
    });
    const net = createWebNet();
    const cancel = createCancel();
    const pending = request(net, { url: `http://127.0.0.1:${port}/`, signal: cancel.signal }, { attempts: 3 });
    setTimeout(() => cancel.abort(), 20);
    const res = await pending;
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.error?.kind).toBe('abort');
    expect(res.error?.retryable).toBe(false);
  });

  it('超时（无取消）仍归 timeout —— 与取消区分开', async () => {
    const port = await serve((_req, res) => {
      setTimeout(() => res.writeHead(200, {}).end('{}'), 300);
    });
    const res = await request(createWebNet(), { url: `http://127.0.0.1:${port}/`, timeoutMs: 40 });
    expect(res.error?.kind).toBe('timeout');
    expect(res.error?.retryable).toBe(true);
  });
});
