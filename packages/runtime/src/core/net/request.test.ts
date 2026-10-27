// @long-file 契约测试按「成功 / 解析 / HTTP / 传输 / 体归一 / 取消 / 超时与取消区分 / 退避」分组，一个文件才看得出判定顺序的全貌
/**
 * `core/net/request` 的契约测试：全部用 mock 平台驱动，**不连真网**。
 *
 * 断言口径按「错误是数据」来写：任何失败都必须能读到 `ok: false` + `error.kind` +
 * `error.retryable`，而不是靠 catch 到异常。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockNet } from '../../platform/mock/net';
import { createCancel } from './cancel';
import { NO_RETRY } from './contract';
import { backoffDelay, request } from './request';

const OK_JSON = { status: 200, headers: { 'content-type': 'application/json' }, body: '{"id":7,"name":"灵脉"}' };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('成功路径', () => {
  it('200 + JSON：ok、data 已解析、headers 透传', async () => {
    const net = createMockNet({ response: OK_JSON });
    const res = await request<{ id: number; name: string }>(net, { url: 'https://x/api' });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ id: 7, name: '灵脉' });
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.error).toBeUndefined();
  });

  it('默认 method 是 GET、默认超时 8000、默认 responseType json', async () => {
    const net = createMockNet({ response: OK_JSON });
    await request(net, { url: 'https://x/a' });
    expect(net.requests[0]?.method).toBe('GET');
    expect(net.requests[0]?.timeoutMs).toBe(8000);
    expect(net.requests[0]?.responseType).toBe('json');
  });

  it('responseType 显式 text：不解析，data 是原始字符串', async () => {
    const net = createMockNet({ response: OK_JSON });
    const res = await request(net, { url: 'https://x/a', responseType: 'text' });
    expect(res.ok).toBe(true);
    expect(res.data).toBe(OK_JSON.body);
  });

  it('responseType arraybuffer：原样返回二进制', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const net = createMockNet({ response: { status: 200, headers: {}, body: bytes } });
    const res = await request(net, { url: 'https://x/a', responseType: 'arraybuffer' });
    expect(res.ok).toBe(true);
    expect(res.data).toBe(bytes);
  });

  it('204 空体：算成功、data 为 null（不当解析失败）', async () => {
    const net = createMockNet({ response: { status: 204, headers: {}, body: '' } });
    const res = await request(net, { url: 'https://x/a' });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(204);
    expect(res.data).toBeNull();
    expect(res.error).toBeUndefined();
  });

  it('200 空体同样算成功', async () => {
    const net = createMockNet({ response: { status: 200, headers: {}, body: null } });
    const res = await request(net, { url: 'https://x/a' });
    expect(res.ok).toBe(true);
    expect(res.data).toBeNull();
  });
});

describe('JSON 解析失败', () => {
  it('200 + 非 JSON：kind=parse、ok=false、data 放原文、不可重试', async () => {
    const net = createMockNet({ response: { status: 200, headers: {}, body: 'not json at all' } });
    const res = await request(net, { url: 'https://x/a' });
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe('parse');
    expect(res.error?.retryable).toBe(false);
    expect(res.data).toBe('not json at all');
  });

  it('parse 错误不触发重试（attempts=3 也只发一次）', async () => {
    const net = createMockNet({ response: { status: 200, headers: {}, body: '<html>' } });
    const res = await request(net, { url: 'https://x/a' }, { attempts: 3 });
    expect(net.requests).toHaveLength(1);
    expect(res.error?.kind).toBe('parse');
  });
});

describe('HTTP 错误', () => {
  it('404：kind=http、retryable=false，但 body 仍解析进 data', async () => {
    const net = createMockNet({ response: { status: 404, headers: {}, body: 'missing' } });
    const res = await request(net, { url: 'https://x/a' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.error?.kind).toBe('http');
    expect(res.error?.retryable).toBe(false);
    // 非 2xx 也保留 body：'missing' 不是 JSON，回落成原文
    expect(res.data).toBe('missing');
  });

  it('4xx 带 JSON body：data 是解析后的对象（{ code, message } 不丢）', async () => {
    const net = createMockNet({ response: { status: 400, headers: {}, body: '{"code":1001,"message":"缺参数"}' } });
    const res = await request(net, { url: 'https://x/a' });
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe('http');
    expect(res.data).toEqual({ code: 1001, message: '缺参数' });
  });

  it('500：kind=http、retryable=true', async () => {
    const net = createMockNet({ response: { status: 500, headers: {}, body: '' } });
    const res = await request(net, { url: 'https://x/a' });
    expect(res.error?.kind).toBe('http');
    expect(res.error?.retryable).toBe(true);
  });

  it('4xx 即使给了 attempts 也不重试', async () => {
    const net = createMockNet({ response: { status: 400, headers: {}, body: '' } });
    await request(net, { url: 'https://x/a' }, { attempts: 5 });
    expect(net.requests).toHaveLength(1);
  });

  it('默认不重试：500 只发一次', async () => {
    const net = createMockNet({ response: { status: 500, headers: {}, body: '' } });
    await request(net, { url: 'https://x/a' });
    expect(net.requests).toHaveLength(1);
    expect(NO_RETRY.attempts).toBe(1);
  });

  it('500 + attempts=3：恰好发 3 次，按 300/600 退避', async () => {
    const net = createMockNet({ response: { status: 500, headers: {}, body: '' } });
    const pending = request(net, { url: 'https://x/a' }, { attempts: 3, baseDelayMs: 300, maxDelayMs: 2000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(net.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(299);
    expect(net.requests).toHaveLength(1); // 还没到退避时间
    await vi.advanceTimersByTimeAsync(1);
    expect(net.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(600);
    expect(net.requests).toHaveLength(3);
    const res = await pending;
    expect(res.error?.kind).toBe('http');
    expect(res.status).toBe(500);
  });
});

describe('传输层失败', () => {
  it('超时：kind=timeout、status=0、retryable=true', async () => {
    const net = createMockNet({ delayMs: 500, response: OK_JSON });
    const pending = request(net, { url: 'https://x/a', timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const res = await pending;
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.error?.kind).toBe('timeout');
    expect(res.error?.retryable).toBe(true);
  });

  it('平台抛错：kind=network、status=0', async () => {
    const net = createMockNet({
      respond: () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const res = await request(net, { url: 'https://x/a' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.error?.kind).toBe('network');
    expect(res.error?.message).toContain('ECONNREFUSED');
    expect(res.error?.retryable).toBe(true);
  });

  it('平台抛 name=AbortError：归成 timeout 而不是 network', async () => {
    const net = createMockNet({
      respond: () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      },
    });
    const res = await request(net, { url: 'https://x/a' });
    expect(res.error?.kind).toBe('timeout');
  });

  it('网络错会按 policy 重试（attempts=2）', async () => {
    let calls = 0;
    const net = createMockNet({
      respond: () => {
        calls += 1;
        throw new Error('boom');
      },
    });
    const pending = request(net, { url: 'https://x/a' }, { attempts: 2, baseDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    const res = await pending;
    expect(calls).toBe(2);
    expect(res.error?.kind).toBe('network');
  });

  it('net 为 null：返回 network 错误而不是抛异常', async () => {
    const res = await request(null, { url: 'https://x/a' });
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe('network');
    expect(res.error?.retryable).toBe(false);
  });
});

describe('请求体归一化', () => {
  it('对象 body：JSON.stringify + 自动补 Content-Type', async () => {
    const net = createMockNet({ response: OK_JSON });
    await request(net, { url: 'https://x/a', method: 'POST', body: { name: '炎十七' } });
    const sent = net.requests[0];
    expect(sent?.body).toBe('{"name":"炎十七"}');
    expect(sent?.headers?.['Content-Type']).toBe('application/json');
  });

  it('已有 Content-Type（任意大小写）不覆盖', async () => {
    const net = createMockNet({ response: OK_JSON });
    await request(net, {
      url: 'https://x/a',
      method: 'POST',
      body: { a: 1 },
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const sent = net.requests[0];
    expect(sent?.headers?.['content-type']).toBe('application/x-www-form-urlencoded');
    expect(sent?.headers?.['Content-Type']).toBeUndefined();
  });

  it('字符串 body 原样发，不补 Content-Type', async () => {
    const net = createMockNet({ response: OK_JSON });
    await request(net, { url: 'https://x/a', method: 'POST', body: 'raw=1' });
    const sent = net.requests[0];
    expect(sent?.body).toBe('raw=1');
    expect(sent?.headers?.['Content-Type']).toBeUndefined();
  });
});

describe('取消', () => {
  it('已取消的 signal：一个请求都不发，直接 kind=abort', async () => {
    const net = createMockNet({ response: OK_JSON });
    const cancel = createCancel();
    cancel.abort();
    const res = await request(net, { url: 'https://x/a', signal: cancel.signal });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.error?.kind).toBe('abort');
    expect(res.error?.retryable).toBe(false);
    // 关键断言：平台层的 request 一次都没被调用
    expect(net.requests).toHaveLength(0);
  });

  it('请求在飞时取消 → kind=abort、status=0、retryable=false', async () => {
    const net = createMockNet({ delayMs: 500, response: OK_JSON });
    const cancel = createCancel();
    const pending = request(net, { url: 'https://x/a', signal: cancel.signal });
    await vi.advanceTimersByTimeAsync(0);
    cancel.abort();
    const res = await pending;
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.error?.kind).toBe('abort');
    expect(res.error?.retryable).toBe(false);
  });

  it('attempts=3 但请求中取消 → 只发 1 次，不重试', async () => {
    const net = createMockNet({ delayMs: 500, response: OK_JSON });
    const cancel = createCancel();
    const pending = request(
      net,
      { url: 'https://x/a', signal: cancel.signal },
      { attempts: 3, baseDelayMs: 10, maxDelayMs: 100 },
    );
    await vi.advanceTimersByTimeAsync(0);
    cancel.abort();
    const res = await pending;
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.requests).toHaveLength(1);
    expect(res.error?.kind).toBe('abort');
  });

  it('退避等待期间取消：不再发下一发', async () => {
    const net = createMockNet({ response: { status: 503, headers: {}, body: '' } });
    const cancel = createCancel();
    const pending = request(
      net,
      { url: 'https://x/a', signal: cancel.signal },
      { attempts: 3, baseDelayMs: 300, maxDelayMs: 2000 },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(net.requests).toHaveLength(1);
    cancel.abort(); // 正在退避
    await vi.advanceTimersByTimeAsync(5000);
    const res = await pending;
    expect(net.requests).toHaveLength(1); // 没再发
    expect(res.error?.kind).toBe('abort');
  });
});

describe('超时与取消的区分（判定顺序）', () => {
  it('同一份「平台抛 AbortError」行为：signal 未取消 → timeout；signal 已取消 → abort', async () => {
    const makeNet = (): ReturnType<typeof createMockNet> =>
      createMockNet({
        delayMs: 50,
        respond: () => {
          const err = new Error('aborted by platform');
          err.name = 'AbortError';
          throw err;
        },
      });

    // (a) 传一个没被取消的 signal：平台自报 AbortError → 只能算超时
    const quiet = createCancel();
    const quietNet = makeNet();
    const quietPending = request(quietNet, { url: 'https://x/a', signal: quiet.signal });
    await vi.advanceTimersByTimeAsync(50);
    const asTimeout = await quietPending;
    expect(asTimeout.error?.kind).toBe('timeout');
    expect(asTimeout.error?.retryable).toBe(true);

    // (b) 同一份平台行为，但期间用户取消过：signal 是真源 → 必须算取消
    const loud = createCancel();
    const loudNet = makeNet();
    const loudPending = request(loudNet, { url: 'https://x/a', signal: loud.signal });
    await vi.advanceTimersByTimeAsync(0);
    loud.abort();
    await vi.advanceTimersByTimeAsync(50); // 让平台也把 AbortError 抛出来
    const asAbort = await loudPending;
    expect(asAbort.error?.kind).toBe('abort');
    expect(asAbort.error?.retryable).toBe(false);
  });

  it('平台抛 AbortError 且没有 signal：仍归 timeout（兼容老路径）', async () => {
    const net = createMockNet({
      respond: () => {
        const err = new Error('timeout inside platform');
        err.name = 'AbortError';
        throw err;
      },
    });
    const res = await request(net, { url: 'https://x/a' });
    expect(res.error?.kind).toBe('timeout');
  });
});

describe('退避纯函数', () => {
  it('指数退避并封顶', () => {
    const policy = { attempts: 5, baseDelayMs: 300, maxDelayMs: 2000 };
    expect(backoffDelay(1, policy)).toBe(300);
    expect(backoffDelay(2, policy)).toBe(600);
    expect(backoffDelay(3, policy)).toBe(1200);
    expect(backoffDelay(4, policy)).toBe(2000); // 2400 → 封顶 2000
    expect(backoffDelay(9, policy)).toBe(2000);
  });
});
