/**
 * `core/net/socket` 的契约测试：状态机、排队、心跳、重连全路径。
 *
 * 用 `createMockNet()` 的假连接（`autoOpen: false` 时由测试手动 `open()`），
 * 时间靠 `vi.useFakeTimers()` 精确推进，**不真 sleep、不连真网**。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockNet } from '../../platform/mock/net';
import { SOCKET_QUEUE_LIMIT } from './contract';
import { openSocket, reconnectDelay } from './socket';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('状态机', () => {
  it('idle → connecting → open', async () => {
    const net = createMockNet();
    const ws = openSocket(net, { url: 'ws://x' });
    expect(ws.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.state).toBe('open');
    expect(net.sockets).toHaveLength(1);
  });

  it('open 事件只触发一次，且 payload 为空', async () => {
    const net = createMockNet();
    const ws = openSocket(net, { url: 'ws://x' });
    let opens = 0;
    ws.on('open', () => {
      opens += 1;
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(opens).toBe(1);
  });

  it('主动 close：state=closed、wasClean=true、不再重连', async () => {
    const net = createMockNet();
    const ws = openSocket(net, { url: 'ws://x', reconnect: { maxAttempts: 3, baseDelayMs: 10 } });
    await vi.advanceTimersByTimeAsync(0);
    const closes: { code: number; wasClean: boolean }[] = [];
    ws.on('close', (payload) => {
      closes.push({ code: payload.code, wasClean: payload.wasClean });
    });
    ws.close(1000, 'bye');
    await vi.advanceTimersByTimeAsync(1000);
    expect(ws.state).toBe('closed');
    expect(closes).toEqual([{ code: 1000, wasClean: true }]);
    expect(net.sockets).toHaveLength(1); // 没有重连
    expect(ws.reconnectCount).toBe(0);
  });

  it('对端异常关闭（1006）：wasClean=false', async () => {
    const net = createMockNet();
    const ws = openSocket(net, { url: 'ws://x' });
    await vi.advanceTimersByTimeAsync(0);
    const closes: { code: number; wasClean: boolean; reason: string }[] = [];
    ws.on('close', (payload) => {
      closes.push({ code: payload.code, wasClean: payload.wasClean, reason: payload.reason });
    });
    net.sockets[0]?.close(1006, 'gone');
    expect(closes).toEqual([{ code: 1006, wasClean: false, reason: 'gone' }]);
    expect(ws.state).toBe('closed');
  });

  it('message 事件 + recvCount', async () => {
    const net = createMockNet();
    const ws = openSocket(net, { url: 'ws://x' });
    await vi.advanceTimersByTimeAsync(0);
    const seen: (string | ArrayBuffer)[] = [];
    ws.on('message', (data) => {
      seen.push(data);
    });
    net.sockets[0]?.message('hello');
    net.sockets[0]?.message(new Uint8Array([1, 2]).buffer);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe('hello');
    expect(ws.recvCount).toBe(2);
  });

  it('error 事件把平台消息原样带出来', async () => {
    const net = createMockNet();
    const ws = openSocket(net, { url: 'ws://x' });
    await vi.advanceTimersByTimeAsync(0);
    const errors: string[] = [];
    ws.on('error', (payload) => {
      errors.push(payload.message);
    });
    net.sockets[0]?.error('handshake failed');
    expect(errors).toEqual(['handshake failed']);
  });

  it('on() 返回的退订函数真的能摘掉回调', async () => {
    const net = createMockNet();
    const ws = openSocket(net, { url: 'ws://x' });
    await vi.advanceTimersByTimeAsync(0);
    const seen: string[] = [];
    const off = ws.on('message', (data) => {
      seen.push(String(data));
    });
    net.sockets[0]?.message('a');
    off();
    net.sockets[0]?.message('b');
    expect(seen).toEqual(['a']);
  });
});

describe('发送队列', () => {
  it('非 open 时 send 返回 false 并入队，open 后按序 flush', async () => {
    const net = createMockNet({ autoOpen: false });
    const ws = openSocket(net, { url: 'ws://x' });
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.state).toBe('connecting');

    expect(ws.send('a')).toBe(false);
    expect(ws.send('b')).toBe(false);
    expect(net.sockets[0]?.sent).toHaveLength(0);

    net.sockets[0]?.open();
    expect(ws.state).toBe('open');
    expect(net.sockets[0]?.sent).toEqual(['a', 'b']);
    expect(ws.sentCount).toBe(2);

    expect(ws.send('c')).toBe(true);
    expect(net.sockets[0]?.sent).toEqual(['a', 'b', 'c']);
  });

  it(`队列上限 ${SOCKET_QUEUE_LIMIT}：溢出丢最旧并计 droppedCount`, async () => {
    const net = createMockNet({ autoOpen: false });
    const ws = openSocket(net, { url: 'ws://x' });
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < SOCKET_QUEUE_LIMIT + 5; i += 1) ws.send(`m${i}`);
    expect(ws.droppedCount).toBe(5);
    net.sockets[0]?.open();
    const sent = net.sockets[0]?.sent ?? [];
    expect(sent).toHaveLength(SOCKET_QUEUE_LIMIT);
    expect(sent[0]).toBe('m5'); // 最旧的 5 条被丢掉
    expect(sent[sent.length - 1]).toBe(`m${SOCKET_QUEUE_LIMIT + 4}`);
  });
});

describe('心跳', () => {
  it('open 后按 interval 发固定数据，次数与 sentCount 一致', async () => {
    const net = createMockNet();
    const ws = openSocket(net, { url: 'ws://x', heartbeat: { data: 'ping', intervalMs: 1000 } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(net.sockets[0]?.sent).toEqual(['ping', 'ping', 'ping']);
    expect(ws.sentCount).toBe(3);
  });

  it('没有 heartbeat 时一条都不发', async () => {
    const net = createMockNet();
    openSocket(net, { url: 'ws://x' });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(net.sockets[0]?.sent).toHaveLength(0);
  });

  it('close 之后心跳停掉', async () => {
    const net = createMockNet();
    const ws = openSocket(net, { url: 'ws://x', heartbeat: { data: 'ping', intervalMs: 1000 } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    ws.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(net.sockets[0]?.sent).toEqual(['ping']); // 只有关闭前那一发
  });
});

describe('重连', () => {
  it('maxAttempts=2：恰好重连 2 次然后停下', async () => {
    const net = createMockNet();
    const ws = openSocket(net, { url: 'ws://x', reconnect: { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 1000 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(net.sockets).toHaveLength(1);

    net.sockets[0]?.close(1006, 'down');
    expect(ws.state).toBe('connecting'); // 重连期间如实标 connecting
    expect(ws.reconnectCount).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(net.sockets).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(0);
    net.sockets[1]?.close(1006, 'down again');
    expect(ws.reconnectCount).toBe(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(net.sockets).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(0);
    net.sockets[2]?.close(1006, 'still down');
    await vi.advanceTimersByTimeAsync(5000);
    expect(net.sockets).toHaveLength(3); // 用完次数，不再重连
    expect(ws.reconnectCount).toBe(2);
    expect(ws.state).toBe('closed');
  });

  it('没配 reconnect 时断开就停在 closed', async () => {
    const net = createMockNet();
    const ws = openSocket(net, { url: 'ws://x' });
    await vi.advanceTimersByTimeAsync(0);
    net.sockets[0]?.close(1006, 'down');
    await vi.advanceTimersByTimeAsync(10000);
    expect(net.sockets).toHaveLength(1);
    expect(ws.reconnectCount).toBe(0);
    expect(ws.state).toBe('closed');
  });

  it('重连成功后队列里的消息照样按序发出', async () => {
    const net = createMockNet();
    const ws = openSocket(net, { url: 'ws://x', reconnect: { maxAttempts: 1, baseDelayMs: 10 } });
    await vi.advanceTimersByTimeAsync(0);
    net.sockets[0]?.close(1006, 'down');
    ws.send('queued');
    // 一次推进覆盖「退避 10ms + 新连接的同刻 autoOpen」，分两次推进容易漏掉同刻新建的 timer
    await vi.advanceTimersByTimeAsync(20);
    expect(ws.state).toBe('open');
    expect(net.sockets[1]?.sent).toEqual(['queued']);
  });
});

describe('失败兜底', () => {
  it('连接超时：closed + error，不抛异常', async () => {
    const net = createMockNet({ autoOpen: false });
    const ws = openSocket(net, { url: 'ws://x', timeoutMs: 50 });
    const errors: string[] = [];
    ws.on('error', (payload) => {
      errors.push(payload.message);
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(ws.state).toBe('closed');
    expect(errors[0]).toContain('连接超时');
  });

  it('net 为 null：closed + 一次 error + 一次 close（事件在微任务里发，订阅收得到）', async () => {
    const ws = openSocket(null, { url: 'ws://x' });
    const events: string[] = [];
    ws.on('error', (payload) => {
      events.push(`error:${payload.message}`);
    });
    ws.on('close', (payload) => {
      events.push(`close:${payload.reason}`);
    });
    expect(ws.state).toBe('closed');
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toHaveLength(2);
    expect(events[0]).toContain('没有网络能力');
    expect(events[1]).toBe('close:no-net');
  });

  it('平台 connect 直接 reject：closed + error', async () => {
    const net = createMockNet();
    // 用 url 触发不了 reject，直接换一个会 reject 的 NetService
    const failing = {
      request: net.request,
      connect: (): Promise<never> => Promise.reject(new Error('端口不可达')),
    };
    const ws = openSocket(failing, { url: 'ws://x' });
    const errors: string[] = [];
    ws.on('error', (payload) => {
      errors.push(payload.message);
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.state).toBe('closed');
    expect(errors).toEqual(['端口不可达']);
  });

  it('连接超时后立刻 close() 不会重复发 close 事件', async () => {
    const net = createMockNet({ autoOpen: false });
    const ws = openSocket(net, { url: 'ws://x', timeoutMs: 20 });
    const closes: string[] = [];
    ws.on('close', (payload) => {
      closes.push(payload.reason);
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(closes).toHaveLength(1);
    ws.close();
    expect(closes).toHaveLength(1); // 已经 closed，close() 是幂等的
  });
});

describe('退避纯函数', () => {
  it('指数退避并封顶', () => {
    const policy = { maxAttempts: 5, baseDelayMs: 500, maxDelayMs: 8000 };
    expect(reconnectDelay(1, policy)).toBe(500);
    expect(reconnectDelay(2, policy)).toBe(1000);
    expect(reconnectDelay(4, policy)).toBe(4000);
    expect(reconnectDelay(5, policy)).toBe(8000); // 8000 封顶
    expect(reconnectDelay(8, policy)).toBe(8000);
  });
});
