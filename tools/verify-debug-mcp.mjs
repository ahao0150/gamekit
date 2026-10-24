#!/usr/bin/env node
/**
 * 运行时调试 MCP 的端到端验收（8a）。
 *
 * 不是单测：真的 spawn 一个 `mg-debug-mcp` 子进程、真的走 MCP stdio 协议、
 * 真的和浏览器里跑着的游戏通过 WebSocket 通信。断言的是验收清单里那五条：
 *
 *   1. canvas()   → 尺寸 / dpr 对
 *   2. tree()     → 能列出真实绘制记录，且能认出背景 / 车厢格子 / 按钮
 *   3. screenshot → 落 PNG 文件（文件存在且是有效 PNG 头）
 *   4. click()    → 真实 pointer 事件，state 里 phase 变化
 *   5. state()    → 能读到业务状态
 *
 * 前置：`mg dev` 已起、浏览器已打开游戏页面（游戏会自己连 ws://127.0.0.1:7788）。
 *
 * 用法：node tools/verify-debug-mcp.mjs [--out out/debug]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(repoRoot, 'out', 'debug');
const argOut = process.argv.indexOf('--out');
if (argOut >= 0 && process.argv[argOut + 1] !== undefined) resolve(repoRoot, process.argv[argOut + 1]);

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : `（${detail}）`}`);
};

// ---------------------------------------------------------------------------
// 极简 MCP 客户端：一行一条 JSON-RPC
// ---------------------------------------------------------------------------
const child = spawn(process.execPath, ['packages/debug-mcp/bin/mg-debug-mcp.mjs'], {
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
    }, 15000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolvePromise(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

const callTool = async (name, args = {}) => {
  const reply = await rpc('tools/call', { name, arguments: args });
  if (reply.error !== undefined) throw new Error(`协议错误：${reply.error.message}`);
  const content = reply.result.content?.[0]?.text ?? '';
  if (reply.result.isError === true) throw new Error(content);
  return { text: content, isError: false };
};

/** 轮询 canvas 直到游戏连上（dev 时游戏比脚本先起是常态，1s 重连一次）。 */
const waitForGame = async (timeoutMs = 40000) => {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    try {
      return await callTool('canvas');
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      if (!last.includes('没连上')) throw error;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`等了 ${timeoutMs}ms 游戏还是没连上：${last}`);
};

const cleanup = () => {
  try {
    child.stdin.end();
  } catch {
    // ignore
  }
  try {
    child.kill();
  } catch {
    // ignore
  }
};

