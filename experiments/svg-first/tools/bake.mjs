#!/usr/bin/env node
/**
 * SVG 先行 · 烘焙与对拍（bake）
 *
 * 干四件事：
 *   1. 用 data-* 属性在 Node 里**复算一遍布局**（.ui 的 region 语义：top/bottom/fill + gap/pad/align/justify）
 *   2. 用无头 Chrome 打开 SVG，对每个 [data-name] 用 `getBBox()` + `getCTM()` 量出真实几何
 *   3. 两者逐项对拍（容差 0.5px）——不等就说明「SVG 画的位置」和「属性声明的约束」对不上，
 *      这份 SVG 不可能被机械翻译成 `.ui`
 *   4. 出 PNG（严格 390×844）+ 把 rect 表写进 SPEC.md 的标记区
 *
 * 用法：node experiments/svg-first/tools/bake.mjs [--no-shot]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanupProfiles,
  connectToPage,
  purgeStaleProfiles,
  startChrome,
} from '../../../templates/iaa-simple/tools/lib/harness.mjs';

/**
 * 自带静态服务：harness 的 `startStaticServer` 的 MIME 表**没有 `.svg`**，
 * 会被当成 `application/octet-stream` → Chrome 触发下载而不是渲染（实测踩到）。
 * 这里补上 `image/svg+xml`，其余照搬它的写法（随机端口 + 收尾有超时兜底）。
 */
const MIME = {
  '.svg': 'image/svg+xml; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const serveDir = async (dir) => {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = resolve(root, rel);
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      const buf = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((ok) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          ok();
        };
        server.close(finish);
        server.closeAllConnections?.();
        setTimeout(finish, 2000);
      }),
  };
};

const here = dirname(fileURLToPath(import.meta.url));
const designDir = resolve(here, '../design');
const svgPath = join(designDir, 'player-390.svg');
const pngPath = join(designDir, 'player-390.png');
const specPath = join(designDir, 'SPEC.md');

const VIEWport = { width: 390, height: 844 };
const TOLERANCE = 0.5;
const ALLOWED_REGIONS = ['header', 'stage', 'dock', 'overlay'];
const ALLOWED_FONTS = [12, 14, 16, 20, 28, 36];

const failures = [];
const warnings = [];
const fail = (msg) => failures.push(msg);

// ---------------------------------------------------------------------------
// 1. 约束引擎：按 .ui 的语义复算
// ---------------------------------------------------------------------------

