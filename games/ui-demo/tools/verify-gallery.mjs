#!/usr/bin/env node
/**
 * 组件总览（gallery）的真实浏览器验收（T27）。
 *
 * 验三件事：
 * 1. **19 个组件都在一个界面里画出来了** —— 按「行」扫描真实画布像素：
 *    每行左区（组件区）里「与行底色不同的像素」足够多，说明这一行不是空白。
 * 2. 滚动能把 19 行全覆盖（顶 / 中 / 底三屏），4 张截图。
 * 3. 窄屏（320×568）不挤压变形（每行仍在视口内、组件区不是空白）。
 *
 * 为什么不用调试 MCP：这里要「读画布像素」+「拖动到指定滚动位」，
 * puppeteer 直连 CDP 更直接（与 verify-input 同一套启动参数）。
 *
 * 前置：`mg dev` 已起。这个脚本自己 launch / close Chrome。
 *
 * 用法：node games/ui-demo/tools/verify-gallery.mjs [--url http://127.0.0.1:5173/]
 */

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const outDir = join(repoRoot, 'out', 'debug');

// 需要 puppeteer：设 PUPPETEER_PROJECT 指向含 puppeteer 依赖的 package.json（createRequire 用它定位）
const PUPPETEER_PROJECT = process.env.PUPPETEER_PROJECT;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const arg = (name, dflt) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 || process.argv[at + 1] === undefined ? dflt : process.argv[at + 1];
};
const url = arg('url', 'http://127.0.0.1:5173/');

/** 行高与行数：必须与 gallery.ts / gallery.ui 一致（不一致会按错行扫描）。 */
const ITEM_H = 88;
const COUNT = 19;
/** 行底色（`.ui` 里 itemColor="#17242a"）：与它不同的像素才算「组件画了东西」。 */
const ITEM_COLOR = [0x17, 0x24, 0x2a];

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : `（${detail}）`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const require = createRequire(PUPPETEER_PROJECT);
const puppeteer = require('puppeteer-core');

const makeViewport = (width, height) => ({ width, height, deviceScaleFactor: 2, isMobile: false, hasTouch: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=390,844',
    '--force-device-scale-factor=2',
  ],
  defaultViewport: makeViewport(390, 844),
});

let page;
const snapshot = () => page.evaluate(() => window.__mg);

/**
 * 扫描真实画布：返回「当前可见行」里每一行的非行底色像素数（左区 = 组件区）。
 *
 * 坐标换算：逻辑像素 → 物理像素要乘 dpr（画布 backing 是 780×1688）。
 * 只统计「至少半行可见」的行，避免把刚露一条边的行误判成空白。
 */
const scanRows = (listTop, listH, offset, logicWidth) =>
  page.evaluate(
    ({ itemH, count, itemColor, listTop, listH, offset, logicWidth }) => {
      const canvas = document.querySelector('canvas');
      if (canvas === null) return { error: '找不到 canvas' };
      const ctx = canvas.getContext('2d');
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data, width, height } = img;
      // 视口宽是逻辑像素，画布宽是物理像素 → dpr
      const dpr = canvas.width / logicWidth;
      // 左区（组件区）宽 58%，与 render.ts 的 GALLERY_LEFT 一致
      const leftW = Math.min(Math.floor(width * 0.58), width);
      const rows = [];
      for (let index = 0; index < count; index += 1) {
        const y0 = (listTop - offset + index * itemH) * dpr;
        const y1 = y0 + itemH * dpr;
        // 与列表可视区求交
        const top = Math.max(Math.ceil(y0), Math.ceil(listTop * dpr));
        const bottom = Math.min(Math.floor(y1), Math.floor((listTop + listH) * dpr), height);
        if (bottom - top < (itemH * dpr) / 2) continue; // 不足半行：不判
        let painted = 0;
        let total = 0;
        for (let y = top; y < bottom; y += 2) {
          for (let x = 0; x < leftW; x += 2) {
            const p = (y * width + x) * 4;
            total += 1;
            const same =
              Math.abs(data[p] - itemColor[0]) <= 6 &&
              Math.abs(data[p + 1] - itemColor[1]) <= 6 &&
              Math.abs(data[p + 2] - itemColor[2]) <= 6;
            if (!same) painted += 1;
          }
        }
        rows.push({ index, painted, total });
      }
      return { rows, dpr, canvasW: canvas.width, canvasH: canvas.height };
    },
    { itemH: ITEM_H, count: COUNT, itemColor: ITEM_COLOR, listTop, listH, offset, logicWidth },
  );

