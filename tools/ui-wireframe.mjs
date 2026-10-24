/**
 * `.ui` → 线框底图（T41）：给「图生图」当结构条件的精确色块图。
 *
 * 为什么需要它：整屏让模型出图不守比例（顶部 26% 会画成 7%）。流程改成
 * **比例由程序给、风格由模型给** —— 这个工具产出结构底图，模型只负责质感。
 *
 * 三条硬规矩（改之前先读）：
 * 1. **坐标只有一个真源**：`compileUi()`（构建期同一份编译，含注册表校验）→
 *    `layout()`（runtime 的布局引擎）。本文件不重算任何百分比，只负责上色；
 *    连网格的 `cellW` 都复用 `grid.ts` 的 `cellWidth()`。
 * 2. **对拍是硬要求**：每次出图顺手调 `ui.check`（debug-mcp 的同一实现）拿 JSON，
 *    把它的 `rects` 与画图用的 `rects` 逐项比对（x/y/w/h 必须完全相等）。
 * 3. **渲染交给浏览器 canvas**：node 里没有字体，手写点阵字在 390px 图上会糊。
 *    复用仓库自带的零依赖 CDP harness（templates/iaa-simple/tools/lib），不引入
 *    任何 npm 依赖；没有 Chrome 的机器会在启动时明确报错。
 *
 * 用法（输出 artifacts/wireframe/<名>.png + <名>.json）：
 *   node tools/ui-wireframe.mjs games/ui-demo/ui/menu.ui [--viewport 320x568] [--out 目录]
 *   node tools/ui-wireframe.mjs --all                    # menu / grid-bag / popup-sheet
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createServer } from 'vite';
import {
  cleanupProfiles, connectToPage, purgeStaleProfiles, startChrome,
} from '../templates/iaa-simple/tools/lib/harness.mjs';
const REPO = resolve(import.meta.dirname, '..');
const UI_DIR = join(REPO, 'games', 'ui-demo', 'ui');
const DEFAULT_OUT = join(REPO, 'artifacts', 'wireframe');
/** `--all` 的三张：菜单（分带）/ 网格背包（格子）/ 半屏弹窗（浮层） */
const PRESET = ['menu.ui', 'grid-bag.ui', 'popup-sheet.ui'];
/** region 底色板（固定：同一份 .ui 永远同色，图生图的结构条件才稳定） */
const REGION_COLORS = ['#4e79a7', '#f28e2b', '#59a14f', '#b07aa1', '#76b7b2', '#edc948', '#ff9da7', '#9c755f'];
const ITEM_COLOR = '#1f3a5f'; // 组件框统一色（底图要干净，靠形状区分）
const ZERO_COLOR = '#c0392b'; // 布局给了 0 宽/0 高的组件：标出来，而不是「图上少了东西」
/** 只对 menu.ui 校验「带高 = 百分比 × 视口高」；别的 .ui 各有各的比例，硬套只会制造假红。 */
const EXPECTED_RATIOS = { 'menu.ui': [['header', 0.26], ['footer', 0.38]] };
let cellWidth = () => 0; // 由 main 从 grid.ts 注入（与绘制同一份实现）
/**
 * 页面里跑的绘制函数（会被 `toString()` 内联进 Chrome 执行）。
 * 不许引用外部变量：颜色、尺寸、数据全部走 `p`。返回 PNG dataURL。
 */
