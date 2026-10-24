#!/usr/bin/env node
/**
 * 拼豆工坊 · 真浏览器完整一轮验收（T63，零依赖 CDP）。
 *
 * 为什么不用 puppeteer：仓库没装 puppeteer-core，`tools/verify-browser.cjs` 根本跑不起来。
 * 这里用 `templates/iaa-simple/tools/lib/harness.mjs`（Chromium + 原生 CDP WebSocket），
 * 点击走 `Input.dispatchMouseEvent` —— 浏览器里是真事件，没有「框架替我们模拟」。
 *
 * 一轮：首页 → 选关 → 盘面拖拽归位 → 熨烫（加热 + 扫板）→ 结算 → 回选关。
 * 双视口各一轮，四个时刻各截一张：盘面进行中 / 拖拽中 / 熨烫进行中 / 结算。
 *
 * 位置一律读 `__mg.geom`（由 board-geom 从 .ui 的 rects 算出）；脚本不复制几何公式，
 * 否则「脚本绿了游戏坏了」就是必然。
 *
 * 用法：node tools/verify-flow.mjs [--url http://127.0.0.1:5288/] [--out artifacts/t63]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cleanupProfiles,
  connectToPage,
  purgeStaleProfiles,
  startChrome,
} from '../../../templates/iaa-simple/tools/lib/harness.mjs';

const arg = (name, dflt) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 || process.argv[at + 1] === undefined ? dflt : process.argv[at + 1];
};
const URL = arg('url', 'http://127.0.0.1:5288/');
const OUT = resolve(arg('out', 'artifacts/t63'));
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`);
};

const ALL_VIEWPORTS = [
  // 440×956 是用户真机报溢出时用的视口：布局验收必须带上它
  { width: 440, height: 956, tag: '440x956' },
  { width: 390, height: 844, tag: '390x844' },
  { width: 320, height: 568, tag: '320x568' },
];
const ONLY = arg('vp', '');
const VIEWPORTS = ONLY === '' ? ALL_VIEWPORTS : ALL_VIEWPORTS.filter((v) => v.tag === ONLY);
const DEBUG = process.argv.includes('--debug');
const dbg = (...a) => { if (DEBUG) console.log('[dbg]', ...a); };

const openPage = async (vp) => {
  const chrome = await startChrome({ width: vp.width, height: vp.height });
  const cdp = await connectToPage(chrome.port);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false,
  });
  await cdp.send('Page.navigate', { url: URL });
  await cdp.waitFor('!!(window.__mg && __mg.state.screen === "home")', { label: 'home' });
  await cdp.waitFor(`__mg.platform.width === ${vp.width} && __mg.platform.height === ${vp.height}`, {
    label: `viewport ${vp.width}x${vp.height}`,
    timeoutMs: 10000,
  });
  await sleep(200);
  return { cdp, close: async () => { cdp.close(); await chrome.kill(); } };
};

const mouse = (cdp, type, x, y, buttons) =>
  cdp.send('Input.dispatchMouseEvent', {
    type, x: Math.round(x), y: Math.round(y), button: 'left', buttons, clickCount: 1,
  });

const press = (cdp, x, y) => mouse(cdp, 'mousePressed', x, y, 1);
const moveTo = (cdp, x, y) => mouse(cdp, 'mouseMoved', x, y, 1);
const release = (cdp, x, y) => mouse(cdp, 'mouseReleased', x, y, 0);

const click = async (cdp, x, y) => {
  await press(cdp, x, y);
  await sleep(40);
  await release(cdp, x, y);
  await sleep(180);
};

const shot = async (cdp, file) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const path = resolve(OUT, file);
  writeFileSync(path, Buffer.from(data, 'base64'));
  return path;
};

/** 「按真事件」把一块色块拖到它该去的格：位置全部来自 __mg.geom，不自己算 */
const planDrag = (cdp, pieceId) =>
  cdp.eval(`(function(){
    var g = __mg.geom, st = __mg.state;
    if (!g || st.screen !== 'board') return { screen: st.screen };
    var p = g.pieces.find(function(q){ return q.id === ${pieceId}; });
    if (!p) return { screen: 'board', miss: true };
    var piece = st.pieces.find(function(q){ return q.id === ${pieceId}; });
    if (!piece) return { screen: 'board', miss: true };
    var taken = {};
    st.pieces.forEach(function(q){ if (q.loc.t === 'grid') taken[q.loc.i] = 1; });
    var ti = -1;
    for (var i = 0; i < st.grid.length; i++) {
      if (st.grid[i] === piece.color && taken[i] !== 1) { ti = i; break; }
    }
    if (ti < 0) return { screen: 'board', miss: true };
    var b = g.board, col = ti % 10, row = Math.floor(ti / 10);
    return {
      screen: 'board',
      sx: p.x + p.w / 2, sy: p.y + p.h / 2,
      tx: b.bx + (col + 0.5) * b.cell, ty: b.by + (row + 0.5) * b.cell,
    };
  })()`);

