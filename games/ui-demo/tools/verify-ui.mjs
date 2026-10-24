#!/usr/bin/env node
/**
 * ui-demo 的界面层验收（T10 ①）：所有 `.ui` × 两个视口。
 *
 * 1. **真走 MCP stdio** 调离线工具 `mg.ui.check` / `mg.ui.preview`（T8 的 AI 工具链：
 *    不启动游戏、不启动浏览器、纯 Node 算）；
 * 2. 用 demo 注册表做 `knownComponents` 校验 + `bindComponents` → `layout()`，
 *    补上「组件真的能算尺寸」这一步（MCP 的 check 不接注册表）；
 * 3. 打印 ASCII 预览（给人读，也给报告贴）。
 *
 * 用法：node games/ui-demo/tools/verify-ui.mjs [--no-ascii]
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { connectMcp } from './mcp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const showAscii = !process.argv.includes('--no-ascii');

// runtime 没有 dist（tsc --noEmit），和 `mg` 一样注册 TS resolve 钩子后动态加载源码
register(new URL('../../../packages/cli/bin/ts-resolve-loader.mjs', import.meta.url));
const { compileUi, optionsFromRegistry } = await import('../../../packages/ui-plugin/src/index.ts');
const { createDemoRegistry } = await import('../src/app/ui-registry.ts');
const { bindComponents } = await import('../../../packages/runtime/src/core/ui/bind.ts');
const { layout } = await import('../../../packages/runtime/src/core/ui/layout.ts');

const registry = createDemoRegistry();
const VIEWPORTS = [
  { width: 390, height: 844, tag: '390x844' },
  { width: 320, height: 568, tag: '320x568' },
];

/** 每个界面：源文件 + 期望出现的组件（按首次出现顺序 = `.ui` 里的 put 顺序）。 */
const SCREENS = [
  // T13d：menu 用通用组件重写（panel / progress / 三态 button / label）
  {
    name: 'menu',
    file: 'games/ui-demo/ui/menu.ui',
    components: [
      'panel',
      'progress',
      'button',
      'primaryButton',
      'secondaryButton',
      'card0',
      'card1',
      'infoPanel',
      // T35：提示入口 / 网格背包入口
      'toast',
      'parcelGrid',
      'label',
      'statusText',
      // T38：嵌套滚动入口（overlay 右上角）
      'coinBadge',
    ],
  },
  { name: 'play', file: 'games/ui-demo/ui/play.ui', components: ['statusText', 'coinBadge', 'tapTarget', 'secondaryButton'] },
  { name: 'result', file: 'games/ui-demo/ui/result.ui', components: ['statusText', 'scorePanel', 'primaryButton'] },
  // T42：浮层只描述叠加层（遮罩 + 面板 + 按钮），base 里的假底层已删
  { name: 'popup', file: 'games/ui-demo/ui/popup.ui', components: ['panel', 'card0', 'primaryButton'] },
  // T13d：背包（list 虚拟列表 + scrollbar），同样走注册表校验
  {
    name: 'inventory',
    file: 'games/ui-demo/ui/inventory.ui',
    components: ['panel', 'badge', 'button', 'list', 'statusText', 'scrollbar'],
  },
  // T27：组件总览（21 个组件在 list 的行内独立 draw）；T42 工具行加「弹窗」入口
  {
    name: 'gallery',
    file: 'games/ui-demo/ui/gallery.ui',
    components: ['panel', 'badge', 'secondaryButton', 'button', 'list', 'label', 'scrollbar'],
  },
  // T32 + T42：两个半屏浮层（底部抽屉 45% / 中间半屏 58%），只有叠加层
  {
    name: 'sheet',
    file: 'games/ui-demo/ui/popup-sheet.ui',
    components: ['panel', 'infoPanel', 'label', 'primaryButton'],
  },
  {
    name: 'half',
    file: 'games/ui-demo/ui/popup-half.ui',
    components: ['panel', 'infoPanel', 'label', 'primaryButton'],
  },
  // T35：网格背包（grid 4 列 × 20 件）
  { name: 'bag', file: 'games/ui-demo/ui/grid-bag.ui', components: ['label', 'grid', 'button'] },
  // T35 + T42：任意位置提示浮层（at 中心点 + size，只有一个金色框 + 文字）
  { name: 'tip', file: 'games/ui-demo/ui/at-anywhere.ui', components: ['panel', 'label'] },
  // T38：嵌套滚动（外层 scroll + overlay 里 at 定位的内层 list）
  {
    name: 'nest',
    file: 'games/ui-demo/ui/scroll-nest.ui',
    components: ['label', 'button', 'scroll', 'list'],
  },
];

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : `（${detail}）`}`);
};

const inViewport = (rect, viewport) =>
  rect.x >= -0.5 && rect.y >= -0.5 && rect.x + rect.w <= viewport.width + 0.5 && rect.y + rect.h <= viewport.height + 0.5;

// ---------------------------------------------------------------------------
// 验收
// ---------------------------------------------------------------------------
const mcp = await connectMcp(repoRoot, 'verify-ui-demo', { timeoutMs: 15000 });
try {
  check('MCP initialize 成功', mcp.init.result?.serverInfo?.name === 'mg-debug-mcp', JSON.stringify(mcp.init.result?.serverInfo));
  const toolNames = (await mcp.listTools()).map((t) => t.name);
  check(
    'MCP 声明五个离线 UI 工具',
    ['ui.check', 'ui.layout', 'ui.preview', 'ui.grammar', 'ui.pattern'].every((n) => toolNames.includes(n)),
    toolNames.filter((n) => n.startsWith('ui.')).join(', '),
  );

  for (const screen of SCREENS) {
    const source = readFileSync(join(repoRoot, screen.file), 'utf8');
    const fileName = `${screen.name}.ui`;
    console.log(`\n===== ${screen.name}.ui =====`);

    // 1. MCP ui.check：语法 + 布局 + 结构断言（两视口）
    const rawCheck = await mcp.callTool('ui.check', { source, fileName, viewports: VIEWPORTS.map((v) => v.tag) });
    const checked = JSON.parse(rawCheck);
    check(`${screen.name}: ui.check 两视口全过`, checked.ok === true, checked.ok ? 'errors=[]' : checked.errors.join('; '));

    // 2. 注册表校验（构建期 knownComponents 语义）+ bind → layout
    const compiled = compileUi(source, screen.file, optionsFromRegistry(registry));
    check(`${screen.name}: 注册表校验通过`, compiled.errors.length === 0, compiled.errors.join('; ') || `${compiled.module?.components.join(' / ')}`);
    check(
      `${screen.name}: 组件清单与预期一致`,
      JSON.stringify(compiled.module?.components) === JSON.stringify(screen.components),
      compiled.module?.components.join(' / '),
    );

    for (const viewport of VIEWPORTS) {
      const bound = bindComponents(compiled.module.spec, {
        registry,
        env: { viewport: { width: viewport.width, height: viewport.height }, data: {} },
      });
      check(`${screen.name}@${viewport.tag}: 绑定无错（组件全部已注册）`, bound.errors.length === 0, bound.errors.join('; ') || '无');
      const solved = layout(bound.spec, viewport);
      check(`${screen.name}@${viewport.tag}: layout 无溢出`, solved.errors.length === 0, solved.errors.join('; ') || '无');

      const names = Object.keys(solved.rects);
      const missing = screen.components.filter((name) => solved.rects[name] === undefined);
      check(`${screen.name}@${viewport.tag}: 组件矩形齐全`, missing.length === 0, names.join(' / '));
      const bad = names.filter((name) => {
        const rect = solved.rects[name];
        return rect.w <= 0 || rect.h <= 0 || !inViewport(rect, viewport);
      });
      check(`${screen.name}@${viewport.tag}: 所有矩形 >0 且在视口内`, bad.length === 0, bad.length === 0 ? `${names.length} 个` : bad.join(', '));
      for (const name of names) {
        const rect = solved.rects[name];
        console.log(`  [${viewport.tag}] ${name.padEnd(16)} x=${rect.x} y=${rect.y} w=${rect.w} h=${rect.h}`);
      }
    }

    // 3. ASCII 预览（两视口）
    if (showAscii) {
      const preview = await mcp.callTool('ui.preview', { source, fileName, viewports: VIEWPORTS.map((v) => v.tag) });
      console.log(preview);
    }
  }
} catch (error) {
  check('验收过程中没有异常', false, error instanceof Error ? error.message : String(error));
} finally {
  mcp.close();
}

const failed = results.filter((r) => !r.pass);
console.log('');
console.log(`界面层验收：${results.length - failed.length} 通过 / ${failed.length} 失败`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  ✗ ${f.name}：${f.detail ?? ''}`);
  console.log('--- debug-mcp stderr ---');
  for (const line of mcp.stderrLines.slice(-20)) console.log(line);
  process.exitCode = 1;
}