const drawWireframe = (p) => {
  const c = document.createElement('canvas');
  c.width = p.width;
  c.height = p.height;
  const ctx = c.getContext('2d');
  const font = 'ui-sans-serif, "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = '#ffffff'; // 纯白底，不画任何装饰（纹理是模型该生成的东西）
  ctx.fillRect(0, 0, p.width, p.height);

  // 1) region：base 半透明填充（一眼看出分带比例）；overlay 只留标签，不画整屏框
  p.regions.forEach((r, i) => {
    const color = p.colors[i % p.colors.length];
    const { x, y, w, h } = r.rect;
    if (!(w > 0 && h > 0)) return;
    const overlay = r.layer === 'overlay';
    const fullScreen = Math.abs(w - p.width) < 1 && Math.abs(h - p.height) < 1;
    if (!overlay) {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = color;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.globalAlpha = 1;
    } else if (!fullScreen) {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.restore();
    }
    // 标签：base 放右上角（带实测尺寸）；overlay 放左上下移堆叠（整屏框重合，只能靠标签区分）
    const label = overlay ? `overlay:${r.name}` : `${r.name} ${Math.round(w)}×${Math.round(h)}`;
    ctx.font = `600 ${overlay ? 10 : 11}px ${font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(label).width;
    const lx = overlay ? 3 : x + w - tw - 9;
    const ly = overlay ? 28 + r.slot * 16 : y + 4;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(lx, ly, tw + 7, 14);
    ctx.fillStyle = color;
    ctx.fillText(label, lx + 3.5, ly + 3);
  });

  // 2) 组件矩形：描边 + 半透明填充（矩形就是 layout 给的 x/y/w/h，不做任何修正）
  p.items.forEach((it) => {
    const { x, y, w, h } = it.rect;
    ctx.font = `600 11px ${font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (!(w > 0) || !(h > 0)) {
      // 布局给了 0 宽/高：画红条 + 标签，明确是「布局问题」而不是「工具漏画」
      ctx.fillStyle = p.zeroColor;
      ctx.fillRect(x - 1, y, 2, Math.max(h, 20));
      const note = `${it.name} ${w <= 0 ? 'w=0' : 'h=0'}`;
      ctx.fillRect(x + 3, y, ctx.measureText(note).width + 8, 15);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(note, x + 7, y + 2.5);
      return;
    }
    ctx.globalAlpha = 0.11;
    ctx.fillStyle = p.itemColor;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = p.itemColor;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
    // 3) 网格类组件：画出内部格子（参数来自 .ui 的 style，cellW 由 grid.ts 算好传进来）
    if (it.cells !== undefined) {
      ctx.strokeStyle = 'rgba(31,58,95,0.45)';
      for (const cell of it.cells) ctx.strokeRect(cell.x + 0.5, cell.y + 0.5, cell.w - 1, cell.h - 1);
    }
    // 4) 组件名标签：左上角，白字 + 深底（比描边字更稳，缩图后仍可读）
    const tw = Math.min(ctx.measureText(it.name).width, Math.max(12, w - 8));
    ctx.fillStyle = 'rgba(31,42,56,0.9)';
    ctx.fillRect(x + 3, y + 3, tw + 8, 15);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(it.name, x + 7, y + 5.5, Math.max(6, w - 12));
  });

  // 5) 顶部角标：文件名 + 视口（结构底图必须自带出处）
  ctx.font = `700 12px ${font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const titleW = ctx.measureText(p.title).width;
  ctx.fillStyle = 'rgba(17,24,32,0.92)';
  ctx.fillRect(0, 0, titleW + 16, 24);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(p.title, 8, 12.5);
  return c.toDataURL('image/png');
};

/** 从 spec 树里收「组件名 → style props」（不 bind，只读结构；props 就是 .ui 写的值）。 */
const collectProps = (spec) => {
  const out = {};
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (node.name !== undefined) out[node.name] = node.props ?? {};
    if (node.stack !== undefined) for (const child of node.stack.children) walk(child);
  };
  for (const region of spec.regions) walk(region.node);
  return out;
};

/** 网格类组件（style 里有 cols）的内部格子：cellW 用 grid.ts 的 cellWidth，不另推公式。 */
const cellsOf = (rect, props) => {
  const cols = props?.cols;
  if (typeof cols !== 'number' || cols < 2 || !(rect.w > 0 && rect.h > 0)) return undefined;
  const cellH = typeof props.cellH === 'number' ? props.cellH : 56;
  const gapX = typeof props.gapX === 'number' ? props.gapX : 0;
  const gapY = typeof props.gapY === 'number' ? props.gapY : 0;
  const cellW = cellWidth(rect.w, cols, gapX);
  const cells = [];
  for (let row = 0; row < 12 && row * (cellH + gapY) + cellH <= rect.h + 1; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({ x: rect.x + col * (cellW + gapX), y: rect.y + row * (cellH + gapY), w: cellW, h: cellH });
    }
  }
  return cells;
};

/** 画图输入 = 同一份 layout 数据（region 带层与层内序号，标签要错开）。 */
const buildPayload = (module, result, viewport, fileName) => {
  const slots = { base: 0, overlay: 0 };
  const props = collectProps(module.spec);
  const regions = [];
  for (const spec of module.spec.regions) {
    const rect = result.regions[spec.name];
    if (rect === undefined) continue;
    const layer = spec.layer ?? 'base';
    regions.push({ name: spec.name, layer, slot: slots[layer]++, rect });
  }
  const items = result.paintOrder
    .filter((name) => result.rects[name] !== undefined)
    .map((name) => ({ name, layer: result.meta[name]?.layer ?? 'base', rect: result.rects[name], cells: cellsOf(result.rects[name], props[name]) }));
  return {
    width: viewport.width, height: viewport.height,
    title: `${fileName} · ${viewport.width}×${viewport.height}`,
    colors: REGION_COLORS, itemColor: ITEM_COLOR, zeroColor: ZERO_COLOR, regions, items,
  };
};

/** 带高是否等于「百分比 × 视口高」（26% / 38% 这两条是最要紧的验收）。 */
const ratioCheck = (result, name, ratio, viewportHeight) => {
  const expected = Math.round(viewportHeight * ratio * 100) / 100;
  const actual = result.regions[name] === undefined ? null : Math.round(result.regions[name].h * 100) / 100;
  return { name, ratio, expected, actual, ok: actual !== null && Math.abs(actual - expected) < 0.01 };
};

/** 逐项对拍：ui.check 的 rects vs 画图用的 rects（x/y/w/h 完全相等）。 */
const diffRects = (drawn, checked) => {
  const rows = Object.entries(checked).map(([name, rect]) => {
    const own = drawn[name];
    const ok = own !== undefined && own.x === rect.x && own.y === rect.y && own.w === rect.w && own.h === rect.h;
    return { name, ok, rect };
  });
  const matched = rows.filter((r) => r.ok).length;
  return { rows, matched, total: rows.length, allOk: rows.length > 0 && matched === rows.length };
};
const main = async () => {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
  };
  const outDir = resolve(flag('out', DEFAULT_OUT));
  const vpText = flag('viewport', '390x844');
  const vpMatch = /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/.exec(vpText.trim());
  if (vpMatch === null) throw new Error(`--viewport 需要「宽x高」写法（如 390x844），收到 '${vpText}'`);
  const viewport = { width: Number(vpMatch[1]), height: Number(vpMatch[2]) };
  const files = argv.includes('--all')
    ? PRESET.map((name) => join(UI_DIR, name))
    : argv.filter((a) => a.endsWith('.ui')).map((a) => resolve(a));
  if (files.length === 0) {
    console.error('用法：node tools/ui-wireframe.mjs <a.ui> [<b.ui> …] [--viewport 390x844] [--out 目录]；或 --all');
    process.exit(1);
  }

  await mkdir(outDir, { recursive: true });
  // 一次 vite server：.ts/.ui 的加载走游戏自己那份配置链（不重写解析器）
  const server = await createServer({
    // watch: null —— 只读一次就退出，开着 watcher 会去盯整个仓库并刷告警
    configFile: false, root: REPO, logLevel: 'error', appType: 'custom',
    server: { middlewareMode: true, watch: null },
  });
  purgeStaleProfiles();
  const chrome = await startChrome({ width: 420, height: 900 });
  const cdp = await connectToPage(chrome.port);
  let done = 0;
  let exitCode = 0;

  try {
    const { compileUi, optionsFromRegistry } = await server.ssrLoadModule('/packages/ui-plugin/src/index.ts');
    const { layout } = await server.ssrLoadModule('/packages/runtime/src/core/ui/layout.ts');
    const { createDemoRegistry } = await server.ssrLoadModule('/games/ui-demo/src/app/ui-registry.ts');
    const { createUiTools } = await server.ssrLoadModule('/packages/debug-mcp/src/ui-tools.ts');
    cellWidth = (await server.ssrLoadModule('/packages/runtime/src/core/ui/widgets/grid.ts')).cellWidth;
    const compileOptions = optionsFromRegistry(createDemoRegistry());

    for (const file of files) {
      const fileName = basename(file);
      const source = await readFile(file, 'utf8');
      const compiled = compileUi(source, fileName, compileOptions);
      if (compiled.errors.length > 0 || compiled.module === null) {
        console.error(`✗ ${fileName} 编译失败：\n${compiled.errors.join('\n')}`);
        exitCode = 1;
        continue;
      }
      const result = layout(compiled.module.spec, viewport);
      const payload = buildPayload(compiled.module, result, viewport, fileName);
      // —— 对拍：ui.check 是另一条调用路径（自己 parse 一遍再 layout）——
      const checked = await createUiTools().call('ui.check', {
        source, viewport: `${viewport.width}x${viewport.height}`, fileName,
      });
      const checkJson = JSON.parse(checked.text);
      const diff = diffRects(result.rects, checkJson.rects ?? {});
      const ratios = (EXPECTED_RATIOS[fileName] ?? []).map(([n, r]) => ratioCheck(result, n, r, viewport.height));
      const zero = payload.items.filter((it) => !(it.rect.w > 0 && it.rect.h > 0)).map((it) => it.name);

      const dataUrl = await cdp.eval(`(${drawWireframe.toString()})(${JSON.stringify(payload)})`);
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
        throw new Error(`${fileName} 渲染没有返回 PNG dataURL`);
      }
      const png = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
      const pngPath = join(outDir, fileName.replace(/\.ui$/, '.png'));
      await writeFile(pngPath, png);
      // 报告落盘：rects / regions / 对拍逐项 / 比例检查（AI 与人共用一份）
      const jsonPath = join(outDir, fileName.replace(/\.ui$/, '.json'));
      const report = { file: fileName, viewport, png: pngPath, regions: payload.regions, rects: result.rects, paintOrder: result.paintOrder, checkErrors: checkJson.errors ?? [], compare: diff, ratioChecks: ratios, zeroSize: zero };
      await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

      console.log(`\n== ${fileName} @ ${viewport.width}×${viewport.height} ==`);
      for (const r of ratios) console.log(`${r.ok ? 'PASS' : 'FAIL'} region ${r.name} 高 ${r.actual}（${r.ratio * 100}% × ${viewport.height} = ${r.expected}）`);
      console.log(`${diff.allOk ? 'PASS' : 'FAIL'} 与 ui.check 对拍：${diff.matched}/${diff.total} 个组件 x/y/w/h 完全相等`);
      for (const row of diff.rows) console.log(`  ${row.ok ? '·' : '✗'} ${row.name.padEnd(16)} x=${row.rect.x} y=${row.rect.y} w=${row.rect.w} h=${row.rect.h}`);
      if (zero.length > 0) console.log(`⚠ 布局给了 0 尺寸的组件（图上已用红条标出）：${zero.join(' / ')}`);
      console.log(`PNG → ${pngPath}（${png.length} 字节）`);
      if (!diff.allOk || ratios.some((r) => !r.ok)) exitCode = 1;
      done += 1;
    }
  } catch (error) {
    console.error(`✗ 出图失败：${error instanceof Error ? error.message : String(error)}`);
    exitCode = 1;
  } finally {
    // 谁起谁停：CDP / Chrome / vite server 全部由本脚本收掉
    cdp.close();
    await chrome.kill();
    await cleanupProfiles();
    await server.close();
  }
  console.log(`\n出图 ${done}/${files.length}`);
  process.exit(exitCode);
};

void main();