/**
 * 拖动列表到目标滚动位（真实 mouse 事件）。
 *
 * **必须分段**：`page.mouse.move` 的目标点如果在视口外，Chrome 不会给页面派发
 * pointermove —— 一次拖 500px 会让后半段事件全丢（实测只滚到目标的 92%）。
 * 每段不超过列表高的一半，保证起终点都落在屏内。
 */
const dragToOffset = async (list, target) => {
  let current = (await snapshot()).state.scroll.offset;
  const maxStep = Math.floor(list.h * 0.5);
  for (let guard = 0; guard < 12 && Math.abs(target - current) > 2; guard += 1) {
    const delta = Math.max(-maxStep, Math.min(maxStep, target - current));
    const x = Math.round(list.x + list.w / 2);
    const y = Math.round(list.y + list.h / 2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - delta, { steps: 10 });
    await page.mouse.up();
    await sleep(200);
    const next = (await snapshot()).state.scroll.offset;
    if (Math.abs(next - current) < 1) break; // 卡住就停（别死循环）
    current = next;
  }
  return current;
};

try {
  page = await browser.newPage();
  await page.setViewport(makeViewport(390, 844));
  await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__mg === 'object' && window.__mg !== null, { timeout: 30000 });
  await sleep(400);

  const boot = await snapshot();
  check('游戏在 390×844 @2pr2 下启动', boot.platform.width === 390 && boot.platform.dpr === 2, JSON.stringify(boot.platform));

  // 从 menu 点「组件总览」（card0）进入
  const cardRect = (await snapshot()).layout['card0'];
  if (cardRect === undefined) throw new Error('menu 里没有 card0 入口');
  await page.mouse.move(Math.round(cardRect.x + cardRect.w / 2), Math.round(cardRect.y + cardRect.h / 2));
  await page.mouse.down();
  await page.mouse.up();
  await sleep(260);
  const entered = await snapshot();
  check('menu 点「组件总览」进入 gallery', entered.state.screen === 'gallery', `screen=${entered.state.screen}`);
  check('gallery 布局无错、19 项数据就位', entered.errors.length === 0 && (entered.layout['list'] !== undefined), JSON.stringify(entered.errors));

  const list = (await snapshot()).layout['list'];
  const dpr = entered.platform.dpr;

  // ---- 第一屏（顶部）：offset 0
  const scanTop = await scanRows(list.y, list.h, 0, 390);
  const topRows = scanTop.rows;
  check('第一屏：可见行数正常（约 7 行）', topRows.length >= 6, `${topRows.length} 行，canvas=${scanTop.canvasW}×${scanTop.canvasH} dpr=${dpr}`);
  const blankTop = topRows.filter((row) => row.painted < 100);
  check(
    '第一屏：每一行的组件区都画了东西（非行底色像素 > 100）',
    blankTop.length === 0,
    topRows.map((r) => `#${r.index}:${r.painted}`).join(' '),
  );
  await page.screenshot({ path: join(outDir, 'ui-demo-gallery-top.png') });

  // ---- 第二屏（中段）：offset 520
  const midOffset = await dragToOffset(list, 520);
  const scanMid = await scanRows(list.y, list.h, midOffset, 390);
  const blankMid = scanMid.rows.filter((row) => row.painted < 100);
  check(
    '第二屏（滚动中段）：每一行的组件区都画了东西',
    Math.abs(midOffset - 520) <= 2 && blankMid.length === 0,
    `offset=${midOffset} ${scanMid.rows.map((r) => `#${r.index}:${r.painted}`).join(' ')}`,
  );
  await page.screenshot({ path: join(outDir, 'ui-demo-gallery-mid.png') });

  // ---- 第三屏（底部）：拖到底
  const maxOffset = COUNT * ITEM_H - list.h;
  const bottomOffset = await dragToOffset(list, maxOffset);
  const scanBottom = await scanRows(list.y, list.h, bottomOffset, 390);
  const blankBottom = scanBottom.rows.filter((row) => row.painted < 100);
  check(
    '第三屏（滚到底）：每一行的组件区都画了东西',
    Math.abs(bottomOffset - maxOffset) <= 2 && blankBottom.length === 0,
    `offset=${bottomOffset}/${maxOffset} ${scanBottom.rows.map((r) => `#${r.index}:${r.painted}`).join(' ')}`,
  );
  await page.screenshot({ path: join(outDir, 'ui-demo-gallery-bottom.png') });

  // ---- 19 行全覆盖：三屏的行下标合起来必须是 0..18
  const covered = new Set([...topRows, ...scanMid.rows, ...scanBottom.rows].map((row) => row.index));
  check(
    '三屏合起来覆盖全部 19 行，没有一行漏检',
    covered.size === COUNT,
    `覆盖 ${covered.size}/${COUNT}：${[...covered].sort((a, b) => a - b).join(',')}`,
  );

  // ---- 窄屏 320×568：重新加载后进 gallery
  await page.setViewport(makeViewport(320, 568));
  await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__mg === 'object' && window.__mg !== null, { timeout: 30000 });
  await sleep(400);
  const narrow = await snapshot();
  check('窄屏：视口 320×568 @dpr2', narrow.platform.width === 320 && narrow.platform.height === 568, JSON.stringify(narrow.platform));
  const narrowCard = narrow.layout['card0'];
  await page.mouse.move(Math.round(narrowCard.x + narrowCard.w / 2), Math.round(narrowCard.y + narrowCard.h / 2));
  await page.mouse.down();
  await page.mouse.up();
  await sleep(260);
  const narrowGallery = await snapshot();
  check('窄屏：仍能进入 gallery', narrowGallery.state.screen === 'gallery', `screen=${narrowGallery.state.screen}`);
  const narrowList = narrowGallery.layout['list'];
  check(
    '窄屏：列表在视口内、宽度收缩但没溢出',
    narrowList.x >= 0 && narrowList.x + narrowList.w <= 320.5 && narrowList.w > 250,
    JSON.stringify(narrowList),
  );
  const scanNarrow = await scanRows(narrowList.y, narrowList.h, 0, 320);
  const blankNarrow = scanNarrow.rows.filter((row) => row.painted < 100);
  check(
    '窄屏：第一屏每一行的组件区都画了东西（没有挤压成空白）',
    blankNarrow.length === 0,
    scanNarrow.rows.map((r) => `#${r.index}:${r.painted}`).join(' '),
  );
  await page.screenshot({ path: join(outDir, 'ui-demo-gallery-320.png') });

  console.log('');
  for (const name of ['ui-demo-gallery-top', 'ui-demo-gallery-mid', 'ui-demo-gallery-bottom', 'ui-demo-gallery-320']) {
    console.log(`截图：${join(outDir, `${name}.png`)}`);
  }
} catch (error) {
  check('验收过程中没有异常', false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close().catch(() => undefined);
}

const failed = results.filter((r) => !r.pass);
console.log('');
console.log(`组件总览验收：${results.length - failed.length} 通过 / ${failed.length} 失败`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  ✗ ${f.name}：${f.detail ?? ''}`);
  process.exitCode = 1;
}
