#!/usr/bin/env node
/**
 * T65 验收（真浏览器，零依赖 CDP）：IAA 变现 + 存档 + 音效接线。
 *
 * 关键测试缝：脚本在页面加载**之前**注入 `globalThis.__mgForceAds = true`，
 * main.ts 只在 `mg dev` 下据此给 web 平台补一个「一定会成功」的激励视频
 * （画布/指针/存档仍是真 web 平台），所以「广告看完 → 发奖励」这条路径能真跑。
 *
 * 覆盖：
 * 1. 首页有音效/音乐开关；关掉音效
 * 2. 第 1 关**没有**广告入口（布局里没有那三个按钮 + entries 全 disabled/first-level）
 * 3. 真打完第 1 关 → 解锁第 2 关、clears=1
 * 4. 第 2 关有 3 个广告入口；点「提示」→ mock 广告返回 → 位置被锁 + 次数 -1
 * 5. 提示用满 3 次后第 4 次按钮禁用（点也不再生效）
 * 6. 刷新页面 → 进度/开关从存档恢复
 * 7. 双视口截图（首关无广告入口 / 第二关有广告按钮 各一张对照）
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanupProfiles, connectToPage, purgeStaleProfiles, startChrome } from '../../../templates/iaa-simple/tools/lib/harness.mjs';

const arg = (name, dflt) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 || process.argv[at + 1] === undefined ? dflt : process.argv[at + 1];
};
const URL = arg('url', 'http://127.0.0.1:5288/');
const OUT = resolve(arg('out', 'artifacts/t65'));
const SAVE_KEY = 'pindou-workshop.data';
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`);
};

const openPage = async (vp, { keepSave = false } = {}) => {
  const chrome = await startChrome({ width: vp.width, height: vp.height });
  const cdp = await connectToPage(chrome.port);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // 测试缝必须在任何脚本之前注入
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'globalThis.__mgForceAds = true;' });
  let clearScriptId = null;
  if (!keepSave) {
    const added = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.removeItem('${SAVE_KEY}'); } catch (e) {}`,
    });
    clearScriptId = added.identifier;
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: URL });
  await cdp.waitFor('!!(window.__mg && __mg.state.screen === "home")', { label: 'home' });
  await cdp.waitFor(`__mg.platform.width === ${vp.width}`, { label: 'viewport' });
  await sleep(250);
  return {
    cdp,
    close: async () => { cdp.close(); await chrome.kill(); },
    /** 撤销「新文档清档」脚本（reload 前必须调，否则会把刚写的存档清掉） */
    dropClearScript: async () => {
      if (clearScriptId === null) return;
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clearScriptId });
      clearScriptId = null;
    },
  };
};

const shot = async (cdp, file) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const path = resolve(OUT, file);
  writeFileSync(path, Buffer.from(data, 'base64'));
  return path;
};
const mouse = (cdp, type, x, y, buttons) =>
  cdp.send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons, clickCount: 1 });
const press = (cdp, x, y) => mouse(cdp, 'mousePressed', x, y, 1);
const moveTo = (cdp, x, y) => mouse(cdp, 'mouseMoved', x, y, 1);
const release = (cdp, x, y) => mouse(cdp, 'mouseReleased', x, y, 0);
const click = async (cdp, x, y) => { await press(cdp, x, y); await sleep(40); await release(cdp, x, y); await sleep(200); };
const clickRect = async (cdp, rect) => click(cdp, rect.x + rect.w / 2, rect.y + rect.h / 2);

const planPiece = (cdp, pieceId) =>
  cdp.eval(`(function(){
    const st = __mg.state, g = __mg.geom;
    const p = g.pieces.find((q) => q.id === ${pieceId});
    const piece = st.pieces.find((q) => q.id === ${pieceId});
    const taken = {}; st.pieces.forEach((q) => { if (q.loc.t === 'grid') taken[q.loc.i] = 1; });
    let good = -1;
    for (let i = 0; i < st.grid.length; i += 1) {
      if (taken[i] === 1) continue;
      if (st.grid[i] === piece.color) { good = i; break; }
    }
    const b = g.board;
    return { sx: p.x + p.w / 2, sy: p.y + p.h / 2, good,
             tx: good < 0 ? 0 : b.bx + (good % 10 + 0.5) * b.cell,
             ty: good < 0 ? 0 : b.by + (Math.floor(good / 10) + 0.5) * b.cell };
  })()`);

const dragPiece = async (cdp, id) => {
  const plan = await planPiece(cdp, id);
  if (plan.good < 0) return false;
  await press(cdp, plan.sx, plan.sy);
  for (let s = 1; s <= 3; s += 1) await moveTo(cdp, plan.sx + ((plan.tx - plan.sx) * s) / 3, plan.sy + ((plan.ty - plan.sy) * s) / 3);
  await release(cdp, plan.tx, plan.ty);
  await sleep(25);
  return true;
};