const dragPiece = async (cdp, pieceId, shotPath) => {
  const plan = await planDrag(cdp, pieceId);
  if (plan.screen !== 'board' || plan.miss) return plan.screen;
  await press(cdp, plan.sx, plan.sy);
  const steps = 4;
  for (let s = 1; s <= steps; s += 1) {
    await moveTo(cdp, plan.sx + ((plan.tx - plan.sx) * s) / steps, plan.sy + ((plan.ty - plan.sy) * s) / steps);
    if (shotPath !== null && s === 3) await shot(cdp, shotPath);
  }
  await release(cdp, plan.tx, plan.ty);
  await sleep(40);
  return 'board';
};

/** 熨烫页：挑「能盖住最多未定型格」的板位（在页面里算，脚本不重写覆盖逻辑） */
const planIron = (cdp) =>
  cdp.eval(`(function(){
    var st = __mg.state, g = __mg.geom;
    if (st.screen !== 'iron' || !g) return { screen: st.screen };
    var iron = st.iron, undone = [];
    for (var t = 0; t < iron.targets.length; t++) if (iron.cells[t] !== 1) undone.push(iron.targets[t]);
    var b = g.board;
    var base = { screen: 'iron', temp: iron.plate.temp, gx: iron.plate.gx, gy: iron.plate.gy,
                 bx: b.bx, by: b.by, cell: b.cell, undone: undone.length, target: null };
    if (undone.length === 0) return base;
    base.undoneIdx = undone.slice(0, 24);
    var one = 0, two = 0;
    for (var k = 0; k < iron.cells.length; k += 1) { if (iron.cells[k] === 1) one += 1; else if (iron.cells[k] === 2) two += 1; }
    base.one = one; base.two = two;
    var best = null;
    for (var gy = 0; gy <= 6; gy += 1) {
      for (var gx = 0; gx <= 6; gx += 1) {
        var cnt = 0;
        for (var u = 0; u < undone.length; u += 1) {
          var i = undone[u], c = i % 10, r = Math.floor(i / 10);
          if (c >= gx && c < gx + 4 && r >= gy && r < gy + 4) cnt += 1;
        }
        if (best === null || cnt > best.cnt) best = { gx: gx, gy: gy, cnt: cnt };
      }
    }
    base.target = best;
    return base;
  })()`);

