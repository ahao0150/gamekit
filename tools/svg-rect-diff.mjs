#!/usr/bin/env node
/**
 * SVG ↔ `.ui` 矩形对拍（「SVG 先行」这条路能不能成立的那把尺子）。
 *
 * 用途：以后写界面先出 SVG 设计稿，再按稿还原 `.ui`。这份工具回答唯一的问题——
 * **SVG 里画的位置与 `.ui` 算出来的位置，逐项差多少**。
 *
 * 三条硬规矩（改之前先读）：
 * 1. **SVG 的矩形必须浏览器实测**：`getBoundingClientRect()`（已含全部 transform 与
 *    viewBox 缩放）按实测比例换回 viewBox 用户坐标。**不自己解析 path / rect 属性手算**，
 *    那等于用同一份理解去验证理解本身。
 * 2. **`.ui` 侧坐标只有一个真源**：`compileUi()`（与 `mg build` 同一份编译，含注册表校验）
 *    → `bindComponents()` → `layout()`。本文件不重算任何百分比、不读 `.ui` 里的数字。
 * 3. **配对只认名字**：`.ui` 的 `put` 名 = SVG 的 `data-name`，一对一。不做前缀 / 模糊 /
 *    最近邻匹配 —— 名字对不上就是描述写错了（`ui-syntax.md` §布局契约：rects 以组件名为键，
 *    重名会互相覆盖且 `ui.check` 保持报错），糊过去等于把尺子做弯。
 *
 * 退出码（CI 用）：
 *   0 全过（每项 dx/dy/dw/dh 的绝对值都 ≤ --tol）
 *   1 有超差
 *   2 有名字对不上（SVG 有 / `.ui` 没有，或反过来）——比超差更根本，优先报
 *   3 工具自身异常（参数、编译、浏览器、注册表…）
 *
 * 用法：
 *   node tools/svg-rect-diff.mjs --svg a.svg --ui a.ui [--viewport 390x844] [--tol 2] [--out report.json]
 *   node tools/svg-rect-diff.mjs --svg a.svg --ui a.ui --registry games/platformer/src/app/ui-registry.ts
 *
 * 只读：不改 `.ui`、不改 SVG。Chrome profile 走 harness 的清理逻辑，不留残留。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import {
  cleanupProfiles, connectToPage, purgeStaleProfiles, startChrome,
} from '../templates/iaa-simple/tools/lib/harness.mjs';

const REPO = resolve(import.meta.dirname, '..');
const EXIT_OK = 0;
const EXIT_DRIFT = 1;
const EXIT_MISSING = 2;
const EXIT_ERROR = 3;
const DEFAULT_REGISTRY = '/games/ui-demo/src/app/ui-registry.ts';
const CANVAS_W = 390;
const CANVAS_H = 844;

/** 四位小数（任务书要求）：不四舍五入到整数，否则 1.4px 的差会被 tol=2 吞掉看不出来。 */
const round4 = (value) => Math.round(value * 10000) / 10000;
const fixed4 = (value) => round4(value).toFixed(4);
const signed4 = (value) => `${value >= 0 ? '+' : ''}${fixed4(value)}`;

