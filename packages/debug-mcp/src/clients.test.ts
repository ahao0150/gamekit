/**
 * 多客户端测试（T24）：真实 TCP + 真实握手，不 mock WebSocket。
 *
 * 为什么不用假 client：这次修的是「两个 bridge 互相顶掉」的真问题，只有真的建两条连接、
 * 真的发 hello、真的断开，才能证明「集合管理 + 默认打最新 + 指定打指定」是成立的。
 * 端口用 0（系统分配），不会和真实 `mg dev` 的 7788 撞车。
 */

import { connect } from 'node:net';
import type { Socket } from 'node:net';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeFrames } from './frame';
import { createClientPicker } from './client-picker';
import { createClientsTool } from './clients-tool';
import { createWsServer } from './ws-server';
import type { WsServer } from './ws-server';

/** 造一个客户端帧（规范要求客户端必须 mask）。 */
const clientFrame = (text: string): Buffer => {
  const payload = Buffer.from(text, 'utf8');
  const mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    masked[i] = (payload.readUInt8(i) ^ (mask.readUInt8(i % 4) ?? 0)) & 0xff;
  }
  const len = payload.length;
  const header = len < 126 ? Buffer.from([0x81, 0x80 | len]) : Buffer.from([0x81, 0x80 | 126, 0, 0]);
  if (len >= 126) header.writeUInt16BE(len, 2);
  return Buffer.concat([header, mask, masked]);
};

const helloText = (platform: string): string =>
  JSON.stringify({
    type: 'hello',
    hello: { platform, screen: { width: 390, height: 844, dpr: 2 }, tools: ['canvas', 'tree', 'state', 'screenshot', 'click'] },
  });

