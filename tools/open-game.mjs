#!/usr/bin/env node
/**
 * 打开一个 headless Chrome 跑游戏页面，供调试 MCP 验收用。
 *
 * 为什么单独一个脚本：`bsk`（BrowserSkill）在这台机器上没装，而验收要求
 * 「真跑、不是只跑单测」—— 游戏必须真的在浏览器里渲染、真的连上 WebSocket。
 * 这里用别的项目里已有的 puppeteer-core（本仓库不引依赖，避免动 pnpm-lock）。
 *
 * 用法：
 *   node tools/open-game.mjs --url http://127.0.0.1:5173/ --seconds 600
 *
 * 退出时关闭浏览器；`Ctrl+C` 或到时间都会走正常清理。
 */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const PUPPETEER_PROJECT = 'C:\\Users\\Administrator\\.dsh\\bot\\workspace\\projects\\tanqiu-fengbao\\package.json';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const arg = (name, dflt) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 || process.argv[at + 1] === undefined ? dflt : process.argv[at + 1];
};

const url = arg('url', 'http://127.0.0.1:5173/');
const seconds = Number(arg('seconds', '600'));
const width = Number(arg('width', '390'));
const height = Number(arg('height', '844'));

const require = createRequire(PUPPETEER_PROJECT);
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    // 无头页面默认被当作「后台标签」节流：rAF 会掉到 ~1fps。
    // 游戏的布局在 draw 帧里重算，一被节流就停在旧视口上（实测 390×844 的布局
    // 配 1262×752 的画布，点击坐标与画面全错位）。验收必须关掉节流。
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    // 窗口尺寸也定成目标视口：CDP 的视口覆盖在页面 reload 后会丢，
    // 那时 innerWidth 退回窗口尺寸 —— 实测 reload 后游戏重建、按 1262×752 连上来，
    // 验收就被第二个实例顶掉。窗口本身 390×844 + 强制 dpr=2，兜底到底。
    `--window-size=${width},${height}`,
    '--force-device-scale-factor=2',
  ],
  // isMobile 必须 false：页面没有 <meta name="viewport">，移动端模式下
  // Chrome 会把布局视口定到 980px（innerWidth 报 980），游戏读到的 screen
  // 就不是我们设的视口尺寸，验收的 canvas() 断言必挂。
  defaultViewport: { width, height, deviceScaleFactor: 2, isMobile: false, hasTouch: true },
});
const page = await browser.newPage();
const VIEWPORT = { width, height, deviceScaleFactor: 2, isMobile: false, hasTouch: true };
// 显式再设一次视口：launch 的 defaultViewport 在个别 puppeteer-core 版本下对
// newPage 不生效，页面会先按窗口尺寸（如 1262×752）算一帧 —— 那一帧的布局
// 会被 game.layout 快照读到，验收就全错位。
await page.setViewport(VIEWPORT);
// 每次主导航（含页面 reload）后重新应用视口覆盖：CDP 的覆盖不是永久生效的。
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) void page.setViewport(VIEWPORT).catch(() => undefined);
});
const consoleLines = [];
page.on('console', (message) => {
  const line = `[page] ${message.type()}: ${message.text()}`;
  consoleLines.push(line);
  console.log(line); // 实时打印：诊断「多个 bridge 抢连接」时全靠它
});
page.on('pageerror', (error) => {
  const line = `[pageerror] ${error.message}`;
  consoleLines.push(line);
  console.log(line);
});

// 先导航到 about:blank 一次，让 CDP 的视口覆盖落定。
// 直接 goto 游戏页时，首个文档可能在覆盖生效前就开始执行 —— 游戏会把 Chrome
// 窗口尺寸当成 screen（实测 1262×752@1.875 的实例先连上、之后被 390×844 顶掉，
// 两个 bridge 互抢 WebSocket，验收状态被清）。
await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
// 等游戏启动：__mg 是游戏自己的只读调试钩子，出现即说明 boot() 跑完了
await page.waitForFunction(() => typeof window.__mg === 'object' && window.__mg !== null, { timeout: 30000 });
console.log(`[open-game] 游戏已启动：${url}（viewport ${width}×${height} @2x）`);
for (const line of consoleLines.slice(0, 10)) console.log(`[page] ${line}`);
// 诊断：打印浏览器里的页面数与每页视口。验收出现「第二个实例抢连接」时要靠这个定位
// （一个页面 = 正常；两个页面 = 有残留页面/重复 newPage）。
for (const [index, p] of (await browser.pages()).entries()) {
  const vp = p.viewport();
  const size = vp === null ? 'null' : `${vp.width}×${vp.height}@${vp.deviceScaleFactor}`;
  console.log(`[open-game] page[${index}] viewport=${size} url=${p.url()}`);
}

const stop = async (code) => {
  console.log('[open-game] 关闭浏览器');
  await browser.close().catch(() => undefined);
  process.exit(code);
};
process.once('SIGINT', () => void stop(0));
process.once('SIGTERM', () => void stop(0));
setTimeout(() => void stop(0), Math.max(5, seconds) * 1000);

// 保持进程活着，让游戏页面一直在浏览器里跑
setInterval(() => undefined, 60_000);