/** 参数解析：只认 `--key value`，未知参数直接报错（打错一个字母静默走默认值最难查）。 */
const parseArgs = (argv) => {
  const known = new Set(['svg', 'ui', 'viewport', 'tol', 'out', 'registry', 'strict']);
  /** 布尔开关：只写 `--strict`，不跟值。 */
  const booleanFlags = new Set(['strict']);
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`不认识的参数 '${token}'（参数都是 --key value 形式）`);
    const key = token.slice(2);
    if (!known.has(key)) throw new Error(`不认识的参数 '--${key}'，可用：${[...known].map((k) => `--${k}`).join(' / ')}`);
    if (booleanFlags.has(key)) {
      out[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} 后面缺值`);
    out[key] = value;
    i += 1;
  }
  return out;
};

const parseViewport = (text) => {
  const match = /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/.exec(text.trim());
  if (match === null) throw new Error(`--viewport 要「宽x高」（如 390x844），收到 '${text}'`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0 && height > 0)) throw new Error(`--viewport 宽高必须为正，收到 '${text}'`);
  return { width, height };
};

const parseTol = (text) => {
  if (text === undefined) return 2;
  const tol = Number(text);
  if (!Number.isFinite(tol) || tol < 0) throw new Error(`--tol 必须是 ≥ 0 的数字，收到 '${text}'`);
  return tol;
};

/**
 * 页面内测量函数（会被 `toString()` 内联进 Chrome，不能引用外部变量）。
 *
 * 为什么先强制 1:1：SVG 文件常只写 viewBox、不写 width/height，浏览器会按容器铺满，
 * 不同窗口尺寸下缩放不同。把渲染尺寸钉成 viewBox 尺寸后缩放恒为 1；但**仍然用实测
 * getBoundingClientRect 再除一次** —— 万一被页面 CSS 改过，除法会把它算回来。
 *
 * 用 getBoundingClientRect 而不是 getBBox：前者含父级 transform（设计稿里分组变换很常见），
 * 后者是元素自身坐标系的原始盒，用在带 transform 的 SVG 上会整体错位。
 */
const measureSvgInPage = (width, height) => {
  // 这个函数体是「页面内代码」：不能引用模块作用域的任何东西，所以取整在这里再定义一次
  const r4 = (value) => Math.round(value * 10000) / 10000;
  const svg = document.querySelector('svg');
  if (svg === null) return { error: '页面里没有 <svg> 根元素' };
  const vb = svg.viewBox.baseVal;
  if (vb === null || !(vb.width > 0) || !(vb.height > 0)) {
    return { error: '<svg> 缺 viewBox（或 viewBox 宽高为 0），无法把测量换算成设计稿坐标' };
  }
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;

  const root = svg.getBoundingClientRect();
  const sx = root.width > 0 ? vb.width / root.width : 1;
  const sy = root.height > 0 ? vb.height / root.height : 1;
  const rects = [];
  const seen = [];
  for (const el of svg.querySelectorAll('[data-name]')) {
    const name = el.getAttribute('data-name');
    if (name === null || name === '') continue;
    const r = el.getBoundingClientRect();
    const parent = el.parentElement;
    const rect = {
      name,
      x: r4((r.left - root.left) * sx + vb.x),
      y: r4((r.top - root.top) * sy + vb.y),
      w: r4(r.width * sx),
      h: r4(r.height * sy),
      // 有祖先也带 data-name = 复合组件的内部件（`.ui` 扁平，它不该出现在 put 里）
      nested: parent !== null && parent.closest('[data-name]') !== null,
    };
    if (seen.some((s) => s.name === name)) {
      // 重名：SVG 那边没有「后者覆盖前者」的语义，只能报出来（否则对拍结果取决于文档顺序）
      seen.push({ ...rect, duplicate: true });
      continue;
    }
    seen.push(rect);
    rects.push(rect);
  }
  return {
    viewBox: { x: vb.x, y: vb.y, w: vb.width, h: vb.height },
    rects,
    duplicates: seen.filter((s) => s.duplicate === true).map((s) => s.name),
  };
};

/** 注册表工厂：默认 ui-demo 的 demo 注册表（覆盖 31 个内置组件），可用 --registry 换。 */
const pickRegistryFactory = (module, modulePath) => {
  if (typeof module.createDemoRegistry === 'function') return module.createDemoRegistry;
  if (typeof module.createRegistry === 'function') return module.createRegistry;
  const candidates = Object.keys(module).filter((key) => key.startsWith('create') && typeof module[key] === 'function');
  if (candidates.length === 1) return module[candidates[0]];
  throw new Error(
    `${modulePath} 里找不到唯一的注册表工厂（期望 createDemoRegistry / createRegistry，`
    + `实际导出函数：${candidates.join(' / ') || '无'}）`,
  );
};

const formatRect = (rect) => `${fixed4(rect.x)},${fixed4(rect.y)},${fixed4(rect.w)},${fixed4(rect.h)}`;

/** 表格：名字列左对齐、四组数字定点对齐（差 10.0000 和 10.4 一眼要能分开）。 */
const printTable = (rows) => {
  const head = ['name', 'svg x,y,w,h', 'ui x,y,w,h', 'dx', 'dy', 'dw', 'dh', '判定'];
  const cells = rows.map((row) => [
    row.name.padEnd(18),
    formatRect(row.svg).padEnd(34),
    formatRect(row.ui).padEnd(34),
    signed4(row.dx).padStart(10),
    signed4(row.dy).padStart(10),
    signed4(row.dw).padStart(10),
    signed4(row.dh).padStart(10),
    row.ok ? '  ok' : '  超差',
  ]);
  const header = [head[0].padEnd(18), head[1].padEnd(34), head[2].padEnd(34),
    head[3].padStart(10), head[4].padStart(10), head[5].padStart(10), head[6].padStart(10), head[7]];
  console.log(header.join('  '));
  console.log('-'.repeat(header.join('  ').length));
  for (const line of cells) console.log(line.join('  '));
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.svg === undefined || args.ui === undefined) {
    throw new Error('用法：node tools/svg-rect-diff.mjs --svg <a.svg> --ui <a.ui> [--viewport 390x844] [--tol 2] [--out report.json] [--registry 相对仓库根的 .ts]');
  }
  const svgPath = resolve(args.svg);
  const uiPath = resolve(args.ui);
  const viewport = parseViewport(args.viewport ?? `${CANVAS_W}x${CANVAS_H}`);
  const tol = parseTol(args.tol);
  if (viewport.width !== CANVAS_W || viewport.height !== CANVAS_H) {
    console.warn(`⚠ 视口 ${viewport.width}×${viewport.height} 与设计画布 ${CANVAS_W}×${CANVAS_H} 不同；`
      + 'SVG 的 viewBox 必须与之同宽高，否则这次对拍没有意义。');
  }

  const uiSource = await readFile(uiPath, 'utf8');
  const uiFileName = basename(uiPath);
  // vite 只用来加载 .ts/.ui 这条链（compile / layout / 注册表），SVG 走 file://
  const server = await createServer({
    configFile: false, root: REPO, logLevel: 'error', appType: 'custom',
    server: { middlewareMode: true, watch: null },
  });
  purgeStaleProfiles();
  const chrome = await startChrome({ width: viewport.width + 40, height: viewport.height + 40 });
  const cdp = await connectToPage(chrome.port);
  let exitCode = EXIT_OK;

  try {
    // —— `.ui` 侧：同一份编译 + 注册表校验 + layout ——
    const { compileUi, optionsFromRegistry } = await server.ssrLoadModule('/packages/ui-plugin/src/index.ts');
    const { bindComponents } = await server.ssrLoadModule('/packages/runtime/src/core/ui/bind.ts');
    const { layout } = await server.ssrLoadModule('/packages/runtime/src/core/ui/layout.ts');
    const registryPath = args.registry === undefined
      ? DEFAULT_REGISTRY
      : `/${args.registry.replace(/^[\\/]+/, '').replace(/\\/g, '/')}`;
    const registryModule = await server.ssrLoadModule(registryPath);
    const createRegistry = pickRegistryFactory(registryModule, registryPath);
    const registry = createRegistry();

    const compiled = compileUi(uiSource, uiFileName, optionsFromRegistry(registry));
    if (compiled.module === null) {
      console.error(`✗ ${uiFileName} 编译失败：\n${compiled.errors.join('\n')}`);
      return EXIT_ERROR;
    }
    if (compiled.errors.length > 0) {
      // 注册表校验失败（未知组件 / 非法 style 键）：这里必须硬停，否则 layout 出来的
      // 矩形是「少了几个组件」的残局，对拍表格会假装只有几项、全部通过
      console.error(`✗ ${uiFileName} 编译有错（注册表校验不通过）：\n${compiled.errors.join('\n')}`);
      return EXIT_ERROR;
    }
    const bound = bindComponents(compiled.module.spec, {
      registry,
      env: { viewport: { width: viewport.width, height: viewport.height }, data: {} },
    });
    if (bound.errors.length > 0) {
      console.error(`✗ ${uiFileName} 绑定失败（组件未注册或 measure 抛错）：\n${bound.errors.join('\n')}`);
      return EXIT_ERROR;
    }
    const solved = layout(bound.spec, viewport);
    if (solved.errors.length > 0) {
      // 溢出 / 0 尺寸不阻断对拍，但必须说出来：这些是 `.ui` 自身的问题，不是 SVG 的
      console.warn(`⚠ ${uiFileName} layout 有 ${solved.errors.length} 条错误（不阻断对拍）：`);
      for (const message of solved.errors) console.warn(`  · ${message}`);
    }

    // —— SVG 侧：浏览器实测 ——
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: pathToFileURL(svgPath).href });
    await cdp.waitFor('document.readyState === "complete"', { label: `${basename(svgPath)} 加载` });
    const measured = await cdp.eval(`(${measureSvgInPage.toString()})(${viewport.width}, ${viewport.height})`);
    if (measured.error !== undefined) throw new Error(`测 SVG 失败：${measured.error}`);

    const vb = measured.viewBox;
    if (vb.w !== viewport.width || vb.h !== viewport.height) {
      throw new Error(
        `SVG viewBox 是 '${vb.x} ${vb.y} ${vb.w} ${vb.h}'，与 --viewport ${viewport.width}×${viewport.height} `
        + '宽高不一致。设计稿画布必须与视口同尺寸，否则两个坐标系没有可比性。',
      );
    }
    if (vb.x !== 0 || vb.y !== 0) {
      console.warn(`⚠ viewBox 原点不为 0（'${vb.x} ${vb.y}'）：已按实际原点换算，但建议设计稿用 '0 0 ${vb.w} ${vb.h}'。`);
    }
    if (measured.duplicates.length > 0) {
      console.warn(`⚠ SVG 里这些 data-name 重复（只取第一个测量值）：${measured.duplicates.join(' / ')}`);
    }
    if (measured.rects.length === 0) {
      throw new Error('SVG 里没有任何带 data-name 的元素 —— 设计稿缺少可对拍的锚点');
    }

    // —— 配对：只认名字，双向缺失都报 ——
    // 嵌套内部件（有 data-name 祖先）默认不参与：`.ui` 是扁平的，它们本来就该由组件
    // 的 partsOf(box) 算出来（例如播放器的 progressTrack / prevBtn）。用 `--strict` 可恢复。
    const topLevel = args.strict === true ? measured.rects : measured.rects.filter((r) => r.nested !== true);
    const nestedSkipped = measured.rects.filter((r) => r.nested === true).map((r) => r.name);
    const svgByName = new Map(topLevel.map((rect) => [rect.name, rect]));
    const uiNames = Object.keys(solved.rects);
    const missingInUi = topLevel.map((r) => r.name).filter((name) => solved.rects[name] === undefined);
    const missingInSvg = uiNames.filter((name) => !svgByName.has(name));

    const rows = uiNames
      .filter((name) => svgByName.has(name))
      .map((name) => {
        const svg = svgByName.get(name);
        const ui = solved.rects[name];
        const dx = round4(ui.x - svg.x); // 约定：ui − svg（正数 = .ui 算出来更靠右下）
        const dy = round4(ui.y - svg.y);
        const dw = round4(ui.w - svg.w);
        const dh = round4(ui.h - svg.h);
        const worst = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dw), Math.abs(dh));
        return { name, svg, ui, dx, dy, dw, dh, worst: round4(worst), ok: worst <= tol };
      });

    // —— 打印 ——
    console.log(`\n== SVG ↔ .ui 对拍 ==`);
    console.log(`svg : ${svgPath}`);
    console.log(`ui  : ${uiPath}`);
    console.log(`视口: ${viewport.width}×${viewport.height}   tol: ${tol}px   配对: ${rows.length} 项`);
    if (nestedSkipped.length > 0) {
      console.log(`跳过 ${nestedSkipped.length} 个嵌套内部件（有 data-name 祖先；.ui 是扁平的，改由组件 partsOf 对拍）：`);
      console.log(`  ${nestedSkipped.join(' / ')}`);
    }
    console.log('');
    if (rows.length > 0) printTable(rows);
    else console.log('（没有一项名字对得上，见下方缺失清单）');

    const drift = rows.filter((row) => !row.ok);
    if (missingInUi.length > 0) {
      console.log(`\n✗ SVG 有、.ui 里没有（写在 SVG 却漏了 put）：${missingInUi.join(' / ')}`);
    }
    if (missingInSvg.length > 0) {
      console.log(`\n✗ .ui 有、SVG 里没有（put 了却没在稿子上画）：${missingInSvg.join(' / ')}`);
    }
    if (drift.length > 0) {
      console.log(`\n✗ 超差 ${drift.length} 项（tol=${tol}px）：`);
      for (const row of drift) {
        console.log(`  · ${row.name}  最大差 ${fixed4(row.worst)}px`
          + `（dx ${signed4(row.dx)} / dy ${signed4(row.dy)} / dw ${signed4(row.dw)} / dh ${signed4(row.dh)}）`);
      }
    }

    if (missingInUi.length > 0 || missingInSvg.length > 0) exitCode = EXIT_MISSING;
    else if (drift.length > 0) exitCode = EXIT_DRIFT;

    const verdict = exitCode === EXIT_OK
      ? `PASS 全部 ${rows.length} 项在 ${tol}px 内`
      : exitCode === EXIT_MISSING ? 'FAIL 名字对不上' : `FAIL ${drift.length} 项超差`;
    console.log(`\n结论：${verdict}（退出码 ${exitCode}）`);

    // —— 可选落盘：AI 与人共用一份 ——
    if (args.out !== undefined) {
      const outPath = resolve(args.out);
      await mkdir(dirname(outPath), { recursive: true });
      const report = {
        svg: svgPath, ui: uiPath, viewport, tol, viewBox: vb,
        rows, missingInUi, missingInSvg,
        nestedSkipped,
        duplicatesInSvg: measured.duplicates,
        layoutErrors: solved.errors,
        summary: { total: rows.length, ok: rows.length - drift.length, drift: drift.length },
        exitCode,
      };
      await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`报告 → ${outPath}`);
    }
    return exitCode;
  } finally {
    // 谁起谁停：CDP / Chrome / 临时 profile / vite 全部由本脚本收掉
    cdp.close();
    await chrome.kill();
    await cleanupProfiles();
    await server.close();
  }
};

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`✗ svg-rect-diff 自身出错：${error instanceof Error ? error.message : String(error)}`);
    process.exit(EXIT_ERROR);
  });
