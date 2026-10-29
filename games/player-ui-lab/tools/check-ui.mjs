#!/usr/bin/env node
/**
 * `ui.check` 命令行封装（本工程自用）：走 ui-demo 那套 MCP stdio 客户端，
 * 对 `ui/*.ui` 跑固定两视口（390×844 / 320×568），打印原始 JSON。
 *
 * 用法：node games/player-ui-lab/tools/check-ui.mjs [ui 文件名]
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectMcp } from '../../ui-demo/tools/mcp-client.mjs';

const REPO = resolve(import.meta.dirname, '../../..');
const fileName = process.argv[2] ?? 'player.ui';
const source = await readFile(resolve(REPO, 'games/player-ui-lab/ui', fileName), 'utf8');

const mcp = await connectMcp(REPO, 'player-ui-lab-check', { timeoutMs: 20000 });
try {
  const raw = await mcp.callTool('ui.check', {
    source,
    fileName,
    viewports: ['390x844', '375x812', '375x667', '320x568'],
    // v0.7 + registry 参数：用本工程自己的注册表（9 个自定义组件），不再撞「未知组件」
    registry: 'games/player-ui-lab/src/app/ui-registry.ts',
  });
  console.log(raw);
} finally {
  mcp.close();
}
