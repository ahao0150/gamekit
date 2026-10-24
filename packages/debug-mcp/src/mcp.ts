/**
 * MCP server（stdio 传输）。
 *
 * MCP 的 stdio 传输格式很简单：**一行一条 JSON-RPC 2.0 消息**，stdin 收、stdout 发。
 * 所以这里不需要任何 SDK —— 实现四个方法就够一个只读工具服务：
 * `initialize` / `tools/list` / `tools/call` / `ping`。
 *
 * 两条硬约束：
 * 1. **stdout 只能放协议消息**。任何日志都必须走 stderr，否则客户端解析会炸；
 * 2. 通知（没有 `id` 的消息，如 `notifications/initialized`）**不回复**。
 */

import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { MCP_PROTOCOL_VERSION, SERVER_INFO } from './contract';
import type { RpcNotification, RpcRequest, RpcResponse, ToolResult, ToolSpec } from './contract';

export interface McpServerOptions {
  readonly specs: readonly ToolSpec[];
  readonly call: (name: string, params: Record<string, unknown>) => Promise<ToolResult>;
  /** 输入输出流（默认 stdin/stdout；测试注入内存流）。 */
  readonly input?: Readable;
  readonly output?: Writable;
  /** 日志（默认写 stderr，绝不能用 stdout）。 */
  readonly log?: (line: string) => void;
  /** stdin 关闭时回调（MCP 客户端退出）：宿主据此收掉自己的资源并让进程退出。 */
  readonly onInputClose?: () => void;
}

const RPC_ERROR = {
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

/** 把工具结果转成 MCP 的 content 数组。 */
const asContent = (result: ToolResult): unknown => ({
  content: [{ type: 'text', text: result.text }],
  ...(result.isError === true ? { isError: true } : {}),
});

export interface McpServer {
  /** 处理一条原始文本（测试直接调它，不经过 stdin）。 */
  handleLine(line: string): Promise<void>;
  /** 写一行响应（测试用来断言输出）。 */
  close(): void;
  /**
   * 服务端主动推一条 JSON-RPC 通知（无 id、不期待回复）。
   * 用于 `watch`：值变化时推 `notifications/message`。
   */
  notify(method: string, params?: unknown): void;
}

export const startMcpServer = (options: McpServerOptions): McpServer => {
  const output = options.output ?? process.stdout;
  const log = options.log ?? ((line: string): void => void process.stderr.write(`${line}\n`));
  const write = (message: RpcResponse | RpcNotification): void => {
    output.write(`${JSON.stringify(message)}\n`);
  };

  const replyError = (id: number | string, code: number, message: string): void =>
    write({ jsonrpc: '2.0', id, error: { code, message } });

  /** 按方法分发。返回 null 表示「这是通知，不用回」。 */
  const dispatch = async (request: RpcRequest): Promise<RpcResponse | null> => {
    const hasId = typeof request.id === 'number' || typeof request.id === 'string';
    const id = hasId ? (request.id as number | string) : null;
    const method = request.method;

    if (!hasId) {
      // 通知：只记日志，不回复
      log(`[mcp] 通知 ${method}`);
      return null;
    }
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: id as number | string,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        };
      case 'ping':
        return { jsonrpc: '2.0', id: id as number | string, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id: id as number | string, result: { tools: options.specs } };
      case 'tools/call': {
        const params = request.params;
        if (typeof params !== 'object' || params === null) {
          return { jsonrpc: '2.0', id: id as number | string, error: { code: RPC_ERROR.invalidParams, message: 'tools/call 缺少参数对象' } };
        }
        const callParams = params as { name?: unknown; arguments?: unknown };
        const name = typeof callParams.name === 'string' ? callParams.name : '';
        if (name.length === 0) {
          return { jsonrpc: '2.0', id: id as number | string, error: { code: RPC_ERROR.invalidParams, message: 'tools/call 缺少工具名 name' } };
        }
        const args = typeof callParams.arguments === 'object' && callParams.arguments !== null ? (callParams.arguments as Record<string, unknown>) : {};
        const result = await options.call(name, args);
        log(`[mcp] ${name} → ${result.isError === true ? '失败' : '成功'}`);
        return { jsonrpc: '2.0', id: id as number | string, result: asContent(result) };
      }
      default:
        return {
          jsonrpc: '2.0',
          id: id as number | string,
          error: { code: RPC_ERROR.methodNotFound, message: `不支持的方法：${method}` },
        };
    }
  };

  const handleLine = async (line: string): Promise<void> => {
    const text = line.trim();
    if (text.length === 0) return;
    let request: RpcRequest;
    try {
      request = JSON.parse(text) as RpcRequest;
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '请求不是合法 JSON' } });
      return;
    }
    if (typeof request.method !== 'string') {
      write({ jsonrpc: '2.0', id: null, error: { code: RPC_ERROR.invalidParams, message: '缺少 method 字段' } });
      return;
    }
    try {
      const response = await dispatch(request);
      if (response !== null) write(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[mcp] 处理 ${request.method} 出错：${message}`);
      if (request.id !== undefined) replyError(request.id, RPC_ERROR.internal, message);
    }
  };

  const input = options.input ?? process.stdin;
  const reader = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  reader.on('line', (line: string) => {
    void handleLine(line);
  });
  reader.on('close', () => {
    log('[mcp] stdin 关闭，准备退出');
    options.onInputClose?.();
  });

  return {
    handleLine,
    close: () => reader.close(),
    notify: (method: string, params?: unknown): void => {
      write(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params });
    },
  };
};
