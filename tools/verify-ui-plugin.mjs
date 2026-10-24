#!/usr/bin/env node
/**
 * `.ui` 编译链 + 组件注册表的端到端验收（T5 v0.3 / T7）。
 *
 * 真跑：Vite build + `@mg/ui-plugin`（编译选项由**组件注册表**生成）编译
 * `games/kuaidi-load/ui/home.ui` → Node import 产物 → `bindComponents()` 注入
 * 组件的 `measure()` → `layout()` 算矩形。
 *
 * 验收标准：
 * - **T7 验收 1**：注册表接进构建期校验（组件名写错 / style 键写错都在构建期报错）
 * - **T7 验收 2**：`home.ui` + 注册表 + `layout()` 在 390 / 320 都算出真实矩形，
 *   `parcelGrid` 不再是 0 高（390 = 327.6×218.4、320 = 268.8×179.2）
 * - **390×844**：与 `computeLayout` 的六块逐值对比 **±1px**
 * - **320×568**：不要求 ±1px，只要求 ① errors 为空 ② 六块顺序正确
 *   ③ 任意两块不重叠 ④ 每块尺寸落在合理区间；maxdiff 只打印作参考
 * - 两视口都验证「.ui 产物 == 手写等价 spec」（编译器忠实性）
 *
 * 用法：node tools/verify-ui-plugin.mjs
 */

