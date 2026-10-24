/**
 * MCP 协议层测试：不经过 stdin/stdout，直接喂原始文本、断言回包。
 *
 * 覆盖的是「MCP 客户端真正会走的那四条路」：初始化、列工具、调工具、以及
 * 通知不回复。工具内部失败（比如游戏没连上）要变成 `isError` 而不是协议错误 ——
 * 否则 AI 会看到「内部错误」而不是「游戏没连上，先跑 mg dev」。
 */

import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { startMcpServer } from './mcp';
import type { RpcResponse, ToolResult, ToolSpec } from './contract';

const SPECS: ToolSpec[] = [
  {
    name: 'canvas',
    description: '画布信息',
    inputSchema: { type: 'object', properties: {} },
  },
];

/** 造一个 server + 收集输出的辅助器。 */
const setup = (call: (name: string, params: Record<string, unknown>) => Promise<ToolResult>) => {
  const output = new PassThrough();
  const lines: string[] = [];
  output.on('data', (chunk: Buffer) => {
    for (const raw of chunk.toString('utf8').split('\n')) {
      if (raw.trim().length > 0) lines.push(raw);
    }
  });
  const server = startMcpServer({
    specs: SPECS,
    call,
    input: new PassThrough(),
    output,
    log: () => undefined,
  });
  const run = async (request: unknown): Promise<void> => {
    await server.handleLine(JSON.stringify(request));
  };
  const parsed = (): RpcResponse[] => lines.map((raw) => JSON.parse(raw) as RpcResponse);
  return { server, run, parsed };
};

describe('MCP 协议', () => {
  it('initialize 返回协议版本与工具能力', async () => {
    const { run, parsed } = setup(async () => ({ text: '' }));
    await run({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const reply = parsed()[0];
    expect(reply?.id).toBe(1);
    const result = reply?.result as { protocolVersion: string; capabilities: { tools: unknown }; serverInfo: { name: string } };
    expect(result.protocolVersion.length).toBeGreaterThan(0);
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe('mg-debug-mcp');
  });

  it('tools/list 返回工具声明', async () => {
    const { run, parsed } = setup(async () => ({ text: '' }));
    await run({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const result = parsed()[0]?.result as { tools: ToolSpec[] };
    expect(result.tools.map((t) => t.name)).toEqual(['canvas']);
  });

  it('tools/call 把工具结果包成 content 文本', async () => {
    const { run, parsed } = setup(async (name) => ({ text: `工具 ${name} 的结果` }));
    await run({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'canvas', arguments: {} } });
    const result = parsed()[0]?.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(result.content[0]?.text).toBe('工具 canvas 的结果');
    expect(result.isError).toBeUndefined();
  });

  it('工具失败时 isError 为 true，文本保留中文原因', async () => {
    const { run, parsed } = setup(async () => ({ text: '游戏没连上调试服务端', isError: true }));
    await run({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'canvas', arguments: {} } });
    const result = parsed()[0]?.result as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('游戏没连上调试服务端');
  });

  it('未知方法回 -32601', async () => {
    const { run, parsed } = setup(async () => ({ text: '' }));
    await run({ jsonrpc: '2.0', id: 5, method: 'no/such' });
    expect(parsed()[0]?.error?.code).toBe(-32601);
  });

  it('通知（没有 id）不产生任何输出', async () => {
    const { run, parsed } = setup(async () => ({ text: '' }));
    await run({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(parsed()).toHaveLength(0);
  });

  it('非法 JSON 回 -32700', async () => {
    const { server, parsed } = setup(async () => ({ text: '' }));
    await server.handleLine('{不是 json');
    expect(parsed()[0]?.error?.code).toBe(-32700);
  });
});