const ironRun = async (cdp, onFirstHeat) => {
  let held = null;
  let shotDone = false;
  const letGo = async () => {
    if (held === null) return;
    await release(cdp, held.x, held.y);
    held = null;
  };
  let guard = 80;
  while (guard-- > 0) {
    const info = await planIron(cdp);
    if (info.screen !== 'iron') { await letGo(); return info.screen; }
    dbg('iron-step', JSON.stringify({ temp: Math.round(info.temp), gx: info.gx, gy: info.gy, undone: info.undone, one: info.one, two: info.two, idx: info.undoneIdx, target: info.target, held: held !== null }));
    // 温度偏高：先松手降温，等凉到 50 以下再重新按住（低温时移动不会烫糊）
    if (held !== null && info.temp >= 72) await letGo();
    if (held === null && info.temp >= 50) {
      // 降温等待放在内层循环里：外层的 guard 留给「真正换一个板位」的次数
      let cool = 40;
      while (cool-- > 0) {
        await sleep(80);
        const now = await cdp.eval('({ s: __mg.state.screen, t: __mg.state.iron.plate.temp })');
        if (now.s !== 'iron') return now.s;
        if (now.t < 50) break;
      }
      continue;
    }
    if (held === null) {
      const px = info.bx + (info.gx + 2) * info.cell;
      const py = info.by + (info.gy + 2) * info.cell;
      await press(cdp, px, py);
      held = { x: px, y: py };
      if (info.target !== null) {
        const tx = info.bx + (info.target.gx + 2) * info.cell;
        const ty = info.by + (info.target.gy + 2) * info.cell;
        for (let s = 1; s <= 3; s += 1) {
          await moveTo(cdp, px + ((tx - px) * s) / 3, py + ((ty - py) * s) / 3);
        }
        held = { x: tx, y: ty };
      }
    }
    // 按住加热：进绿窗（55–70）即定型；到 58 就松手，绝不冲过 76
    let temp = info.temp;
    while (temp < 58) {
      await sleep(30);
      const now = await cdp.eval('({ s: __mg.state.screen, t: __mg.state.iron.plate.temp })');
      if (now.s !== 'iron') { held = null; return now.s; }
      temp = now.t;
      if (!shotDone) {
        shotDone = true;
        if (onFirstHeat !== null) await onFirstHeat();
      }
    }
    await letGo();
  }
  return cdp.eval('__mg.state.screen');
};