import { register } from 'node:module';
import { build } from 'vite';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 仓库用 tsc --noEmit（无 dist），所以这里和 `mg` 一样注册 TS resolve 钩子后动态加载源码
register(new URL('../packages/cli/bin/ts-resolve-loader.mjs', import.meta.url));
const { uiPlugin, optionsFromRegistry, compileUi } = await import('../packages/ui-plugin/src/index.ts');
const { layout } = await import('../packages/runtime/src/core/ui/layout.ts');
const { createBuiltinRegistry } = await import('../packages/runtime/src/core/ui/builtin.ts');
const { bindComponents } = await import('../packages/runtime/src/core/ui/bind.ts');
const { computeLayout } = await import('../games/kuaidi-load/src/app/layout.ts');
const { LEVELS } = await import('../games/kuaidi-load/src/app/levels.ts');

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'tools', '.ui-out');
const uiEntry = join(repoRoot, 'games', 'kuaidi-load', 'ui', 'home.ui');
const level = LEVELS[0];
const registry = createBuiltinRegistry();
/** 布局期环境：组件 measure 读视口与关卡数据（cols/rows）。 */
const envOf = (viewport) => ({ viewport, data: { cols: level.cols, rows: level.rows } });

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : `（${detail}）`}`);
};
const maxDiff = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
const fmt = (r) => `x=${r.x} y=${r.y} w=${r.w} h=${r.h}`;
const overlaps = (a, b) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
const ratio = (r) => ({ kind: 'ratio', r });

/** 手写等价 spec：与 home.ui 一一对应（验证编译器没有改变语义）。 */
const handWritten = {
  regions: [
    { name: 'head', edge: 'top', height: ratio(0.09) },
    { name: 'infoBand', edge: 'top', height: ratio(0.13), node: { stack: { direction: 'column', align: 'center', children: [{ name: 'infoPanel', size: { kind: 'fill' }, cross: ratio(0.9) }] } } },
    { name: 'gapTop', edge: 'top', height: ratio(0.03) },
    { name: 'gridBand', edge: 'fill', node: { stack: { direction: 'column', align: 'center', children: [{ name: 'parcelGrid', size: { kind: 'auto' }, cross: ratio(0.84) }] } } },
    { name: 'tail', edge: 'bottom', height: ratio(0.115) },
    {
      name: 'footerBand',
      edge: 'bottom',
      height: ratio(0.075),
      padding: { top: 0, right: ratio(0.05), bottom: 0, left: ratio(0.05) },
      node: { stack: { direction: 'row', gap: ratio(0.04), align: 'stretch', children: [{ name: 'primaryButton', size: ratio(0.4775) }, { name: 'secondaryButton', size: ratio(0.4775) }] } },
    },
    { name: 'gapFooter', edge: 'bottom', height: ratio(0.12) },
    {
      name: 'cardsBand',
      edge: 'bottom',
      height: ratio(0.08),
      padding: { top: 0, right: ratio(0.05), bottom: 0, left: ratio(0.05) },
      node: { stack: { direction: 'row', gap: ratio(0.02), align: 'stretch', children: [{ name: 'card0', size: ratio(0.4775) }, { name: 'card1', size: ratio(0.4775) }] } },
    },
  ],
};

const NAMES = ['infoPanel', 'parcelGrid', 'card0', 'card1', 'primaryButton', 'secondaryButton'];

const oldRectOf = (old, name) => {
  if (name === 'infoPanel') return old.info;
  if (name === 'parcelGrid') return old.grid;
  if (name === 'card0') return old.cards[0];
  if (name === 'card1') return old.cards[1];
  return name === 'primaryButton' ? old.primary : old.secondary;
};

try {
  // ------------------------------------------------- 1. 注册表接进构建期校验
  const badName = compileUi('region body fill\nput prymaryButton size auto\n', 'bad.ui', optionsFromRegistry(registry));
  check(
    '注册表接入 knownComponents：组件名写错，构建期报错并列出可用名字',
    badName.errors.length === 1 && badName.errors[0].includes("未知组件 'prymaryButton'") && badName.errors[0].includes('primaryButton'),
    badName.errors[0],
  );
  const badStyle = compileUi('region body fill\nput primaryButton style tonee=primary\n', 'bad.ui', optionsFromRegistry(registry));
  check(
    '注册表接入 componentProps：style 键写错，构建期报错并列出可用参数',
    badStyle.errors.length === 1 && badStyle.errors[0].includes("style 键 'tonee'") && badStyle.errors[0].includes('label / tone / disabled'),
    badStyle.errors[0],
  );

  // ------------------------------------------------- 2. 真编译
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  await build({
    root: repoRoot,
    logLevel: 'error',
    plugins: [uiPlugin(optionsFromRegistry(registry))],
    build: { outDir, emptyOutDir: false, minify: false, lib: { entry: uiEntry, formats: ['es'], fileName: () => 'home.js' } },
  });
  const home = (await import(pathToFileURL(join(outDir, 'home.js')).href)).default;
  check('Vite build 编译 .ui 产出数据模块', typeof home === 'object' && home !== null, Object.keys(home).join(', '));
  check('.ui 产物 name / source 正确', home.name === 'home' && home.source === 'games/kuaidi-load/ui/home.ui', `${home.name} ← ${home.source}`);
  check('.ui 产物 components 与 lines 完整', home.components.length === 6 && Object.keys(home.lines).length === 6, home.components.join(' / '));

  // ------------------------------------------------- 3. 注册表绑定 + 两视口求解
  const VIEWPORTS = [{ width: 390, height: 844 }, { width: 320, height: 568 }];
  const computed = {};
  for (const viewport of VIEWPORTS) {
    const tag = `${viewport.width}×${viewport.height}`;
    const bound = bindComponents(home.spec, { registry, env: envOf(viewport) });
    check(`注册表绑定 ${tag}：errors 为空（6 个组件全部已注册）`, bound.errors.length === 0, bound.errors.join('; ') || '无');
    computed[`${viewport.width}x${viewport.height}`] = layout(bound.spec, viewport);
  }

  // ------------------------------------------------- 4. parcelGrid 真实 measure
  const grid390 = computed['390x844'].rects['parcelGrid'];
  const grid320 = computed['320x568'].rects['parcelGrid'];
  check(
    'parcelGrid 390×844 实测 = 327.6×218.4（组件 measure 生效，不再是 0 高）',
    Math.abs(grid390.w - 327.6) <= 0.01 && Math.abs(grid390.h - 218.4) <= 0.01,
    fmt(grid390),
  );
  check(
    'parcelGrid 320×568 实测 = 268.8×179.2',
    Math.abs(grid320.w - 268.8) <= 0.01 && Math.abs(grid320.h - 179.2) <= 0.01,
    fmt(grid320),
  );

  // ------------------------------------------------- 5. 编译器忠实性（两视口）
  for (const viewport of VIEWPORTS) {
    const tag = `${viewport.width}×${viewport.height}`;
    const fromUi = computed[`${viewport.width}x${viewport.height}`];
    const handBound = bindComponents(handWritten, { registry, env: envOf(viewport) });
    const fromHand = layout(handBound.spec, viewport);
    let worst = 0;
    for (const name of NAMES) {
      const a = fromUi.rects[name];
      const b = fromHand.rects[name];
      if (a === undefined || b === undefined) {
        check(`编译器忠实性 ${tag}：${name} 存在`, false, '矩形缺失');
        continue;
      }
      worst = Math.max(worst, maxDiff(a, b));
    }
    check(`编译器忠实性 ${tag}（.ui 产物 == 手写 spec）`, worst <= 1, `maxdiff=${worst.toFixed(6)}`);
  }

  // ------------------------------------------------- 6. 390×844：±1px 逐值对照
  const design = { width: 390, height: 844 };
  const old390 = computeLayout({ ...design, dpr: 2, insets: { top: 0, right: 0, bottom: 0, left: 0 }, orientation: 'portrait' }, level);
  const ui390 = computed['390x844'];
  let worst390 = 0;
  for (const name of NAMES) {
    const rect = ui390.rects[name];
    const expected = oldRectOf(old390, name);
    const diff = maxDiff(rect, expected);
    worst390 = Math.max(worst390, diff);
    console.log(`  390×844 ${name.padEnd(16)} new ${fmt(rect)} | old ${fmt(expected)} | maxdiff=${diff.toFixed(2)}`);
  }
  check('390×844 六块对照 ±1px', worst390 <= 1, `maxdiff=${worst390.toFixed(2)}px`);
  check('390×844 求解无 errors', ui390.errors.length === 0, ui390.errors.join('; ') || '无');

  // ------------------------------------------------- 7. 320×568：结构检查（不要求 ±1px）
  const small = computed['320x568'];
  const W = 320;
  const H = 568;
  check('320×568 ① errors 为空', small.errors.length === 0, small.errors.join('; ') || '无');

  const order = ['infoPanel', 'parcelGrid', 'card0', 'primaryButton'];
  const tops = order.map((name) => small.rects[name]?.y ?? Number.NaN);
  const ordered = tops.every((y, i) => i === 0 || y > (tops[i - 1] ?? Number.NaN));
  check('320×568 ② 六块顺序正确（info → grid → cards → buttons）', ordered, tops.map((y, i) => `${order[i]}@${y}`).join(' < '));

  const pairs = [];
  for (let i = 0; i < NAMES.length; i += 1) {
    for (let j = i + 1; j < NAMES.length; j += 1) {
      const a = small.rects[NAMES[i]];
      const b = small.rects[NAMES[j]];
      if (overlaps(a, b)) pairs.push(`${NAMES[i]}×${NAMES[j]}`);
    }
  }
  check('320×568 ③ 任意两块不重叠', pairs.length === 0, pairs.length === 0 ? '15 对全部不重叠' : pairs.join(', '));

  const sizeOk =
    grid320.h >= 100 && grid320.h <= 250 &&
    NAMES.every((name) => {
      const r = small.rects[name];
      return r.w > 1 && r.h > 1 && r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= W + 0.5 && r.y + r.h <= H + 0.5;
    });
  check('320×568 ④ 尺寸合理（grid 高 100–250，其余尺寸 >0 且在视口内）', sizeOk, `grid=${fmt(grid320)}`);

  const old320 = computeLayout({ width: W, height: H, dpr: 2, insets: { top: 0, right: 0, bottom: 0, left: 0 }, orientation: 'portrait' }, level);
  let worst320 = 0;
  for (const name of NAMES) {
    const rect = small.rects[name];
    const expected = oldRectOf(old320, name);
    const diff = maxDiff(rect, expected);
    worst320 = Math.max(worst320, diff);
    console.log(`  320×568 ${name.padEnd(16)} new ${fmt(rect)} | old ${fmt(expected)} | maxdiff=${diff.toFixed(2)}（仅参考，不作判据）`);
  }
  console.log(`  → 320×568 maxdiff=${worst320.toFixed(2)}px（新标准下不作 PASS 判据）`);
} catch (error) {
  check('验收过程中没有异常', false, error instanceof Error ? error.message : String(error));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log('');
console.log(`端到端验收：${results.length - failed.length} 通过 / ${failed.length} 失败`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  ✗ ${f.name}：${f.detail ?? ''}`);
  process.exitCode = 1;
}
