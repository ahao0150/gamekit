#!/usr/bin/env node
/**
 * ui-demo 的运行时验收（T10 ②）：界面真跑在浏览器里，通过调试 MCP 驱动。
 *
 * 不是单测：spawn 一个 `mg-debug-mcp` 子进程、走 MCP stdio 协议、和浏览器里真实
 * 运行的游戏通过 WebSocket 通信。断言：
 *
 *   1. `canvas()`   → 尺寸 / dpr 对
 *   2. `tree()`     → 界面都能看到真实绘制记录（按界面文案辨认）
 *   3. `screenshot()` → 每个界面一张 PNG
 *   4. `click()`    → 真实 pointer 事件完成 menu → play → result → menu
 *   5. popup 三条命中语义（T13c）：遮罩吃掉 / 底层按钮被挡 / 确认按钮生效
 *   6. inventory（T13d）：列表真的画出来、点第 3 项、返回
 *
 * 前置：`mg dev` 已起、`tools/open-game.mjs` 已打开页面（游戏会自己连 7788）。
 *
 * 用法：node games/ui-demo/tools/verify-runtime.mjs
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectMcp } from './mcp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const outDir = join(repoRoot, 'out', 'debug');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : `（${detail}）`}`);
};

const mcp = await connectMcp(repoRoot, 'verify-ui-demo-runtime');
const rawCall = mcp.callTool;

/** 调试服务端只保留一个「当前客户端」：bridge 重连瞬间在飞的请求会被判「连接断开」，重试一次。 */
const callTool = async (name, args = {}) => {
  try {
    return await rawCall(name, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('连接断开')) throw error;
    await sleep(1500);
    return rawCall(name, args);
  }
};

const readState = async () => JSON.parse(await callTool('state'));
const readTree = async (limit = 2) => JSON.parse(await callTool('tree', { limit }));
const latestTexts = (tree) => (tree.latest?.calls ?? []).filter((c) => c.kind === 'text').map((c) => c.text);

/** 点一个组件的中心（坐标来自游戏侧 layout 快照，不是写死的）。 */
const clickComponent = async (name) => {
  const tree = await readTree(1);
  const rect = tree.layout?.[name];
  if (rect === undefined) throw new Error(`当前界面布局里没有组件 ${name}：${Object.keys(tree.layout ?? {}).join(', ')}`);
  const x = Math.round(rect.x + rect.w / 2);
  const y = Math.round(rect.y + rect.h / 2);
  await callTool('click', { x, y });
  await sleep(220);
  return { x, y };
};

const shot = async (name) => {
  const text = await callTool('screenshot', { name });
  const path = /已截图：(.+)/.exec(text)?.[1]?.trim() ?? '';
  const ok = existsSync(path) && readFileSync(path).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  check(`screenshot ${name} 落 PNG 且文件头正确`, ok, path);
  return path;
};

/**
 * 轮询 canvas，直到「稳定实例」连上：390×844 @ dpr 2 连续多次一致。
 *
 * 页面首次加载时视口覆盖还没生效（临时 1262×752），旧实例会先连上 —— 在它身上
 * 开始验收，后面 reload 一到状态全丢。
 */
const waitForGame = async (timeoutMs = 90000) => {
  const started = Date.now();
  let last = '';
  let prevKey = '';
  let stable = 0;
  const keyOf = (text) => {
    const match = /画面 (\d+×\d+) 逻辑像素，dpr=(\d+(?:\.\d+)?)/.exec(text);
    return match === null ? '' : `${match[1]}@${match[2]}`;
  };
  while (Date.now() - started < timeoutMs) {
    try {
      const text = await callTool('canvas');
      const key = keyOf(text);
      if (key === '390×844@2' && key === prevKey) {
        stable += 1;
        if (stable >= 2) return text;
      } else {
        stable = 0;
      }
      prevKey = key;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      if (!last.includes('没连上')) throw error;
      prevKey = '';
      stable = 0;
    }
    await sleep(500);
  }
  throw new Error(`等了 ${timeoutMs}ms 游戏还是没稳定连上（要求 390×844@2 连续 3 次）：${last}`);
};

