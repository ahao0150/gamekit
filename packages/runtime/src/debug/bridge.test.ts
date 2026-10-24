/**
 * WebSocket 桥接契约测试。
 *
 * node 里没有服务端，用一个假 WebSocket 顶替全局 `WebSocket`：
 * 验证的正是协议行为本身 —— 上线先报 hello、命令按名字分发、未知工具与
 * handler 抛错都要回一句**中文**错误（AI 直接读这条）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBridge } from './bridge';
import type { HelloPayload } from './contract';

/** 假 WebSocket：记录发出去的消息，允许测试主动触发 open / message / close。 */
class FakeSocket {
  static last: FakeSocket | null = null;
  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  /** 测试侧：模拟连接建立 */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  /** 测试侧：模拟服务端下发命令 */
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  /** 解析已发送的消息 */
  parsed(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw) as unknown);
  }
}

const HELLO: HelloPayload = { platform: 'web', screen: { width: 390, height: 844, dpr: 2 }, tools: ['canvas'] };

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createBridge', () => {
  const original = globalThis.WebSocket;

  beforeEach(() => {
    FakeSocket.last = null;
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;
  });

  afterEach(() => {
    (globalThis as { WebSocket?: unknown }).WebSocket = original;
  });

  it('连上后先发 hello（带工具清单）', () => {
    const bridge = createBridge({ url: 'ws://127.0.0.1:7788', hello: HELLO, handlers: {} });
    const socket = FakeSocket.last;
    expect(socket).not.toBeNull();
    expect(socket?.url).toBe('ws://127.0.0.1:7788');
    expect(bridge.state).toBe('connecting');
    socket?.open();
    expect(bridge.state).toBe('open');
    expect(socket?.parsed()).toEqual([{ type: 'hello', hello: HELLO }]);
    bridge.close();
  });

  it('按方法名分发命令并回包', async () => {
    const bridge = createBridge({
      url: 'ws://127.0.0.1:7788',
      hello: HELLO,
      handlers: { canvas: () => ({ width: 390, dpr: 2 }) },
    });
    FakeSocket.last?.open();
    FakeSocket.last?.receive({ id: 7, method: 'canvas' });
    await flush();
    const replies = FakeSocket.last?.parsed() ?? [];
    expect(replies[1]).toEqual({ id: 7, ok: true, result: { width: 390, dpr: 2 } });
    bridge.close();
  });

  it('未知工具回中文错误并列出可用工具', async () => {
    const bridge = createBridge({
      url: 'ws://127.0.0.1:7788',
      hello: HELLO,
      handlers: { canvas: () => null },
    });
    FakeSocket.last?.open();
    FakeSocket.last?.receive({ id: 8, method: 'no-such-tool' });
    await flush();
    const reply = (FakeSocket.last?.parsed() ?? [])[1] as { ok: boolean; error: string };
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('未知工具');
    expect(reply.error).toContain('canvas');
    bridge.close();
  });

  it('handler 抛错时回 ok=false，错误信息可读', async () => {
    const bridge = createBridge({
      url: 'ws://127.0.0.1:7788',
      hello: HELLO,
      handlers: {
        click: () => {
          throw new Error('click 需要 x / y');
        },
      },
    });
    FakeSocket.last?.open();
    FakeSocket.last?.receive({ id: 9, method: 'click', params: {} });
    await flush();
    const reply = (FakeSocket.last?.parsed() ?? [])[1] as { ok: boolean; error: string };
    expect(reply).toEqual({ id: 9, ok: false, error: 'click 需要 x / y' });
    bridge.close();
  });

  it('close() 之后断线不再重连', () => {
    const events: string[] = [];
    const bridge = createBridge({
      url: 'ws://127.0.0.1:7788',
      hello: HELLO,
      handlers: {},
      onEvent: (event) => events.push(event),
    });
    const socket = FakeSocket.last;
    socket?.open();
    bridge.close();
    expect(bridge.state).toBe('closed');
    expect(socket?.readyState).toBe(3);
    expect(events).toContain('open');
    // close 后再来一条消息不应该有回包
    const before = socket?.sent.length ?? 0;
    socket?.receive({ id: 1, method: 'canvas' });
    expect(socket?.sent.length).toBe(before);
  });
});