/** `fixed:44` / `fill` / `38%` / 裸数字 → 数值（fill 返回 'fill'）。基数由调用方给。 */
const parseLen = (raw, base) => {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = raw.trim();
  if (s === 'fill') return 'fill';
  if (s.startsWith('fixed:')) return Number(s.slice(6));
  if (s.endsWith('%')) return (Number(s.slice(0, -1)) / 100) * base;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const numOf = (raw, fallback = 0) => {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

/** region 带：top 累加 / bottom 累减 / fill 吃剩余（多个 fill 平分）。 */
const solveRegions = (regions, vp) => {
  let topCum = 0;
  let bottomCum = 0;
  const fills = [];
  const out = new Map();
  for (const r of regions) {
    const anchor = r.attrs['data-anchor'];
    const rawH = r.attrs['data-height'];
    if (!ALLOWED_REGIONS.includes(r.attrs['data-region'])) {
      fail(`未知 region「${r.attrs['data-region']}」（只允许 ${ALLOWED_REGIONS.join(' / ')}）`);
    }
    if (anchor === 'top') {
      const h = parseLen(rawH, vp.height);
      out.set(r, { x: 0, y: topCum, w: vp.width, h: h });
      topCum += h;
    } else if (anchor === 'bottom') {
      const h = parseLen(rawH, vp.height);
      bottomCum += h;
      out.set(r, { x: 0, y: vp.height - bottomCum, w: vp.width, h });
    } else if (anchor === 'fill') {
      fills.push(r);
    } else {
      fail(`region「${r.attrs['data-region']}」的 data-anchor 非法：${anchor}`);
    }
  }
  const remain = vp.height - topCum - bottomCum;
  if (remain <= 0) fail(`top + bottom 高度超过 100%（剩余 ${remain.toFixed(2)}px）`);
  const each = fills.length > 0 ? remain / fills.length : 0;
  let y = topCum;
  for (const r of fills) {
    out.set(r, { x: 0, y, w: vp.width, h: each });
    y += each;
  }
  if (out.size > 4) fail(`region 超过 4 个（${out.size}）`);
  return out;
};

/** 一个容器（region 或 composite）里排子元素。 */
const solveChildren = (box, container, vp) => {
  const attrs = container.attrs;
  const dir = attrs['data-dir'] ?? 'column';
  const gap = numOf(attrs['data-gap'], 0);
  const padX = parseLen(attrs['data-pad-x'], vp.width) ?? 0;
  const padY = parseLen(attrs['data-pad-y'], vp.height) ?? 0;
  const align = attrs['data-align'] ?? 'start';
  const justify = attrs['data-justify'] ?? 'start';

  const cx = box.x + padX;
  const cy = box.y + padY;
  const cw = box.w - padX * 2;
  const ch = box.h - padY * 2;
  const mainBase = dir === 'row' ? cw : ch;
  const crossBase = dir === 'row' ? ch : cw;

  const kids = container.children;
  if (kids.length === 0) return new Map();

  const mains = kids.map((k) => parseLen(k.attrs['data-size'], mainBase));
  const fillCount = mains.filter((m) => m === 'fill').length;
  const fixedSum = mains.reduce((a, m) => a + (typeof m === 'number' ? m : 0), 0);
  const gapSum = gap * (kids.length - 1);
  const freedByFill = mainBase - fixedSum - gapSum;
  const fillSize = fillCount > 0 ? freedByFill / fillCount : 0;
  const sizes = mains.map((m) => (m === 'fill' ? fillSize : (m ?? 0)));
  const used = sizes.reduce((a, b) => a + b, 0) + gapSum;
  const free = mainBase - used;

  let cursor = 0;
  if (justify === 'center') cursor = free / 2;
  else if (justify === 'end') cursor = free;
  const spaceBetween = justify === 'space-between' && kids.length > 1 ? free / (kids.length - 1) : 0;

  const out = new Map();
  kids.forEach((k, i) => {
    const mainSize = sizes[i];
    const rawCross = parseLen(k.attrs['data-cross'], crossBase);
    let crossSize = rawCross === 'fill' || rawCross === null ? crossBase : rawCross;
    if (align === 'stretch') crossSize = crossBase;
    let crossPos = 0;
    if (align === 'center') crossPos = (crossBase - crossSize) / 2;
    else if (align === 'end') crossPos = crossBase - crossSize;

    const rect = dir === 'row'
      ? { x: cx + cursor, y: cy + crossPos, w: mainSize, h: crossSize }
      : { x: cx + crossPos, y: cy + cursor, w: crossSize, h: mainSize };
    out.set(k, rect);
    cursor += mainSize + gap + spaceBetween;
  });
  return out;
};

/** 整棵树：region → 子元素；带 data-dir 的 composite 递归。 */
const solveTree = (tree, vp) => {
  const rects = new Map();
  const regionRects = solveRegions(tree.regions, vp);
  for (const r of tree.regions) {
    const box = regionRects.get(r);
    const kids = solveChildren(box, r, vp);
    for (const [k, rect] of kids) {
      rects.set(k, rect);
      if (k.children.length > 0 && k.attrs['data-dir'] !== undefined) {
        const sub = solveChildren(rect, k, vp);
        for (const [s, sr] of sub) {
          rects.set(s, sr);
          if (s.children.length > 0 && s.attrs['data-dir'] !== undefined) {
            for (const [t, tr] of solveChildren(sr, s, vp)) rects.set(t, tr);
          }
        }
      }
    }
  }
  return rects;
};

// ---------------------------------------------------------------------------
// 2. 浏览器：量 + 截图
// ---------------------------------------------------------------------------
const EXTRACT = `(() => {
  const walk = (el) => {
    const attrs = {};
    for (const a of el.attributes) attrs[a.name] = a.value;
    const kids = [...el.children]
      .filter((c) => c.hasAttribute && (c.hasAttribute('data-part') || c.hasAttribute('data-region')))
      .map((c) => walk(c));
    return { tag: el.tagName.toLowerCase(), attrs, children: kids };
  };
  const regions = [...document.querySelectorAll('[data-region]')].map((el) => walk(el));
  const measured = {};
  for (const el of document.querySelectorAll('[data-name]')) {
    const name = el.getAttribute('data-name');
    const b = el.getBBox();
    const m = el.getCTM();
    const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
      .map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    measured[name] = { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    if (el.querySelectorAll('[data-name]').length > 0) {
      measured[name].hasNested = true;
    }
  }
  const fontSizes = [...new Set([...document.querySelectorAll('text')]
    .map((t) => Number(t.getAttribute('font-size'))))];
  const names = [...document.querySelectorAll('[data-name]')].map((e) => e.getAttribute('data-name'));
  const partsWithoutName = [...document.querySelectorAll('[data-part]')]
    .filter((e) => !e.hasAttribute('data-name')).map((e) => e.getAttribute('data-part'));
  const paintedNoToken = [...document.querySelectorAll('[fill],[stroke]')]
    .filter((e) => {
      const f = e.getAttribute('fill'); const s = e.getAttribute('stroke');
      const solid = (f && f !== 'none' && !f.startsWith('url(')) || (s && s !== 'none' && !s.startsWith('url('));
      return solid && !e.hasAttribute('data-token') && e.tagName.toLowerCase() !== 'stop';
    })
    .map((e) => e.tagName + (e.getAttribute('class') ? '.' + e.getAttribute('class') : ''));
  return { tree: { regions }, measured, fontSizes, names, partsWithoutName, paintedNoToken,
           svgSize: { w: document.documentElement.getBoundingClientRect().width,
                      h: document.documentElement.getBoundingClientRect().height } };
})()`;

const main = async () => {
  const shot = !process.argv.includes('--no-shot');
  const source = readFileSync(svgPath, 'utf8');
  console.log(`SVG ${source.length} 字节 · ${svgPath}`);

  purgeStaleProfiles();
  const server = await serveDir(designDir);
  const chrome = await startChrome({ width: VIEWport.width, height: VIEWport.height });
  const cdp = await connectToPage(chrome.port);
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWport.width,
      height: VIEWport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${server.url}player-390.svg` });
    await cdp.waitFor(`document.querySelector('[data-name]') !== null`, {
      timeoutMs: 15000,
      label: 'SVG 渲染完成',
    });
    // 字体就绪（避免量到 fallback 字宽）
    await cdp.eval(`(async () => { if (document.fonts) await document.fonts.ready; return true; })()`);

    const data = await cdp.eval(EXTRACT);

    // --- 结构校验 -------------------------------------------------------
    if (data.names.length !== new Set(data.names).size) {
      const dup = data.names.filter((n, i) => data.names.indexOf(n) !== i);
      fail(`data-name 重复：${[...new Set(dup)].join(', ')}`);
    }
    if (data.partsWithoutName.length > 0) fail(`data-part 缺 data-name：${data.partsWithoutName.join(', ')}`);
    for (const fs of data.fontSizes) {
      if (!ALLOWED_FONTS.includes(fs)) fail(`字号 ${fs} 不在允许档位 ${ALLOWED_FONTS.join('/')}`);
    }
    if (data.paintedNoToken.length > 0) {
      warnings.push(`有上色元素缺 data-token（${data.paintedNoToken.length} 处）：${data.paintedNoToken.slice(0, 6).join(', ')}`);
    }
    if (Math.abs(data.svgSize.w - VIEWport.width) > 0.01 || Math.abs(data.svgSize.h - VIEWport.height) > 0.01) {
      fail(`SVG 文档尺寸 ${data.svgSize.w}×${data.svgSize.h} ≠ 390×844`);
    }

    // --- 约束复算 vs 实测 ------------------------------------------------
    const expected = solveTree(data.tree, VIEWport);
    const rows = [];
    const namesInOrder = [];
    const collect = (nodes) => {
      for (const n of nodes) {
        if (n.attrs['data-name']) namesInOrder.push(n.attrs['data-name']);
        collect(n.children);
      }
    };
    collect(data.tree.regions);

    for (const name of namesInOrder) {
      const exp = expected.get([...expected.keys()].find((k) => k.attrs['data-name'] === name));
      const got = data.measured[name];
      if (!got) {
        fail(`${name}：量不到 bbox`);
        continue;
      }
      if (!exp) {
        warns: warnings.push(`${name}：约束引擎没算出预期矩形（检查 data-size/data-cross）`);
        rows.push({ name, got, exp: null, ok: false });
        continue;
      }
      const d = Math.max(Math.abs(exp.x - got.x), Math.abs(exp.y - got.y), Math.abs(exp.w - got.w), Math.abs(exp.h - got.h));
      const ok = d <= TOLERANCE;
      if (!ok) {
        fail(`${name}：实测与约束不符（Δ=${d.toFixed(3)}px）实测 ${fmt(got)} / 预期 ${fmt(exp)}`);
      }
      rows.push({ name, got, exp, ok, d });
    }

    // --- 截图 ------------------------------------------------------------
    let png = null;
    if (shot) {
      const shotRes = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: VIEWport.width, height: VIEWport.height, scale: 1 },
        captureBeyondViewport: false,
      });
      const buf = Buffer.from(shotRes.data, 'base64');
      writeFileSync(pngPath, buf);
      png = { bytes: buf.length, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
      if (png.w !== 390 || png.h !== 844) fail(`PNG 尺寸 ${png.w}×${png.h} ≠ 390×844`);
    }

    // --- 报告 ------------------------------------------------------------
    console.log('\n── 逐项对拍（实测 = getBBox × getCTM；预期 = data-* 复算）──');
    console.log('name'.padEnd(18), 'x'.padStart(9), 'y'.padStart(9), 'w'.padStart(9), 'h'.padStart(9), '  Δ');
    for (const r of rows) {
      const g = r.got;
      console.log(
        r.name.padEnd(18),
        g.x.toFixed(4).padStart(9), g.y.toFixed(4).padStart(9), g.w.toFixed(4).padStart(9), g.h.toFixed(4).padStart(9),
        ` ${r.ok ? 'OK' : 'Δ' + (r.d ?? 0).toFixed(3)}`,
      );
    }
    console.log(`\ndata-name 个数 = ${data.names.length}；表行数 = ${rows.length}；一致 = ${data.names.length === rows.length}`);
    if (png) console.log(`PNG ${png.w}×${png.h} · ${png.bytes} 字节`);
    if (warnings.length > 0) {
      console.log(`\n警告 ${warnings.length} 条：`);
      for (const w of warnings) console.log('  · ' + w);
    }
    if (failures.length > 0) {
      console.log(`\n失败 ${failures.length} 条：`);
      for (const f of failures) console.log('  ✗ ' + f);
    } else {
      console.log('\n全部通过：约束复算与实测逐项相等（容差 ' + TOLERANCE + 'px）');
    }

    // --- 写回 SPEC.md 的 rect 表 -----------------------------------------
    if (rows.length > 0) {
      const table = [
        '| # | data-name | comp | x | y | w | h | 约束（size / cross） |',
        '|---|---|---|---|---|---|---|---|',
        ...rows.map((r, i) => {
          const node = [...expected.keys()].find((k) => k.attrs['data-name'] === r.name);
          const attrs = node?.attrs ?? {};
          const g = r.got;
          return `| ${i + 1} | \`${r.name}\` | ${attrs['data-comp'] ?? ''} | ${g.x.toFixed(4)} | ${g.y.toFixed(4)} | ${g.w.toFixed(4)} | ${g.h.toFixed(4)} | ${attrs['data-size'] ?? ''} / ${attrs['data-cross'] ?? ''} |`;
        }),
      ].join('\n');
      const spec = readFileSync(specPath, 'utf8');
      const begin = '<!-- RECTS:BEGIN（本表由 tools/bake.mjs 生成，禁止手改） -->';
      const end = '<!-- RECTS:END -->';
      const i = spec.indexOf(begin);
      const j = spec.indexOf(end);
      if (i >= 0 && j > i) {
        const next = `${spec.slice(0, i)}${begin}\n\n${table}\n\n${spec.slice(j)}`;
        writeFileSync(specPath, next, 'utf8');
        console.log(`已写回 SPEC.md（${rows.length} 行）`);
      } else {
        warnings.push('SPEC.md 里没找到 RECTS 标记，未写回');
      }
    }

    if (failures.length > 0) process.exitCode = 1;
  } finally {
    cdp.close();
    await chrome.kill();
    await server.close();
    await cleanupProfiles();
  }
};

const fmt = (r) => `{x:${r.x.toFixed(2)}, y:${r.y.toFixed(2)}, w:${r.w.toFixed(2)}, h:${r.h.toFixed(2)}}`;

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