try {
  mkdirSync(outDir, { recursive: true });
  check('MCP initialize 成功', mcp.init.result?.serverInfo?.name === 'mg-debug-mcp', JSON.stringify(mcp.init.result?.serverInfo));

  const canvasText = await waitForGame();
  check('canvas() 尺寸 390×844', /画面 390×844/.test(canvasText), canvasText.split('\n')[0]);
  check(
    'canvas() 带 dpr 与帧率',
    /dpr=(\d+(?:\.\d+)?)/.test(canvasText) && /帧率 [\d.]+ fps/.test(canvasText),
    canvasText.split('\n').slice(0, 2).join(' / '),
  );

  // ---------------------------------------------------------------- menu（T13d 通用组件）
  const menuState = await readState();
  check('menu：初始界面是主菜单', menuState.screen === 'menu', JSON.stringify(menuState.screen));
  const menuTree = await readTree(2);
  const menuTexts = latestTexts(menuTree);
  check('menu：tree() 有绘制记录', (menuTree.latest?.calls ?? []).length > 0, `${menuTree.latest?.calls?.length ?? 0} 次绘制`);
  check(
    'menu：能认出标题与三个入口文字（通用组件真的画了）',
    menuTexts.includes('UI 链验证 Demo') && menuTexts.includes('开始') && menuTexts.includes('打开背包') && menuTexts.includes('打开弹窗'),
    menuTexts.slice(0, 5).join(' / '),
  );
  check('menu：tree() 带布局树（可与绘制矩形对比）', menuTree.layout !== null && typeof menuTree.layout === 'object', Object.keys(menuTree.layout ?? {}).join(' / '));
  const menuShot = await shot('ui-demo-menu');

  // ---------------------------------------------------------------- inventory（T13d）
  await clickComponent('primaryButton');
  const invState = await readState();
  check('inventory：menu 点「打开背包」进入背包', invState.screen === 'inventory', JSON.stringify(invState.screen));
  const invTree = await readTree(1);
  const invTexts = latestTexts(invTree);
  const invLayout = invTree.layout ?? {};
  check(
    'inventory：列表与滚动条都在布局里（list 高度接近整屏）',
    invLayout['list'] !== undefined && invLayout['scrollbar'] !== undefined && invLayout['list'].h > 390,
    `list=${JSON.stringify(invLayout['list'])} bar=${JSON.stringify(invLayout['scrollbar'])}`,
  );
  check(
    'inventory：列表项文字由 renderItem 真实画出（前 3 项）',
    invTexts.includes('物品 01  ×1') && invTexts.includes('物品 02  ×8') && invTexts.includes('物品 03  ×2'),
    invTexts.slice(0, 5).join(' / '),
  );
  // 点第 3 项（下标 2）：坐标 = 列表顶 + 2.5 个项高
  const listRect = invLayout['list'];
  const itemY = Math.round(listRect.y + 56 * 2 + 28);
  await callTool('click', { x: Math.round(listRect.x + listRect.w / 2), y: itemY });
  await sleep(220);
  const afterItemClick = await readState();
  check('click(列表第 3 项)：selected 变成 2', afterItemClick.selected === 2, `点 ${itemY} → selected=${afterItemClick.selected}`);
  const invStatus = latestTexts(await readTree(1));
  check('inventory：选中后状态文字跟着变', invStatus.some((t) => t.startsWith('已选：物品 03')), invStatus.join(' / '));
  const invShot = await shot('ui-demo-inventory');

  await clickComponent('button');
  const backState = await readState();
  check('inventory：点「返回」回到 menu，选中清空', backState.screen === 'menu' && backState.selected === null, JSON.stringify(backState.selected));

  // ---------------------------------------------------------------- popup（T13c：层级 + 命中真实点击）
  await clickComponent('secondaryButton');
  const popupState = await readState();
  check('popup：menu 点「打开弹窗」进入 popup 界面', popupState.screen === 'popup', JSON.stringify(popupState.screen));

  const popupTree = await readTree(1);
  const popupLayout = popupTree.layout ?? {};
  const maskRect = popupLayout['infoPanel'];
  const baseBtnRect = popupLayout['secondaryButton'];
  const confirmBtnRect = popupLayout['primaryButton'];
  check(
    'popup：布局含遮罩 / 底层按钮 / 确认按钮，且遮罩盖满视口',
    maskRect !== undefined &&
      baseBtnRect !== undefined &&
      confirmBtnRect !== undefined &&
      Math.round(maskRect.w) === 390 &&
      Math.round(maskRect.h) === 844,
    `mask=${JSON.stringify(maskRect)} base=${JSON.stringify(baseBtnRect)} confirm=${JSON.stringify(confirmBtnRect)}`,
  );

  // 绘制顺序：tree() 的 calls 就是真实绘制顺序，base 的按钮必须早于 overlay 的文字
  const popupTexts = latestTexts(popupTree);
  const baseTextAt = popupTexts.indexOf('底层按钮（遮罩盖住）');
  const confirmTextAt = popupTexts.indexOf('确定');
  check('popup：绘制顺序 base 在前、overlay 在后（paintOrder 生效）', baseTextAt >= 0 && confirmTextAt > baseTextAt, `文字顺序：${popupTexts.join(' / ')}`);

  // ① 点遮罩空白处（左上角、面板外）：hit block 吃掉点击，状态必须不变
  await callTool('click', { x: 5, y: 5 });
  await sleep(220);
  const afterMaskClick = await readState();
  check(
    'click(遮罩空白 5,5)：被 hit block 吃掉，状态不变',
    afterMaskClick.screen === 'popup' && afterMaskClick.hits === 0,
    `${popupState.screen} → ${afterMaskClick.screen}`,
  );

  // ② 点底层按钮自己的位置：它在 base 层、绑定 closePopup（会生效的动作），
  //    但遮罩盖着 → 应该被挡住、不触发（若穿透就会回 menu）
  const baseX = Math.round(baseBtnRect.x + baseBtnRect.w / 2);
  const baseY = Math.round(baseBtnRect.y + baseBtnRect.h / 2);
  await callTool('click', { x: baseX, y: baseY });
  await sleep(220);
  const afterBaseClick = await readState();
  check(
    'click(底层按钮位置)：遮罩挡住穿透，底层按钮不触发（仍在 popup）',
    afterBaseClick.screen === 'popup',
    `点 ${baseX},${baseY} → ${afterBaseClick.screen}`,
  );

  const popupShot = await shot('ui-demo-popup');

  // ③ 点面板里的确认按钮：hit self → closePopup 回 menu
  const confirmX = Math.round(confirmBtnRect.x + confirmBtnRect.w / 2);
  const confirmY = Math.round(confirmBtnRect.y + confirmBtnRect.h / 2);
  await callTool('click', { x: confirmX, y: confirmY });
  await sleep(260);
  const afterConfirm = await readState();
  check('click(确认按钮)：触发 closePopup，回到 menu', afterConfirm.screen === 'menu', `点 ${confirmX},${confirmY} → ${afterConfirm.screen}`);

  // ---------------------------------------------------------------- play
  const menuClick = await clickComponent('button');
  const playState = await readState();
  check('click(开始)：menu → play', playState.screen === 'play', `${afterConfirm.screen} → ${playState.screen}（点 ${menuClick.x},${menuClick.y}）`);
  const playTree = await readTree(2);
  const playTexts = latestTexts(playTree);
  check('play：能认出 HUD / 目标 / 放弃文字', playTexts.includes('点目标 3 次') && playTexts.includes('放弃') && playTexts.includes('0 / 3'), playTexts.slice(0, 5).join(' / '));
  const playShot = await shot('ui-demo-play');

  // 点目标 3 次：每次都要走真实 pointer，hits 必须递增
  const hitsSeen = [];
  for (let i = 1; i <= 3; i += 1) {
    await clickComponent('tapTarget');
    const state = await readState();
    hitsSeen.push(state.hits);
  }
  check('click(tapTarget)×3：命中数递增 1→2→3', JSON.stringify(hitsSeen) === '[1,2,3]', hitsSeen.join(' → '));
  const resultState = await readState();
  check('第 3 次命中后进结算', resultState.screen === 'result', JSON.stringify(resultState.screen));

  // ---------------------------------------------------------------- result
  const resultTexts = latestTexts(await readTree(2));
  check(
    'result：能认出成绩 / 评级 / 按钮文字',
    resultTexts.includes('完成！') && resultTexts.includes('3 / 3') && resultTexts.includes('完美') && resultTexts.includes('再来一次'),
    resultTexts.slice(0, 5).join(' / '),
  );
  const resultShot = await shot('ui-demo-result');

  const againClick = await clickComponent('primaryButton');
  const againState = await readState();
  check('click(再来一次)：result → menu', againState.screen === 'menu', `${resultState.screen} → ${againState.screen}（点 ${againClick.x},${againClick.y}）`);
  const backTexts = latestTexts(await readTree(2));
  check('回到 menu 后界面文案跟着变回主菜单', backTexts.includes('UI 链验证 Demo') && !backTexts.includes('完成！'), backTexts.slice(0, 3).join(' / '));

  console.log('');
  for (const path of [menuShot, invShot, popupShot, playShot, resultShot]) console.log(`截图：${path}`);
} catch (error) {
  check('验收过程中没有异常', false, error instanceof Error ? error.message : String(error));
} finally {
  mcp.close();
}

const failed = results.filter((r) => !r.pass);
console.log('');
console.log(`运行时验收：${results.length - failed.length} 通过 / ${failed.length} 失败`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  ✗ ${f.name}：${f.detail ?? ''}`);
  console.log('--- debug-mcp stderr ---');
  for (const line of mcp.stderrLines.slice(-80)) console.log(line);
  process.exitCode = 1;
}
