#!/usr/bin/env node
/**
 * 自动跑降频矩阵（T26）。
 *
 * 为什么不用页面自己跑：CPU 节流（`Emulation.setCPUThrottlingRate`）是 DevTools 协议能力，
 * 网页无法给自己降频。只有 puppeteer 拿到 CDP session 才能模拟「低端机」。
 *
 * 用法：
 *   node tools/run-bench.mjs                     # 默认 1×/4×/6× × 4 负载 × N=50..1000
 *   node tools/run-bench.mjs --rates 1,6 --kinds sprite --ns 100,1000
 *   node tools/run-bench.mjs --flush             # 每帧强制光栅同步（测真实光栅成本）
 *   node tools/run-bench.mjs --out out/bench.json
 *   node tools/run-bench.mjs --dpr 2             # 高分屏（物理像素 ×4）
 *
 * 输出：stdout 是 markdown（可直接贴进报告），进度走 stderr。
 * 进程由本脚本自己收尾：browser.close() + server.close()，异常也一样。
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixed2, intervalMarkdown, offscreenMarkdown, tableMarkdown } from './report-format.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = path.resolve(HERE, '..');
const CHROME_PATH =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PUPPETEER_PROJECT = process.env.PUPPETEER_PROJECT;
if (PUPPETEER_PROJECT === undefined || PUPPETEER_PROJECT === '') {
  throw new Error('bench 需要 PUPPETEER_PROJECT 指向含 puppeteer 依赖的 package.json（用于定位浏览器）');
}

const KIND_LABELS = {
  sprite: '精灵 drawImage 64×64',
  text: '文字 fillText 14px',
  rect: 'UI 块 fillRect 64×32',
  glow: '发光 drawWithGlow 3 层',
  'ui-direct': '静态 UI 层 每帧重画',
  'ui-cached': '静态 UI 层 手写离屏',
  'ui-layer-cache': '静态 UI 层 createLayerCache',
};

const parseArgs = (argv) => {
  const opts = {
    port: 5300,
    frames: 120,
    warmup: 15,
    ns: [50, 100, 200, 500, 1000],
    kinds: ['sprite', 'text', 'rect', 'glow'],
    rates: [1, 4, 6],
    uiNs: [20, 50, 100, 200],
    dpr: 1,
    flush: false,
    software: false,
    out: null,
    skipUi: false,
  };
  const numbers = (raw, fallback) => {
    const list = String(raw)
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isFinite(value));
    return list.length > 0 ? list : fallback;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === '--port') opts.port = numbers(next, [5300])[0] ?? 5300;
    else if (flag === '--frames') opts.frames = numbers(next, [120])[0] ?? 120;
    else if (flag === '--warmup') opts.warmup = numbers(next, [15])[0] ?? 15;
    else if (flag === '--ns') opts.ns = numbers(next, opts.ns);
    else if (flag === '--kinds') opts.kinds = String(next).split(',').map((s) => s.trim());
    else if (flag === '--rates') opts.rates = numbers(next, opts.rates);
    else if (flag === '--ui-ns') opts.uiNs = numbers(next, opts.uiNs);
    else if (flag === '--dpr') opts.dpr = numbers(next, [1])[0] ?? 1;
    else if (flag === '--out') opts.out = String(next);
    else if (flag === '--flush') opts.flush = true;
    else if (flag === '--software') opts.software = true;
    else if (flag === '--skip-ui') opts.skipUi = true;
    else if (flag === '--help') {
      process.stdout.write(
        '用法: node tools/run-bench.mjs [--port 5300] [--frames 120] [--ns 50,100] [--kinds sprite,text,rect,glow] [--rates 1,4,6] [--dpr 1] [--flush] [--software] [--skip-ui] [--out file.json]\n',
      );
      process.exit(0);
    }
  }
  return opts;
};

const log = (message) => {
  process.stderr.write(`[bench] ${message}\n`);
};

const main = async () => {
  const opts = parseArgs(process.argv.slice(2));

  const { createServer } = await import('vite');
  const server = await createServer({
    root: BENCH_DIR,
    logLevel: 'warn',
    server: {
      host: '127.0.0.1',
      port: opts.port,
      strictPort: true,
      fs: { allow: ['../..'] },
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address !== null ? address.port : opts.port;
  const url = `http://127.0.0.1:${port}/`;
  log(`vite 就绪 ${url}`);

  const require = createRequire(PUPPETEER_PROJECT);
  const puppeteer = require('puppeteer-core');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      ...(opts.software ? ['--disable-gpu'] : []),
    ],
    defaultViewport: { width: 1400, height: 1050, deviceScaleFactor: 1 },
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.__bench !== undefined, { timeout: 30000 });
    await page.bringToFront();
    const client = await page.createCDPSession();
    const env = await page.evaluate(() => window.__bench.env);
    log(`环境 renderer=${env.renderer} dpr=${env.dpr} canvas dpr=${opts.dpr} flush=${opts.flush}`);

    const runAt = async (rate, kind, n) => {
      await client.send('Emulation.setCPUThrottlingRate', { rate });
      const result = await page.evaluate(
        (request) => window.__bench.run(request),
        { kind, n, frames: opts.frames, warmup: opts.warmup, flush: opts.flush, dpr: opts.dpr },
      );
      if (!result.painted && n > 0) {
        log(`警告：${kind} N=${n} 画布像素为空，场景可能没画出来`);
      }
      return result;
    };

    // ---- 主矩阵：4 种负载 × N ----
    const results = [];
    for (const rate of opts.rates) {
      for (const kind of opts.kinds) {
        for (const n of opts.ns) {
          log(`${rate}× ${kind} N=${n} …`);
          results.push({ rate, kind, n, result: await runAt(rate, kind, n) });
        }
      }
      // clear 基线：同一降频下「什么都不画」的成本，用来解释低 N 的底噪
      log(`${rate}× 基线（clear only）…`);
      results.push({ rate, kind: 'sprite', n: 0, result: await runAt(rate, 'sprite', 0) });
    }

    // ---- 离屏对照：ui-direct vs ui-cached ----
    const uiResults = [];
    if (!opts.skipUi) {
      for (const rate of opts.rates) {
        for (const n of opts.uiNs) {
          log(`${rate}× ui-direct N=${n} …`);
          const direct = await runAt(rate, 'ui-direct', n);
          log(`${rate}× ui-cached N=${n} …`);
          const cached = await runAt(rate, 'ui-cached', n);
          log(`${rate}× ui-layer-cache N=${n} …`);
          const layered = await runAt(rate, 'ui-layer-cache', n);
          uiResults.push({ rate, n, direct, cached, layer: layered });
        }
      }
    }

    // ---- 输出 markdown ----
    const lines = [];
    lines.push(`## Canvas 2D 基准结果`, '');
    lines.push(`- 设备：UA \`${env.ua}\``);
    lines.push(`- 渲染后端：\`${env.renderer}\``);
    lines.push(`- 画布：390×844 逻辑像素，dpr=${opts.dpr}`);
    lines.push(
      `- 渲染模式：${opts.software ? '**软件光栅（--disable-gpu / SwiftShader）**，代表「GPU 极弱」下界' : '硬件加速（ANGLE）'}`,
    );
    lines.push(`- 每配置：预热 ${opts.warmup} 帧 + 采样 ${opts.frames} 帧；数值为 **中位数 / p95**（ms）`);
    lines.push(`- 测量范围：\`clearRect\` + 场景绘制（不含浏览器合成）${opts.flush ? '，且每帧强制光栅同步（含真实光栅成本）' : ''}`);
    lines.push('');

    const baseline = new Map();
    for (const item of results) {
      if (item.n === 0) baseline.set(item.rate, item.result);
    }
    if (baseline.size > 0) {
      const baselineRow = [...baseline.entries()]
        .map(([rate, result]) => `${rate}× → 中位数 ${fixed2(result.draw.median)}ms / p95 ${fixed2(result.draw.p95)}ms`)
        .join('；');
      lines.push(`清屏基线（clearRect only）：${baselineRow}`, '');
    }

    for (const kind of opts.kinds) {
      const rows = opts.rates.map((rate) => {
        const byN = new Map();
        for (const item of results) {
          if (item.rate === rate && item.kind === kind && item.n > 0) byN.set(item.n, item.result);
        }
        return { rate, byN };
      });
      lines.push(tableMarkdown(KIND_LABELS[kind] ?? kind, rows, opts.ns));
    }

    const intervalRows = [];
    for (const kind of opts.kinds) {
      for (const rate of opts.rates) {
        const byN = new Map();
        for (const item of results) {
          if (item.rate === rate && item.kind === kind && item.n > 0) byN.set(item.n, item.result);
        }
        intervalRows.push({ label: `${rate}× ${KIND_LABELS[kind] ?? kind}`, byN });
      }
    }
    lines.push(intervalMarkdown(intervalRows, opts.ns));

    if (!opts.skipUi && uiResults.length > 0) {
      const rows = opts.rates.map((rate) => ({
        rate,
        direct: new Map(uiResults.filter((r) => r.rate === rate).map((r) => [r.n, r.direct])),
        cached: new Map(uiResults.filter((r) => r.rate === rate).map((r) => [r.n, r.cached])),
        layer: new Map(uiResults.filter((r) => r.rate === rate).map((r) => [r.n, r.layer])),
      }));
      lines.push(offscreenMarkdown(rows, opts.uiNs));
    }

    process.stdout.write(`${lines.join('\n')}\n`);

    if (opts.out !== null) {
      const outPath = path.isAbsolute(opts.out) ? opts.out : path.resolve(BENCH_DIR, opts.out);
      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(
        outPath,
        JSON.stringify({ env, opts, results, uiResults }, null, 2),
        'utf8',
      );
      log(`原始数据写入 ${outPath}`);
    }
  } finally {
    await browser.close();
    await server.close();
    log('已关闭浏览器与 vite');
  }
};

main().catch((error) => {
  process.stderr.write(`[bench] 失败：${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