/** 把当前关拼完（真拖拽）后熨烫到结算 */
const playThrough = async (cdp) => {
  let guard = 400;
  while (guard-- > 0) {
    const step = await cdp.eval(`(function(){
      const st = __mg.state;
      if (st.screen !== 'board') return { screen: st.screen };
      const p = st.pieces.find((q) => !q.placed);
      return { screen: 'board', id: p ? p.id : -1, timeLeft: st.timeLeft, bar: __mg.layout.toolBar || __mg.layout.secondaryButton };
    })()`);
    if (step.screen !== 'board' || step.id < 0) break;
    if (step.timeLeft < 20) break; // 时间不够就交给失败路径，验收只关心过关的那次
    if (!(await dragPiece(cdp, step.id))) break;
  }
  await cdp.waitFor('__mg.state.screen === "iron"', { label: 'iron', timeoutMs: 15000 });
  let guard2 = 80;
  while (guard2-- > 0 && (await cdp.eval('__mg.state.screen')) === 'iron') {
    // 先降到绿窗以下再按（按着不放会一路升到 120，把没定型的格全烫糊）
    let cool = 40;
    while (cool-- > 0) {
      if ((await cdp.eval('__mg.state.iron.plate.temp')) < 52) break;
      await sleep(80);
    }
    const pc = await cdp.eval(`(function(){ const p = __mg.state.iron.plate, b = __mg.geom.board; return { x: b.bx + (Math.round(p.gx) + 2) * b.cell, y: b.by + (Math.round(p.gy) + 2) * b.cell }; })()`);
    // 挑一块**纯未烫**（0）的格；1/2 都是终态，不能当目标
    const target = await cdp.eval(`(function(){
      const st = __mg.state, iron = st.iron, b = __mg.geom.board;
      const at = iron.cells.findIndex((c) => c === 0);
      if (at < 0) return null;
      const i = iron.targets[at], c = i % 10, r = Math.floor(i / 10);
      return { gx: Math.max(0, Math.min(6, c - 2)), gy: Math.max(0, Math.min(6, r - 2)), bx: b.bx, by: b.by, cell: b.cell };
    })()`);
    if (target === null) break;
    const tx = target.bx + (target.gx + 2) * target.cell;
    const ty = target.by + (target.gy + 2) * target.cell;
    await press(cdp, pc.x, pc.y);
    for (let s = 1; s <= 3; s += 1) await moveTo(cdp, pc.x + ((tx - pc.x) * s) / 3, pc.y + ((ty - pc.y) * s) / 3);
    // 低温暖机（这段时间不烫糊），进绿窗就松手
    let k = 120;
    while (k-- > 0) {
      const t = await cdp.eval('__mg.state.iron.plate.temp');
      if (t >= 58) break;
      if (t > 72) break;
      await sleep(40);
    }
    await release(cdp, tx, ty);
    await sleep(120);
  }  await cdp.waitFor('__mg.state.screen === "result"', { label: 'result', timeoutMs: 15000 });
  return cdp.eval('({ outcome: __mg.state.outcome, unlocked: __mg.state.unlocked, clears: __mg.state.clears })');
};