const waitFor = async (predicate: () => boolean, label = '条件'): Promise<void> => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 3000) throw new Error(`等待超时：${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

let server: WsServer;
const sockets: Socket[] = [];

/** 建一条真实 WebSocket 连接：握手 → 发 hello → 等 assigned。 */
const openClient = async (platform = 'web'): Promise<{ socket: Socket; clientId: Promise<string> }> => {
  const socket = connect(server.port, '127.0.0.1');
  sockets.push(socket);
  let resolveId: (id: string) => void = () => undefined;
  const clientId = new Promise<string>((resolve) => {
    resolveId = resolve;
  });
  let buffer: Buffer = Buffer.alloc(0);
  let handshook = false;
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!handshook) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      handshook = true;
      buffer = buffer.subarray(end + 4);
      socket.write(clientFrame(helloText(platform)));
    }
    const decoded = decodeFrames(buffer);
    buffer = decoded.rest;
    for (const frame of decoded.frames) {
      const text = frame.payload.toString('utf8');
      if (!text.includes('"assigned"')) continue;
      try {
        const message = JSON.parse(text) as { clientId?: string };
        if (typeof message.clientId === 'string') resolveId(message.clientId);
      } catch {
        // 不是 JSON 就忽略（assigned 一定是我们发的，但别让测试因为脏帧挂掉）
      }
    }
  });
  await once(socket, 'connect');
  const key = Buffer.from('0123456789abcdef').toString('base64');
  socket.write(
    'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  return { socket, clientId };
};

beforeEach(async () => {
  server = await createWsServer(0); // 0 = 系统分配随机端口
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await server.close();
});

describe('多客户端集合', () => {
  it('两个客户端连上：集合里两个、id 不同，assigned 回给游戏侧的 id 与集合一致', async () => {
    const first = await openClient('web');
    const second = await openClient('wechat');
    const ids = [await first.clientId, await second.clientId];
    await waitFor(() => server.clients().length === 2, '两个客户端都 hello');
    expect(ids).toEqual(['c1', 'c2']);
    expect(server.clients().map((client) => client.id)).toEqual(['c1', 'c2']);
    expect(server.clients()[0]?.hello?.platform).toBe('web');
    expect(server.clients()[1]?.hello?.platform).toBe('wechat');
  });

  it('新连接**不顶掉**旧连接（这次修复的核心）：c1 仍在线、connected=true', async () => {
    const first = await openClient();
    await first.clientId;
    await waitFor(() => server.clients().length === 1);
    const second = await openClient();
    await second.clientId;
    await waitFor(() => server.clients().length === 2);
    expect(server.get('c1')?.connected).toBe(true);
    expect(server.get('c2')?.connected).toBe(true);
  });

  it('断开一个：只移除自己，另一个仍可用且成为最新', async () => {
    const first = await openClient();
    const second = await openClient();
    await first.clientId;
    await second.clientId;
    await waitFor(() => server.clients().length === 2);
    first.socket.destroy();
    await waitFor(() => server.clients().length === 1, 'c1 被移除');
    expect(server.get('c1')).toBeNull();
    expect(server.latest()?.id).toBe('c2');
  });

  it('id 自增且不复用：断开 c1 后新连接是 c2（不会又变成 c1），再来一个是 c3', async () => {
    const first = await openClient();
    await first.clientId;
    await waitFor(() => server.clients().length === 1);
    first.socket.destroy();
    await waitFor(() => server.clients().length === 0);
    const second = await openClient();
    expect(await second.clientId).toBe('c2');
    await waitFor(() => server.clients().length === 1);
    const third = await openClient();
    expect(await third.clientId).toBe('c3');
    expect(server.clients().map((client) => client.id)).toEqual(['c2', 'c3']);
  });
});

describe('目标客户端选择', () => {
  it('不传 client 打最新连上的那个', async () => {
    const first = await openClient();
    const second = await openClient();
    await first.clientId;
    await second.clientId;
    await waitFor(() => server.clients().length === 2);
    const picker = createClientPicker(() => server);
    expect(picker.pick({}).id).toBe('c2');
  });

  it('传 client 打指定的那个；之后断开 c2 默认回到 c1', async () => {
    const first = await openClient();
    const second = await openClient();
    await first.clientId;
    await second.clientId;
    await waitFor(() => server.clients().length === 2);
    const picker = createClientPicker(() => server);
    expect(picker.pick({ client: 'c1' }).id).toBe('c1');
    expect(picker.pick({ client: 'c2' }).id).toBe('c2');
    second.socket.destroy();
    await waitFor(() => server.clients().length === 1);
    expect(picker.pick({}).id).toBe('c1');
  });

  it('指定的客户端已断开 → 明确报错并列出当前在线', async () => {
    const first = await openClient();
    const second = await openClient();
    await first.clientId;
    await second.clientId;
    await waitFor(() => server.clients().length === 2);
    first.socket.destroy();
    await waitFor(() => server.clients().length === 1);
    const picker = createClientPicker(() => server);
    expect(() => picker.pick({ client: 'c1' })).toThrow('客户端 c1 已断开，当前在线：c2');
  });

  it('全部断开 → 报「游戏没连上」；client 参数非法也报明确错误', async () => {
    const picker = createClientPicker(() => server);
    expect(() => picker.pick({})).toThrow('游戏没连上调试服务端');
    const client = await openClient();
    await client.clientId;
    await waitFor(() => server.clients().length === 1);
    expect(() => picker.pick({ client: 42 })).toThrow('client 参数需要连接 id');
    expect(() => picker.pick({ client: '  ' })).toThrow('client 参数需要连接 id');
  });
});

describe('clients 工具', () => {
  it('列出两个客户端：id / platform / screen / connectedAt 都在', async () => {
    const first = await openClient('web');
    const second = await openClient('douyin');
    await first.clientId;
    await second.clientId;
    await waitFor(() => server.clients().length === 2);
    const tool = createClientsTool(createClientPicker(() => server));
    expect(tool.handles('clients')).toBe(true);
    expect(tool.handles('mg.clients')).toBe(true);
    const result = await tool.call('clients', {});
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.text) as {
      count: number;
      clients: { id: string; platform: string; screen: { width: number; height: number; dpr: number }; connectedAt: string }[];
    };
    expect(payload.count).toBe(2);
    expect(payload.clients.map((item) => item.id)).toEqual(['c1', 'c2']);
    expect(payload.clients[0]?.platform).toBe('web');
    expect(payload.clients[1]?.platform).toBe('douyin');
    expect(payload.clients[0]?.screen).toEqual({ width: 390, height: 844, dpr: 2 });
    expect(Number.isFinite(Date.parse(payload.clients[0]?.connectedAt ?? ''))).toBe(true);
  });

  it('没有客户端时返回 count 0（不是错误，AI 据此知道该先起游戏）', async () => {
    const tool = createClientsTool(createClientPicker(() => server));
    const result = await tool.call('clients', {});
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.text) as { count: number; clients: unknown[]; note: string };
    expect(payload.count).toBe(0);
    expect(payload.clients).toEqual([]);
    expect(payload.note).toContain('没有客户端');
  });
});
