/**
 * 验收脚本共用的极简 MCP 客户端（一行一条 JSON-RPC over stdio）。
 *
 * 为什么抽出来：`verify-ui.mjs` 和 `verify-runtime.mjs` 各抄了一份同样的
 * spawn / rpc / callTool / cleanup，两份都要改的时候必有一份漏。抽成模块后
 * 每个验收脚本只保留自己的断言。
 *
 * 不做的事：不重试、不重连、不吞错 —— 这些属于各脚本的验收语义
 * （`verify-runtime` 有一次「连接断开」重试，`verify-ui` 没有）。
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/**
 * 起一个 `mg-debug-mcp` 子进程并 initialize。
 *
 * @param {string} repoRoot 仓库根（定位 MCP 入口）
 * @param {string} clientName 上报给服务端的客户端名（日志里能分辨谁在跑）
 * @param {{ timeoutMs?: number }} [options] 单次调用超时（默认 20 秒）
 */
export const connectMcp = async (repoRoot, clientName, options = {}) => {
  const timeoutMs = options.timeoutMs ?? 20000;
  const child = spawn(process.execPath, [join(repoRoot, 'packages/debug-mcp/bin/mg-debug-mcp.mjs')], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stderrLines = [];
  createInterface({ input: child.stderr }).on('line', (line) => stderrLines.push(line));

  let nextId = 0;
  const pending = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (waiter === undefined) return;
    pending.delete(message.id);
    waiter(message);
  });

  const rpc = (method, params) =>
    new Promise((resolvePromise, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP 调用超时：${method}`));
      }, timeoutMs);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolvePromise(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  /** 调工具：协议错误 / 工具报错都抛异常，返回文本内容。 */
  const callTool = async (name, args = {}) => {
    const reply = await rpc('tools/call', { name, arguments: args });
    if (reply.error !== undefined) throw new Error(`协议错误：${reply.error.message}`);
    const content = reply.result.content?.[0]?.text ?? '';
    if (reply.result.isError === true) throw new Error(content);
    return content;
  };

  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: clientName, version: '0.1.0' },
  });
  const listTools = async () => (await rpc('tools/list')).result?.tools ?? [];

  const close = () => {
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  };

  return { init, rpc, callTool, listTools, close, stderrLines };
};
