/**
 * 调试 MCP 的契约：工具签名 + 与「游戏侧 bridge」之间的消息类型。
 *
 * 分两层看这个包：
 * 1. **对外**（MCP 工具面）：AI 看到的五个工具，参数与返回都在这里定；
 * 2. **对内**（WebSocket 协议）：和游戏侧 `packages/runtime/src/debug/bridge.ts`
 *    约定同一种消息形状。两边是同一份契约的两个方向，改这里就要两边一起改。
 *
 * 为什么错误信息要求中文：这些字符串会原样出现在 AI 的工具结果里，
 * 「游戏没连上」和「WebSocket connection failed」对 AI 的成本差一个数量级。
 */

// ---------------------------------------------------------------------------
// 对内：WebSocket 消息
// ---------------------------------------------------------------------------

/** 游戏连上后主动上报的环境信息。 */
export interface HelloMessage {
  readonly type: 'hello';
  readonly hello: {
    readonly platform: string;
    readonly screen: { readonly width: number; readonly height: number; readonly dpr: number };
    readonly tools: readonly string[];
  };
}

/** 服务端 → 游戏的命令。 */
export interface CommandMessage {
  readonly id: number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

/** 游戏 → 服务端的回包。 */
export interface ResultMessage {
  readonly id: number;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// 对外：五个工具
// ---------------------------------------------------------------------------

/** 工具名（与游戏侧 handlers 的 key 必须一致）。 */
export const TOOL_NAMES = ['canvas', 'tree', 'state', 'screenshot', 'click'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** 一个 MCP 工具的声明（`tools/list` 返回的形状）。 */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
  };
}

/** 工具执行结果：`text` 是给 AI 读的内容，失败时 `isError` 让 MCP 客户端当成错误。 */
export interface ToolResult {
  readonly text: string;
  readonly isError?: boolean;
}

/** `screenshot` 参数。 */
export interface ScreenshotParams {
  /** 落盘路径（相对仓库根或绝对路径）；不传则写到默认 out 目录 */
  readonly out?: string;
  /** 覆盖文件名（不带扩展名也行，最终强制 .png） */
  readonly name?: string;
}

/** `click` 参数：逻辑像素坐标（左上角原点，与游戏绘制坐标系一致）。 */
export interface ClickParams {
  readonly x: number;
  readonly y: number;
}

/** `tree` 参数。 */
export interface TreeParams {
  /** 返回最近几帧，默认 1（只看当前帧） */
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// 对外：MCP / JSON-RPC
// ---------------------------------------------------------------------------

/** JSON-RPC 2.0 请求（MCP 的 stdio 传输就是一行一条 JSON）。 */
export interface RpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: number | string;
  readonly method: string;
  readonly params?: unknown;
}

/** JSON-RPC 2.0 响应。 */
export interface RpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

/** JSON-RPC 2.0 通知（无 id、不期待回复）：watch 变化推送用。 */
export interface RpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: unknown;
}

/** MCP 协议版本：定在当前广泛兼容的一版，客户端会协商。 */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

/** 服务端信息（`initialize` 返回）。 */
export const SERVER_INFO = { name: 'mg-debug-mcp', version: '0.1.0' } as const;