const runViewport = async (vp) => {
  const T = `[${vp.width}x${vp.height}]`;
  const { cdp, close, dropClearScript } = await openPage(vp);
  let homeShot = null;
  let firstShot = null;
  let adsShot = null;
  try {
    // 1) 首页：音效/音乐开关
    const layout = await cdp.eval('__mg.layout');
    check(`${T} 首页有音效开关与音乐开关`, layout.soundToggle !== undefined, {
      soundToggle: layout.soundToggle !== undefined,
    });
    homeShot = await shot(cdp, `home-${vp.width}x${vp.height}.png`);
    const soundBefore = await cdp.eval('__mg.state.sound');
    if (layout.soundToggle) await clickRect(cdp, layout.soundToggle);
    const soundAfter = await cdp.eval('__mg.state.sound');
    const musicAfter = await cdp.eval('__mg.state.music');
    check(`${T} 声音开关能切（true→false，且 music 同值）`, soundBefore === true && soundAfter === false && musicAfter === false, { soundBefore, soundAfter, musicAfter });

    // 2) 第 1 关：没有广告入口
    const startBtn = await cdp.eval('__mg.layout.primaryButton');
    await clickRect(cdp, startBtn);
    await cdp.waitFor('__mg.state.screen === "board"', { label: 'board' });
    const lvl1 = await cdp.eval('({ levelId: __mg.state.levelId, adBtns: [!!__mg.layout.secondaryButton, !!__mg.layout.primaryButton, !!__mg.layout.button], entries: __mg.ads.entries, canRewarded: __mg.ads.canRewarded, toolBar: !!__mg.layout.toolBar })');
    firstShot = await shot(cdp, `board-level1-${vp.width}x${vp.height}.png`);
    check(`${T} 首关不放广告入口（没有按钮 + entries 全 first-level）`,
      lvl1.levelId === 1 && lvl1.adBtns.every((b) => b === false) && lvl1.entries.every((e) => e.reason === 'first-level'),
      { levelId: lvl1.levelId, adBtns: lvl1.adBtns, reasons: lvl1.entries.map((e) => e.reason) });
    check(`${T} 首关仍保留道具带占位（toolBar 有矩形）`, lvl1.toolBar === true);

    // 3) 真打完第 1 关
    const won1 = await playThrough(cdp);
    check(`${T} 打完第 1 关 → 解锁第 2 关、clears=1`, won1.outcome === 'win' && won1.unlocked === 2 && won1.clears === 1, won1);

    // 4) 进第 2 关：三个广告入口可用
    const nextBtn = await cdp.eval('__mg.layout.primaryButton');
    await clickRect(cdp, nextBtn);
    await cdp.waitFor('__mg.state.levelId === 2 && __mg.state.screen === "board"', { label: 'level2' });
    const lvl2 = await cdp.eval('({ levelId: __mg.state.levelId, entries: __mg.ads.entries, hint: __mg.layout.secondaryButton, time: __mg.layout.primaryButton, slot: __mg.layout.button })');
    adsShot = await shot(cdp, `board-level2-ads-${vp.width}x${vp.height}.png`);
    check(`${T} 第 2 关有 3 个广告入口且都可点`, lvl2.entries.length === 3 && lvl2.entries.every((e) => e.enabled), {
      enabled: lvl2.entries.map((e) => e.enabled), labels: lvl2.entries.map((e) => e.label),
    });

    // 5) 点提示 → mock 广告返回 → 位置被锁
    const before = await cdp.eval('({ placed: __mg.state.pieces.filter((p) => p.placed).length, hint: __mg.state.itemLeft.hint, hinted: __mg.state.hinted.length })');
    await clickRect(cdp, lvl2.hint);
    await cdp.waitFor(`__mg.state.hinted.length === ${before.hinted + 1}`, { label: 'hint applied', timeoutMs: 8000 });
    const afterHint = await cdp.eval('({ placed: __mg.state.pieces.filter((p) => p.placed).length, hint: __mg.state.itemLeft.hint, hinted: __mg.state.hinted, toast: __mg.state.toast })');
    check(`${T} 点提示 → 广告返回 → 真的锁了一格（placed +1、hinted +1、次数 -1）`,
      afterHint.placed === before.placed + 1 && afterHint.hint === before.hint - 1 && afterHint.hinted.length === 1,
      { before, after: { placed: afterHint.placed, hint: afterHint.hint, hinted: afterHint.hinted }, toast: afterHint.toast });

    // 6) 用满 3 次 → 按钮禁用，第 4 次点不动
    for (let i = 0; i < 2; i += 1) {
      await clickRect(cdp, lvl2.hint);
      await sleep(500);
    }
    const exhausted = await cdp.eval('({ entries: __mg.ads.entries, hintLeft: __mg.state.itemLeft.hint, hinted: __mg.state.hinted.length })');

    const beforeFourth = await cdp.eval('__mg.state.hinted.length');
    await clickRect(cdp, lvl2.hint);
    await sleep(600);
    const afterFourth = await cdp.eval('({ hinted: __mg.state.hinted.length, toast: __mg.state.toast })');
    check(`${T} 提示用满 3 次 → 按钮禁用（第 4 次不再生效）`,
      exhausted.hintLeft === 0 && exhausted.entries[0].enabled === false && exhausted.entries[0].reason === 'used-up' && afterFourth.hinted === beforeFourth,
      { hintLeft: exhausted.hintLeft, reason: exhausted.entries[0].reason, beforeFourth, afterFourth: afterFourth.hinted });
    check(`${T} 续时/扩位次数仍在（只掉提示）`, exhausted.entries[1].enabled === true && exhausted.entries[2].enabled === true);

    // 7) 刷新页面 → 存档恢复
    // 刷新前必须撤掉「新文档清档」脚本，否则 reload 会把刚写的存档再清一遍（T65 踩过）
    await dropClearScript();
    await cdp.send('Page.reload', {});
    await cdp.waitFor('!!(window.__mg && __mg.state.screen === "home")', { label: 'reload home', timeoutMs: 15000 });
    await sleep(300);
    const restored = await cdp.eval('({ unlocked: __mg.state.unlocked, clears: __mg.state.clears, sound: __mg.state.sound, key: localStorage.getItem("' + SAVE_KEY + '") !== null })');
    check(`${T} 刷新后进度与开关从存档恢复（unlocked=2 / clears=1 / 音效关）`,
      restored.unlocked === 2 && restored.clears === 1 && restored.sound === false && restored.key === true, restored);
    const selectShot = await shot(cdp, `select-after-reload-${vp.width}x${vp.height}.png`);
    console.log('截图', [homeShot, firstShot, adsShot, selectShot].join(' / '));
  } catch (error) {
    check(`${T} 流程没有抛异常`, false, error instanceof Error ? error.message : String(error));
  } finally {
    await close();
  }
};

mkdirSync(OUT, { recursive: true });
purgeStaleProfiles();
for (const vp of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  await runViewport(vp);
}
await cleanupProfiles();
const failed = results.filter((r) => !r.pass);
writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({ results, failed: failed.length }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
