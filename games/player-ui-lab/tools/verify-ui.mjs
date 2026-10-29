#!/usr/bin/env node
/**
 * `ui.check` 的等价检查（本工程自用，补工具限制）。
 *
 * 为什么需要：MCP 的 `ui.check` 把 `knownComponents` 写死成内置 32 个组件的注册表
 * （`packages/debug-mcp/src/ui-tools.ts:34`），本工程的 9 个组件一定被判「未知组件」。
 * 在它支持 `registry` 参数之前，这里用**同一条链**自己算：
 *
 *   parse(源码, optionsFromRegistry(本工程注册表))
 *     → bindComponents(注册表, viewport) → layout(viewport)
 *     → collectIssues(parsed, result, viewport)     ← 与 ui.check 同一份断言实现
 *
 * 断言范围与 `ui.check` 一致：语法错误、绑定错误（未知组件 / 未注册）、越界、
 * 同 region 重叠、0×0。**不覆盖** `ui.check` 的 `results[].rects` 之外的排版建议
 * （preview 的 ASCII 图不在本脚本里）。
 *
 * 用法：node games/player-ui-lab/tools/verify-ui.mjs [--viewports 390x844,320x568]
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const REPO = resolve(import.meta.dirname, '../../..');
const UI_PATH = resolve(REPO, 'games/player-ui-lab/ui/player.ui');

const parseViewports = (text) => text.split(',').map((item) => {
  const match = /^(\d+)x(\d+)$/.exec(item.trim());
  if (match === null) throw new Error(`--viewports 要写成 390x844,320x568，收到 '${item}'`);
  return { width: Number(match[1]), height: Number(match[2]) };
});

const argv = process.argv.slice(2);
const at = argv.indexOf('--viewports');
const viewportText = at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : '390x844,320x568';
const viewports = parseViewports(viewportText);

const server = await createServer({
  configFile: false, root: REPO, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, watch: null },
});

let exitCode = 0;
try {
  const { parse } = await server.ssrLoadModule('/packages/runtime/src/core/ui/parse.ts');
  const { bindComponents } = await server.ssrLoadModule('/packages/runtime/src/core/ui/bind.ts');
  const { layout } = await server.ssrLoadModule('/packages/runtime/src/core/ui/layout.ts');
  const { collectIssues } = await server.ssrLoadModule('/packages/debug-mcp/src/ui-issues.ts');
  const { optionsFromRegistry } = await server.ssrLoadModule('/packages/ui-plugin/src/index.ts');
  const { createPlayerRegistry } = await server.ssrLoadModule('/games/player-ui-lab/src/app/ui-registry.ts');

  const registry = createPlayerRegistry();
  const source = await readFile(UI_PATH, 'utf8');
  const parsed = parse(source, { fileName: 'player.ui', ...optionsFromRegistry(registry) });

  console.log(`source: ${UI_PATH}`);
  if (parsed.errors.length > 0) {
    console.log(`语法错误 ${parsed.errors.length} 条：`);
    for (const error of parsed.errors) console.log(`  ✗ ${error}`);
    exitCode = 3;
  } else {
    for (const viewport of viewports) {
      const bound = bindComponents(parsed.spec, {
        registry,
        env: { viewport: { width: viewport.width, height: viewport.height }, data: {} },
      });
      const result = layout(bound.spec, viewport);
      const issues = collectIssues(parsed, result, viewport).map((issue) => issue.message);
      const errors = [...bound.errors, ...issues];
      const tag = `${viewport.width}x${viewport.height}`;
      console.log(`\n[${tag}] errors=${errors.length}`);
      for (const error of errors) console.log(`  ✗ ${error}`);
      if (errors.length > 0 && tag === '390x844') exitCode = 1;
      const names = Object.keys(result.rects);
      console.log(`  rects(${names.length}): ${names.map((name) => {
        const r = result.rects[name];
        return `${name}=${r.x},${r.y},${r.w},${r.h}`;
      }).join('  ')}`);
    }
  }
} finally {
  await server.close();
}

process.exit(exitCode);