// ---------------------------------------------------------------------------
// 验收
// ---------------------------------------------------------------------------
try {
  mkdirSync(outDir, { recursive: true });

  // 0. 协议握手
  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-debug-mcp', version: '0.1.0' } });
  check('initialize 返回 serverInfo', init.result?.serverInfo?.name === 'mg-debug-mcp', JSON.stringify(init.result?.serverInfo));
  const list = await rpc('tools/list');
  const names = (list.result?.tools ?? []).map((t) => t.name);
  check('tools/list 声明五个工具', ['canvas', 'tree', 'state', 'screenshot', 'click'].every((n) => names.includes(n)), names.join(', '));

  // 1. canvas()
  const canvas = await waitForGame();
  const sizeOk = /画面 390×844/.test(canvas.text);
  check('canvas() 尺寸 390×844', sizeOk, canvas.text.split('\n')[0]);
  const dprMatch = /dpr=(\d+(?:\.\d+)?)/.exec(canvas.text);
  check('canvas() 带 dpr 与帧率', dprMatch !== null && /帧率 [\d.]+ fps/.test(canvas.text), `dpr=${dprMatch?.[1] ?? '?'}`);

  // 2. tree()
  const tree = await callTool('tree', { limit: 3 });
  const parsed = JSON.parse(tree.text);
  const calls = (parsed.latest?.calls ?? []);
  const kinds = new Set(calls.map((c) => c.kind));
  check('tree() 有绘制记录', calls.length > 0, `${calls.length} 次绘制 / ${parsed.frames?.length ?? 0} 帧`);
  check('tree() 覆盖 image / rect / text 三类', kinds.has('image') && kinds.has('rect') && kinds.has('text'), [...kinds].join(','));
  const fullscreen = calls.find((c) => c.kind === 'image' && c.rect && c.rect.w >= 380 && c.rect.h >= 800);
  check('tree() 能认出全屏背景图', fullscreen !== undefined, fullscreen === undefined ? '没找到铺满画布的 image' : `${fullscreen.asset ?? '?'} ${fullscreen.rect.w}×${fullscreen.rect.h}`);
  const cells = calls.filter((c) => c.kind === 'image' && c.asset !== undefined && /grid|cell/.test(c.asset));
  check('tree() 能认出车厢格子', cells.length > 0, cells.length === 0 ? '没找到 grid/cell 资源' : `${cells.length} 个：${cells[0]?.asset ?? '?'} @${cells[0]?.rect?.x},${cells[0]?.rect?.y}`);
  const buttons = calls.filter((c) => c.kind === 'image' && c.asset !== undefined && /btn/.test(c.asset));
  check('tree() 能认出按钮', buttons.length > 0, buttons.length === 0 ? '没找到 btn 资源' : `${buttons.length} 个：${buttons[0]?.asset ?? '?'} @${buttons[0]?.rect?.x},${buttons[0]?.rect?.y}`);
  check('tree() 带布局树（可与绘制记录对比）', parsed.layout !== null && typeof parsed.layout === 'object', parsed.layout === null ? 'layout 为空' : `primary=${JSON.stringify(parsed.layout.primary)}`);

  // 3. state() + screenshot()
  const stateBefore = JSON.parse((await callTool('state')).text);
  check('state() 能读到游戏状态', typeof stateBefore.phase === 'string', `phase=${stateBefore.phase}`);
  const shot = await callTool('screenshot', { name: 'mcp-home' });
  const shotPath = /已截图：(.+)/.exec(shot.text)?.[1]?.trim() ?? '';
  const pngOk = existsSync(shotPath) && readFileSync(shotPath).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  check('screenshot() 落 PNG 且文件头正确', pngOk, shotPath);

  // 4. click()：点主按钮中心，phase 必须迁移
  const primary = parsed.layout?.primary;
  if (primary === undefined) throw new Error('布局树里没有 primary 按钮，无法执行 click 验收');
  const cx = Math.round(primary.x + primary.w / 2);
  const cy = Math.round(primary.y + primary.h / 2);
  const clickResult = await callTool('click', { x: cx, y: cy });
  await new Promise((r) => setTimeout(r, 250));
  const stateAfter = JSON.parse((await callTool('state')).text);
  const expected = stateBefore.phase === 'home' ? 'goal' : stateBefore.phase;
  check('click() 走真实事件路径并让 phase 迁移', stateAfter.phase !== stateBefore.phase, `${stateBefore.phase} → ${stateAfter.phase}（点 ${cx},${cy}）`);
  check('phase 迁移到预期的下一阶段', stateAfter.phase === expected, `期望 ${expected}，实际 ${stateAfter.phase}`);
  void clickResult;

  const shot2 = await callTool('screenshot', { name: 'mcp-after-click' });
  const shot2Path = /已截图：(.+)/.exec(shot2.text)?.[1]?.trim() ?? '';
  check('click 之后能再截一张', existsSync(shot2Path), shot2Path);

  // 5. 绘制记录必须是「真的画了」：最后一帧的调用数 > 0 且文字非空
  const treeAfter = JSON.parse((await callTool('tree', { limit: 1 })).text);
  const texts = (treeAfter.latest?.calls ?? []).filter((c) => c.kind === 'text' && typeof c.text === 'string' && c.text.length > 0);
  check('tree() 里有真实文字绘制', texts.length > 0, texts.map((t) => t.text).slice(0, 3).join(' / '));
} catch (error) {
  check('验收过程中没有异常', false, error instanceof Error ? error.message : String(error));
} finally {
  cleanup();
}

const failed = results.filter((r) => !r.pass);
console.log('');
console.log(`端到端验收：${results.length - failed.length} 通过 / ${failed.length} 失败`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  ✗ ${f.name}：${f.detail ?? ''}`);
  console.log('--- debug-mcp stderr ---');
  for (const line of stderrLines.slice(-20)) console.log(line);
  process.exitCode = 1;
}