const runViewport = async (vp) => {
  const T = `[${vp.tag}]`;
  const { cdp, close } = await openPage(vp);
  try {
    const home = await cdp.eval('({ screen: __mg.state.screen, btn: __mg.layout.primaryButton, sel: __mg.layout.secondaryButton })');
    check(`${T} 启动在首页且有「继续拼豆」`, home.screen === 'home' && home.btn !== undefined, { screen: home.screen });
    await shot(cdp, `home-${vp.tag}.png`);
    // 走「关卡选择」进选关：首页主按钮是「继续拼豆」（直进盘面），选关是次按钮
    await click(cdp, home.sel.x + home.sel.w / 2, home.sel.y + home.sel.h / 2);
    if (DEBUG) {
      const diag = await cdp.eval('({ platform: __mg.platform, screen: __mg.state.screen, errors: __mg.errors, assets: __mg.assets })');
      dbg('after-home-click', JSON.stringify(diag));
    }
    await cdp.waitFor('__mg.state.screen === "select"', { label: 'select' });

    const grid = await cdp.eval('__mg.layout.grid');
    await click(cdp, grid.x + grid.w / 6, grid.y + grid.h / 6);
    await cdp.waitFor('__mg.state.screen === "board"', { label: 'board' });
    const board = await cdp.eval('({ n: __mg.state.pieces.length, errors: __mg.errors, geo: !!__mg.geom })');
    check(`${T} 进盘面：有色块 / 布局 0 错 / 几何可用`, board.n > 0 && board.errors.length === 0 && board.geo, board);

    // 拖一块，并在拖拽途中截一张
    const firstId = await cdp.eval('(__mg.geom.pieces.find(function(q){ return q.where === "pool"; }) || {}).id');
    await dragPiece(cdp, firstId, `board-drag-${vp.tag}.png`);
    const placed1 = await cdp.eval('__mg.state.pieces.filter(function(q){ return q.placed; }).length');
    check(`${T} 真拖一块到正确格 → placed = 1`, placed1 === 1, { placed: placed1 });
    const boardShot = await shot(cdp, `board-${vp.tag}.png`);

    // 剩下的块逐块拖完；时间快见底就点「+10秒」（真按钮，顺带验证道具条）
    let guard = 400;
    let topUps = 0;
    while (guard-- > 0) {
      const step = await cdp.eval(`(function(){
        var st = __mg.state;
        if (st.screen !== 'board') return { screen: st.screen };
        var p = st.pieces.find(function(q){ return !q.placed; });
        return { screen: 'board', id: p ? p.id : -1, timeLeft: st.timeLeft, bar: __mg.layout.secondaryButton };
      })()`);
      if (step.screen !== 'board') break;
      if (step.id < 0) break;
      if (step.timeLeft < 25 && step.bar !== undefined && topUps < 6) {
        topUps += 1;
        await click(cdp, step.bar.x + step.bar.w / 2, step.bar.y + step.bar.h / 2);
        continue;
      }
      const screen = await dragPiece(cdp, step.id, null);
      if (screen !== 'board') break;
    }
    const afterBoard = await cdp.eval('({ screen: __mg.state.screen, placed: __mg.state.pieces.filter(function(q){ return q.placed; }).length, total: __mg.state.pieces.length })');
    check(`${T} 全部归位 → 自动进熨烫屏`, afterBoard.screen === 'iron' && afterBoard.placed === afterBoard.total, afterBoard);

    const ironShot = { path: null };
    const outro = await ironRun(cdp, async () => {
      ironShot.path = await shot(cdp, `iron-${vp.tag}.png`);
    });
    check(`${T} 熨烫截图确实在 iron 屏内截到`, ironShot.path !== null && outro !== 'iron');
    check(`${T} 熨烫跑完 → 离开 iron 屏`, outro !== 'iron', { screen: outro });

    const result = await cdp.eval(`(function(){
      var st = __mg.state;
      return { screen: st.screen, outcome: st.outcome, toast: st.toast,
               burnt: st.iron.cells.filter(function(c){ return c === 2; }).length, cells: st.iron.cells.length };
    })()`);
    const resultShot = await shot(cdp, `result-${vp.tag}.png`);
    // 结算页布局自检：对话框必须**居中且占 60–70% 高**，不允许被遮罩 fill 挤到下半屏
    const dialog = await cdp.eval(`(function(){
      var r = __mg.layout.dialogPanel, b = __mg.layout.backdropMask;
      var vp = __mg.platform;
      return { dialog: r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null,
               backdrop: b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null,
               vp: { w: vp.width, h: vp.height } };
    })()`);
    const d = dialog.dialog;
    const centered = d !== null
      && Math.abs(d.x + d.w / 2 - dialog.vp.w / 2) < 2
      && Math.abs(d.y + d.h / 2 - dialog.vp.h / 2) < 2;
    check(`${T} 结算对话框居中且占视口 50–70% 高`, centered && d !== null && d.h / dialog.vp.h > 0.5 && d.h / dialog.vp.h < 0.7, dialog);
    check(`${T} 结算遮罩铺满全屏（不是半屏）`, dialog.backdrop !== null && dialog.backdrop.h >= dialog.vp.h - 1, dialog.backdrop);
    check(`${T} 结算屏有 outcome`, result.screen === 'result' && result.outcome !== null, result);
    check(`${T} 熨烫定型到底（outcome = win）`, result.outcome === 'win', { outcome: result.outcome, burnt: result.burnt, cells: result.cells });

    const back = await cdp.eval('__mg.layout.secondaryButton');
    if (back === undefined) {
      check(`${T} 结算页有「选关」按钮`, false);
    } else {
      await click(cdp, back.x + back.w / 2, back.y + back.h / 2);
      await cdp.waitFor('__mg.state.screen === "select"', { label: 'back to select', timeoutMs: 8000 });
      check(`${T} 结算页「选关」→ 回选关`, true);
    }
    console.log(`截图 ${boardShot} / ${ironShot.path} / ${resultShot}`);
  } catch (error) {
    check(`${T} 流程没有抛异常`, false, error instanceof Error ? error.message : String(error));
  } finally {
    await close();
  }
};

mkdirSync(OUT, { recursive: true });
purgeStaleProfiles();
for (const vp of VIEWPORTS) await runViewport(vp);
await cleanupProfiles();
const failed = results.filter((r) => !r.pass);
writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({ url: URL, results, failed: failed.length }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;

