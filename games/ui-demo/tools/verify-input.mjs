#!/usr/bin/env node
/**
 * ui-demo 的真实输入验收（T13d）：用 CDP 原生的鼠标事件驱动游戏，
 * 断言「按下 → 三态视觉」「拖动 → 滚动位」「点列表项 → 选中」。
 *
 * 为什么不用调试 MCP 的 `click`：它只发一次 down+up，中间没有「按住」的窗口，
 * 而按下态（pressed）与拖动都发生在 down 与 up **之间**。这里用 puppeteer 的
 * `mouse.down()/move()/up()` 走同一条 CDP Input.dispatchMouseEvent 路径 ——
 * 浏览器里是真事件，游戏侧完全感知不到差别。
 *
 * 前置：`mg dev` 已起（这个脚本自己 launch / close Chrome，不需要 open-game）。
 *
 * 用法：node games/ui-demo/tools/verify-input.mjs [--url http://127.0.0.1:5173/]
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
const WIDTH = 390;
const HEIGHT = 844;

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : `（${detail}）`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const require = createRequire(PUPPETEER_PROJECT);
const puppeteer = require('puppeteer-core');

const VIEWPORT = { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, isMobile: false, hasTouch: true };
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    // 无头页面默认被当后台标签节流（实测 fps 1.65）：布局只在 draw 帧重算，
    // 一被节流就停在旧视口上，点击坐标与画面全错位。
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--window-size=${WIDTH},${HEIGHT}`,
    '--force-device-scale-factor=2',
  ],
  defaultViewport: VIEWPORT,
});

/** 读游戏侧只读快照（`__mg`）。 */
const snapshot = () => page.evaluate(() => window.__mg);
const rectOf = async (name) => (await snapshot()).layout[name];
/** 点组件中心（真实 mouse down+up）。 */
const clickComponent = async (name) => {
  const rect = await rectOf(name);
  if (rect === undefined) throw new Error(`当前界面没有组件 ${name}`);
  const x = Math.round(rect.x + rect.w / 2);
  const y = Math.round(rect.y + rect.h / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(180);
  return { x, y };
};

let page;
try {
  page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  // 先导航到 about:blank，让 CDP 的视口覆盖在游戏文档创建前生效
  await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__mg === 'object' && window.__mg !== null, { timeout: 30000 });
  await sleep(400); // 等首帧布局（视口覆盖落定后游戏会按 390×844 重算）

  // ---------------------------------------------------------------- 0. 环境
  const boot = await snapshot();
  check('游戏在 390×844 @dpr2 下启动', boot.platform.width === 390 && boot.platform.height === 844 && boot.platform.dpr === 2, JSON.stringify(boot.platform));
  check('menu：初始界面 + 布局无错', boot.state.screen === 'menu' && boot.errors.length === 0, JSON.stringify(boot.errors));

  // ---------------------------------------------------------------- 1. 按下变 pressed
  const startRect = await rectOf('button');
  const sx = Math.round(startRect.x + startRect.w / 2);
  const sy = Math.round(startRect.y + startRect.h / 2);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await sleep(120);
  const downState = await snapshot();
  check(
    'mouse.down(开始按钮)：press.pressed = button（三态真的进状态）',
    downState.state.press.pressed === 'button',
    `pressed=${String(downState.state.press.pressed)}`,
  );
  await page.screenshot({ path: join(outDir, 'ui-demo-menu-pressed.png') });
  check('截图：按下态已落盘', true, join(outDir, 'ui-demo-menu-pressed.png'));
  await page.mouse.up();
  await sleep(180);
  const afterUp = await snapshot();
  check('mouse.up：松手回 normal 并进 play', afterUp.state.press.pressed === null && afterUp.state.screen === 'play', `screen=${afterUp.state.screen}`);

  // ---------------------------------------------------------------- 2. play → result → menu
  for (let i = 0; i < 3; i += 1) await clickComponent('tapTarget');
  const resultState = await snapshot();
  check('点目标 3 次进结算', resultState.state.screen === 'result' && resultState.state.hits === 3, `screen=${resultState.state.screen} hits=${resultState.state.hits}`);
  await clickComponent('primaryButton');
  check('结算点「再来一次」回 menu', (await snapshot()).state.screen === 'menu');

  // ---------------------------------------------------------------- 3. inventory：点第 3 项
  await clickComponent('primaryButton'); // menu 的 primaryButton = 打开背包
  const inv = await snapshot();
  check('menu 点「打开背包」进 inventory', inv.state.screen === 'inventory', `screen=${inv.state.screen}`);
  const list = await rectOf('list');
  check('inventory：list 尺寸合理（贴满剩余高度）', list.w > 300 && list.h > 390, JSON.stringify(list));
  // 第 3 项中心：列表顶 + 2.5 个项高（itemH=56）
  await page.mouse.move(Math.round(list.x + list.w / 2), Math.round(list.y + 56 * 2 + 28));
  await page.mouse.down();
  await page.mouse.up();
  await sleep(180);
  const picked = await snapshot();
  check('点击列表第 3 项：selected = 2', picked.state.selected === 2, `selected=${String(picked.state.selected)}`);

  // ---------------------------------------------------------------- 4. 真实拖动 200px
  const cx = Math.round(list.x + list.w / 2);
  const cy = Math.round(list.y + list.h / 2);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 200, { steps: 10 });
  await sleep(120);
  const dragging = await snapshot();
  const draggingShot = join(outDir, 'ui-demo-inventory-dragging.png');
  await page.screenshot({ path: draggingShot });
  check(
    '拖动中：scroll.offset 已经跟到 200 附近（跟手）',
    Math.abs(dragging.state.scroll.offset - 200) <= 20 && dragging.state.scroll.dragging === true,
    `offset=${dragging.state.scroll.offset} dragging=${String(dragging.state.scroll.dragging)}`,
  );
  await page.mouse.up();
  await sleep(180);
  const dropped = await snapshot();
  check(
    '松手后：scroll.offset = 200（±2），拖动结束',
    Math.abs(dropped.state.scroll.offset - 200) <= 2 && dropped.state.scroll.dragging === false,
    `offset=${dropped.state.scroll.offset}`,
  );
  check('拖动没有误触发列表点击（selected 仍是 2）', dropped.state.selected === 2, `selected=${String(dropped.state.selected)}`);
  // 滚动条比例也跟着变：value = offset / (content - view)
  const bar = await rectOf('scrollbar');
  check('滚动条仍贴在列表右侧（没被列表滚动带走）', Math.abs(bar.h - list.h) <= 12 && bar.x + bar.w <= WIDTH, `bar=${JSON.stringify(bar)}`);

  // ---------------------------------------------------------------- 5. 返回 + popup 三条回归
  await clickComponent('button');
  check('inventory 点「返回」回 menu', (await snapshot()).state.screen === 'menu');
  await clickComponent('secondaryButton'); // menu 的 secondaryButton = 打开弹窗
  check('menu 点「打开弹窗」进 popup', (await snapshot()).state.screen === 'popup');

  const maskRect = await rectOf('infoPanel');
  const baseRect = await rectOf('secondaryButton');
  const confirmRect = await rectOf('primaryButton');
  check('popup：遮罩盖满视口', Math.round(maskRect.w) === WIDTH && Math.round(maskRect.h) === HEIGHT, JSON.stringify(maskRect));

  // ① 遮罩空白处
  await page.mouse.move(5, 5);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(180);
  check('click(遮罩空白 5,5)：block 吃掉，状态不变', (await snapshot()).state.screen === 'popup');
  // ② 底层按钮位置（被遮罩挡住）
  await page.mouse.move(Math.round(baseRect.x + baseRect.w / 2), Math.round(baseRect.y + baseRect.h / 2));
  await page.mouse.down();
  await page.mouse.up();
  await sleep(180);
  check('click(底层按钮位置)：遮罩挡住穿透，仍在 popup', (await snapshot()).state.screen === 'popup');
  // ③ 面板里的确认按钮
  await page.mouse.move(Math.round(confirmRect.x + confirmRect.w / 2), Math.round(confirmRect.y + confirmRect.h / 2));
  await page.mouse.down();
  await page.mouse.up();
  await sleep(180);
  check('click(确认按钮)：closePopup 回 menu', (await snapshot()).state.screen === 'menu');

  // 截图：菜单（收起按下态后的正常态）
  await page.screenshot({ path: join(outDir, 'ui-demo-menu-widgets.png') });
  console.log('');
  for (const p of [join(outDir, 'ui-demo-menu-widgets.png'), join(outDir, 'ui-demo-menu-pressed.png'), draggingShot]) console.log(`截图：${p}`);
} catch (error) {
  check('验收过程中没有异常', false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close().catch(() => undefined);
}

const failed = results.filter((r) => !r.pass);
console.log('');
console.log(`真实输入验收：${results.length - failed.length} 通过 / ${failed.length} 失败`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  ✗ ${f.name}：${f.detail ?? ''}`);
  process.exitCode = 1;
}
