#!/usr/bin/env node
/**
 * 第二轮动效的**真浏览器验收**：画面像素在页面内用 rAF 逐帧采样。
 *
 * 为什么不用 CDP 逐帧截图：单帧截图 ≥200ms，而锁定高光 160ms、放错闪红 60ms —— 
 * 截图只能抓到末态，判据必红（全是假阳性）。页面内 rAF + getImageData 单帧 <1ms，
 * 抓到的是**画到画布上的像素**（不是状态）。
 *
 * 覆盖：① 拿起跟手 ② 跟手高亮 ③ 归位高光 ④ 放错闪红/残影 ⑤ 熨烫扫过着色
 *      ⑥ 温度三态配色 ⑦ 烫糊熔痕 + 累积告警暗角
 *
 * 用法：node tools/verify-juice.mjs [--url http://127.0.0.1:5288/] [--out artifacts/t63]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanupProfiles, connectToPage, purgeStaleProfiles, startChrome } from '../../../templates/iaa-simple/tools/lib/harness.mjs';

const arg = (name, dflt) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 || process.argv[at + 1] === undefined ? dflt : process.argv[at + 1];
};
const URL = arg('url', 'http://127.0.0.1:5288/');
const OUT = resolve(arg('out', 'artifacts/t63'));
const W = 390;
const H = 844;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`);
};

const chrome = await startChrome({ width: W, height: H });
const cdp = await connectToPage(chrome.port);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: URL });
await cdp.waitFor('!!(window.__mg && __mg.state.screen === "home")', { label: 'home' });
await cdp.waitFor(`__mg.platform.width === ${W}`, { label: 'viewport' });
await sleep(200);

await cdp.eval(`(() => {
  const canvas = () => document.querySelector('canvas');
  window.__stat = (x, y, w, h) => {
    const ctx = canvas().getContext('2d');
    const d = ctx.getImageData(Math.max(0, Math.round(x)), Math.max(0, Math.round(y)), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data;
    let r = 0, g = 0, b = 0, n = 0, maxL = 0, bright = 0, red = 0, white = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      r += R; g += G; b += B; n += 1;
      const L = 0.299 * R + 0.587 * G + 0.114 * B;
      if (L > maxL) maxL = L;
      if (L > 120) bright += 1;
      if (R > G + 40 && R > B + 40) red += 1;
      if (R > 225 && G > 225 && B > 225) white += 1;
    }
    return { r: r / n, g: g / n, b: b / n, maxL, bright, red, white, n };
  };
  window.__sample = async (count, x, y, w, h) => {
    const out = [];
    for (let i = 0; i < count; i += 1) {
      await new Promise((ok) => requestAnimationFrame(ok));
      out.push(window.__stat(x, y, w, h));
    }
    return out;
  };
  /** 温度条「实际画出来的那一条」的指针颜色（bar 带比条高，直接按带取会采到背景） */
  /** 在矩形里找最亮的像素：温度条指针位置靠公式算容易偏 3px，扫最亮像素更稳 */
  window.__brightest = (x, y, w, h) => {
    const ctx = canvas().getContext('2d');
    const d = ctx.getImageData(Math.max(0, Math.round(x)), Math.max(0, Math.round(y)), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    let best = { r: 0, g: 0, b: 0, maxL: -1, px: 0, py: 0 };
    for (let j = 0; j < d.height; j += 1) {
      for (let i = 0; i < d.width; i += 1) {
        const k = (j * d.width + i) * 4;
        const R = d.data[k], G = d.data[k + 1], B = d.data[k + 2];
        const L = 0.299 * R + 0.587 * G + 0.114 * B;
        if (L > best.maxL) best = { r: R, g: G, b: B, maxL: L, px: Math.round(x) + i, py: Math.round(y) + j };
      }
    }
    return best;
  };
  window.__sample2 = async (count, a, b) => {
    const out = [];
    for (let i = 0; i < count; i += 1) {
      await new Promise((ok) => requestAnimationFrame(ok));
      out.push({ a: window.__stat(a.x, a.y, a.w, a.h), b: window.__stat(b.x, b.y, b.w, b.h) });
    }
    return out;
  };
  window.__tempPointer = () => {
    // 用**画出来**的温度（fx.temp 是平滑后的值）：拿 state 的原始温度算指针 x 会偏 3px 采到背景
    const b = __mg.geom.tempBar, t = __mg.fx.temp, max = 120;
    const h = Math.max(6, Math.min(14, b.h));
    const y = b.y + (b.h - h) / 2;
    const x = b.x + Math.min(max, Math.max(0, t)) / max * b.w;
    // 指针 4px 宽、条高 6–14px：在「指针 x ± 5px × 整条高」里取最亮像素
    const s = window.__brightest(x - 5, y, 11, h);
    return { temp: Math.round(t), r: s.r, g: s.g, b: s.b, at: [s.px, s.py] };
  };
  return true;
})()`);

const shot = async (file) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const path = resolve(OUT, file);
  writeFileSync(path, Buffer.from(data, 'base64'));
  return path;
};
const mouse = (type, x, y, buttons) =>
  cdp.send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons, clickCount: 1 });
const press = (x, y) => mouse('mousePressed', x, y, 1);
const moveTo = (x, y) => mouse('mouseMoved', x, y, 1);
const release = (x, y) => mouse('mouseReleased', x, y, 0);
const click = async (x, y) => { await press(x, y); await sleep(40); await release(x, y); await sleep(160); };
const sample = (count, x, y, w, h) => cdp.eval(`window.__sample(${count}, ${x}, ${y}, ${w}, ${h})`);

const planPiece = (pieceId) =>
  cdp.eval(`(function(){
    const st = __mg.state, g = __mg.geom;
    const p = g.pieces.find((q) => q.id === ${pieceId});
    const piece = st.pieces.find((q) => q.id === ${pieceId});
    const taken = {}; st.pieces.forEach((q) => { if (q.loc.t === 'grid') taken[q.loc.i] = 1; });
    let good = -1, bad = -1;
    for (let i = 0; i < st.grid.length; i += 1) {
      if (taken[i] === 1) continue;
      if (st.grid[i] === piece.color) { if (good < 0) good = i; }
      else if (st.grid[i] >= 0 && st.grid[i] !== piece.color && bad < 0) bad = i;
    }
    const b = g.board;
    const at = (i) => ({ x: b.bx + (i % 10 + 0.5) * b.cell, y: b.by + (Math.floor(i / 10) + 0.5) * b.cell });
    return { sx: p.x + p.w / 2, sy: p.y + p.h / 2, color: piece.color, good, bad, cell: b.cell,
             goodPt: good < 0 ? null : at(good), badPt: bad < 0 ? null : at(bad) };
  })()`);

const dragTo = async (from, to, steps = 3) => {
  await press(from.x, from.y);
  for (let s = 1; s <= steps; s += 1) await moveTo(from.x + ((to.x - from.x) * s) / steps, from.y + ((to.y - from.y) * s) / steps);
};

// ---------- 进盘面 ----------
const homeBtn = await cdp.eval('__mg.layout.primaryButton');
await click(homeBtn.x + homeBtn.w / 2, homeBtn.y + homeBtn.h / 2);
await cdp.waitFor('__mg.state.screen === "select"', { label: 'select' });
const grid = await cdp.eval('__mg.layout.grid');
await click(grid.x + grid.w / 6, grid.y + grid.h / 6);
await cdp.waitFor('__mg.state.screen === "board"', { label: 'board' });

// ---------- ① 拿起跟手 + ② 跟手高亮 ----------
const firstId = await cdp.eval('__mg.geom.pieces.find((q) => q.where === "pool").id');
const plan = await planPiece(firstId);
const box = { x: plan.goodPt.x - plan.cell / 2, y: plan.goodPt.y - plan.cell / 2, w: plan.cell, h: plan.cell };
const bigBox = { x: box.x - 10, y: box.y - 10, w: box.w + 20, h: box.h + 20 };
const base = (await sample(1, bigBox.x, bigBox.y, bigBox.w, bigBox.h))[0];
await dragTo({ x: plan.sx, y: plan.sy }, plan.goodPt);
const dragFrames = await sample(14, bigBox.x, bigBox.y, bigBox.w, bigBox.h);
const dragShot = await shot('juice-drag-390x844.png');
check('① 拿起跟手：拖到目标格后画出被拖色块（格内最大亮度抬升）',
  dragFrames[dragFrames.length - 1].maxL > base.maxL + 30,
  { baseMax: Math.round(base.maxL), dragMax: Math.round(Math.max(...dragFrames.map((f) => f.maxL))) });
check('② 跟手高亮：同色目标格出现光晕（亮像素数上升）',
  dragFrames[dragFrames.length - 1].bright > base.bright,
  { baseBright: base.bright, dragBright: dragFrames[dragFrames.length - 1].bright });
console.log('截图', dragShot);

// ---------- ③ 归位成功：白色高光 0 → 峰值 → 衰减 ----------
await release(plan.goodPt.x, plan.goodPt.y);
const lockFrames = await sample(16, bigBox.x, bigBox.y, bigBox.w, bigBox.h);
const lockPeak = Math.max(...lockFrames.map((f) => f.white));
const lockLast = lockFrames[lockFrames.length - 1].white;
check('③ 归位高光：锁定瞬间出现近白高光，160ms 内衰减回去',
  lockPeak > base.white + 20 && lockLast < lockPeak,
  { baseWhite: base.white, lockPeak, lockLast });
check('③ 归位：状态里那块真的 placed（动效没有替代判定）',
  (await cdp.eval('__mg.state.pieces.filter((q) => q.placed).length')) === 1);

// ---------- ④ 落位错误：全屏闪红 + 单格闪红 + 状态不变 ----------
const second = await planPiece(await cdp.eval('__mg.geom.pieces.find((q) => q.where === "pool").id'));
const badBox = { x: second.badPt.x - second.cell / 2, y: second.badPt.y - second.cell / 2, w: second.cell, h: second.cell };
const beforeBad = await cdp.eval('({ placed: __mg.state.pieces.filter((q) => q.placed).length, toast: __mg.state.toast })');
await dragTo({ x: second.sx, y: second.sy }, second.badPt);
await release(second.badPt.x, second.badPt.y);
const both = await cdp.eval(`window.__sample2(12, ${JSON.stringify({ x: 8, y: 120, w: 40, h: 40 })}, ${JSON.stringify(badBox)})`);
const flashFrames = both.map((f) => f.a); // 远离错误格：只有全屏闪会抬红通道
const rejectFrames = both.map((f) => f.b);
const afterBad = await cdp.eval('({ placed: __mg.state.pieces.filter((q) => q.placed).length, toast: __mg.state.toast })');
check('④ 放错：全屏闪红（远处置红通道抬升）',
  Math.max(...flashFrames.map((f) => f.r)) > 28,
  { rPeak: Math.round(Math.max(...flashFrames.map((f) => f.r))) });
check('④ 放错：错误格闪红 + 残影（格内偏红像素出现）',
  Math.max(...rejectFrames.map((f) => f.red)) > 20,
  { redPeak: Math.max(...rejectFrames.map((f) => f.red)) });
check('④ 放错：状态没变（仍是 1 块归位 + 出现提示语）',
  afterBad.placed === beforeBad.placed && afterBad.toast !== beforeBad.toast,
  { before: beforeBad, after: afterBad });

// ---------- 收尾进熨烫 ----------
let guard = 300;
while (guard-- > 0) {
  const step = await cdp.eval(`(function(){
    const st = __mg.state;
    if (st.screen !== 'board') return { screen: st.screen };
    const p = st.pieces.find((q) => !q.placed);
    return { screen: 'board', id: p ? p.id : -1, timeLeft: st.timeLeft, bar: __mg.layout.secondaryButton };
  })()`);
  if (step.screen !== 'board' || step.id < 0) break;
  if (step.timeLeft < 25 && step.bar) { await click(step.bar.x + step.bar.w / 2, step.bar.y + step.bar.h / 2); continue; }
  const pl = await planPiece(step.id);
  if (pl.good < 0) break;
  await dragTo({ x: pl.sx, y: pl.sy }, pl.goodPt, 2);
  await release(pl.goodPt.x, pl.goodPt.y);
  await sleep(25);
}
await cdp.waitFor('__mg.state.screen === "iron"', { label: 'iron', timeoutMs: 15000 });

// ---------- ⑤⑥⑦ 熨烫段 ----------
const ironPlan = await cdp.eval(`(function(){
  const st = __mg.state, g = __mg.geom, b = g.board, iron = st.iron;
  const plate = iron.plate;
  const p0 = { gx: Math.round(plate.gx), gy: Math.round(plate.gy) };
  // 选一个「一开始不在板下」的目标格，先量它的未烫颜色
  let victim = -1;
  for (const i of iron.targets) {
    const c = i % 10, r = Math.floor(i / 10);
    if (c >= p0.gx + 4 || c < p0.gx || r >= p0.gy + 4 || r < p0.gy) { victim = i; break; }
  }
  const vc = victim % 10, vr = Math.floor(victim / 10);
  // 烫糊用：在未定型目标里挑覆盖最多的 4×4 窗口（最多 16 格 = 25% < 30% 失败线）
  const undone = [];
  for (let t = 0; t < iron.targets.length; t += 1) if (iron.cells[t] !== 1) undone.push(iron.targets[t]);
  let best = { gx: 0, gy: 0, cnt: -1 };
  for (let gy = 0; gy <= 6; gy += 1) for (let gx = 0; gx <= 6; gx += 1) {
    let cnt = 0;
    for (const i of undone) { const c = i % 10, r = Math.floor(i / 10); if (c >= gx && c < gx + 4 && r >= gy && r < gy + 4) cnt += 1; }
    if (cnt > best.cnt) best = { gx, gy, cnt };
  }
  return { bx: b.bx, by: b.by, cell: b.cell, plate: p0, total: iron.targets.length,
           victim: { i: victim, x: b.bx + vc * b.cell, y: b.by + vr * b.cell, w: b.cell - 2, h: b.cell - 2 },
           burn: best };
})()`);
const cold = (await sample(1, ironPlan.victim.x, ironPlan.victim.y, ironPlan.victim.w, ironPlan.victim.h))[0];
check('⑤ 熨烫前：目标格是「未烫」深灰（三通道接近、整体偏暗）',
  Math.abs(cold.r - cold.b) < 18 && cold.maxL < 120,
  { r: Math.round(cold.r), g: Math.round(cold.g), b: Math.round(cold.b), maxL: Math.round(cold.maxL) });

const plateCenter = () => cdp.eval(`(function(){ const p = __mg.state.iron.plate, b = __mg.geom.board; return { x: b.bx + (Math.round(p.gx) + 2) * b.cell, y: b.by + (Math.round(p.gy) + 2) * b.cell, temp: p.temp }; })()`);
const plateTo = async (gx, gy) => {
  const here = await plateCenter();
  const tx = ironPlan.bx + (gx + 2) * ironPlan.cell;
  const ty = ironPlan.by + (gy + 2) * ironPlan.cell;
  for (let s = 1; s <= 3; s += 1) await moveTo(here.x + ((tx - here.x) * s) / 3, here.y + ((ty - here.y) * s) / 3);
  return { x: tx, y: ty };
};

// 加热：琥珀档（49–55）与绿窗档（57–66）各读一次指针颜色
let pc = await plateCenter();
await press(pc.x, pc.y);
let warn = null;
let ok = null;
let guard2 = 240;
while (guard2-- > 0) {
  await sleep(50);
  const tp = await cdp.eval('window.__tempPointer()');
  if (warn === null && tp.temp >= 49 && tp.temp <= 54) warn = tp;
  if (tp.temp >= 57 && tp.temp <= 66) { ok = tp; break; }
}
check('⑥ 温度窗：琥珀档指针偏琥珀（R > B）', warn !== null && warn.r > warn.b, warn);
check('⑥ 温度窗：绿窗档指针偏绿（G 最高）', ok !== null && ok.g > ok.r && ok.g > ok.b, ok);
await shot('juice-iron-ok-390x844.png');

// 绿窗时把板扫到 victim 格 → 定型（⑤），然后移开板再取样
const victimGx = Math.max(0, Math.min(6, (ironPlan.victim.i % 10) - 2));
const victimGy = Math.max(0, Math.min(6, Math.floor(ironPlan.victim.i / 10) - 2));
await plateTo(victimGx, victimGy);
await sleep(220);
let moved = await plateTo(0, 0);
await release(moved.x, moved.y);
await sleep(260);
const warm = (await sample(2, ironPlan.victim.x, ironPlan.victim.y, ironPlan.victim.w, ironPlan.victim.h)).pop();
check('⑤ 熨烫扫过：被扫过的格由深灰变暖褐（R 明显高于 B）',
  warm.r > warm.b + 25,
  { r: Math.round(warm.r), g: Math.round(warm.g), b: Math.round(warm.b) });

// 超温（>76）扫一次 → 烫糊（⑦）；只扫一个窗口，控制烫糊率 < 30%
const coolDown = async () => {
  let k = 80;
  while (k-- > 0) {
    if ((await cdp.eval('__mg.state.iron.plate.temp')) < 52) return true;
    await sleep(60);
  }
  return false;
};
await coolDown();
pc = await plateCenter();
await press(pc.x, pc.y);
let guard3 = 240;
while (guard3-- > 0) {
  await sleep(50);
  if ((await cdp.eval('__mg.state.iron.plate.temp')) > 80) break;
}
const hot = await cdp.eval('window.__tempPointer()');
check('⑥ 温度窗：超温档指针偏朱砂（R 最高）', hot.r > hot.g && hot.r > hot.b, hot);
const burnWin = await cdp.eval(`(function(){
  const st = __mg.state, iron = st.iron, undone = [];
  for (let t = 0; t < iron.targets.length; t += 1) if (iron.cells[t] !== 1) undone.push(iron.targets[t]);
  let best = { gx: 2, gy: 2, cnt: -1 };
  for (let gy = 0; gy <= 6; gy += 1) for (let gx = 0; gx <= 6; gx += 1) {
    let cnt = 0;
    for (const i of undone) { const c = i % 10, r = Math.floor(i / 10); if (c >= gx && c < gx + 4 && r >= gy && r < gy + 4) cnt += 1; }
    if (cnt > best.cnt) best = { gx, gy, cnt };
  }
  return { ...best, undone: undone.length };
})()`);
// 关键：超温状态下**一次跳到**目标窗口。沿途每一跳都会把路径上的格烫糊，
// 分段移动会把烫糊率推过 30% 失败线（实测 22/64 = 34% 直接判负）。
const destX = ironPlan.bx + (burnWin.gx + 2) * ironPlan.cell;
const destY = ironPlan.by + (burnWin.gy + 2) * ironPlan.cell;
await moveTo(destX, destY);
await sleep(240);
const atBurn = await cdp.eval('({ temp: Math.round(__mg.state.iron.plate.temp), gx: Math.round(__mg.state.iron.plate.gx), gy: Math.round(__mg.state.iron.plate.gy), aligned: __mg.state.iron.plate.aligned })');
console.log('[dbg] 扫烫糊窗口前', JSON.stringify({ win: burnWin, atBurn }));
await release(destX, destY);
const afterBurn = await cdp.eval(`(function(){
  const st = __mg.state, cells = st.iron.cells;
  let burnt = 0, done = 0;
  for (const c of cells) { if (c === 2) burnt += 1; else if (c === 1) done += 1; }
  const at = cells.findIndex((c) => c === 2);
  return { screen: st.screen, burnt, done, total: cells.length, rate: burnt / Math.max(1, cells.length), burntIndex: at };
})()`);
check('⑦ 烫糊：超温扫过把格子烫糊（出现 2 态），且没超过 30% 失败线',
  afterBurn.burnt > 0 && afterBurn.screen === 'iron',
  { burnt: afterBurn.burnt, done: afterBurn.done, rate: Number(afterBurn.rate.toFixed(2)), screen: afterBurn.screen, atBurn });

// 降温后把板移开，再量烫糊格与角落暗角
const dbgBurn = await cdp.eval(`(function(){
  const st = __mg.state, cells = st.iron.cells;
  const at = cells.findIndex((c) => c === 2);
  const i = at < 0 ? -1 : st.iron.targets[at];
  const b = __mg.geom && __mg.geom.board;
  let px = null;
  if (i >= 0 && b) {
    const c = i % 10, r = Math.floor(i / 10);
    const s = window.__stat(b.bx + c * b.cell, b.by + r * b.cell, b.cell - 2, b.cell - 2);
    px = [Math.round(s.r), Math.round(s.g), Math.round(s.b)];
  }
  return { canvases: document.querySelectorAll('canvas').length, screen: st.screen, burnt: cells.filter((c) => c === 2).length,
           burntCell: i, px, clock: Math.round(st.iron.clock), cellAt: at < 0 ? null : Math.round(st.iron.cellAt[at]) };
})()`);
console.log('[dbg] 烫糊刚结束', JSON.stringify(dbgBurn));
await coolDown();
const stillIron = await cdp.eval('__mg.state.screen === "iron"');
if (stillIron) {
  pc = await plateCenter();
  await press(pc.x, pc.y);
  moved = await plateTo(0, 0);
  await release(moved.x, moved.y);
}
const dbg2 = await cdp.eval(`(function(){
  const st = __mg.state;
  return { screen: st.screen, geom: !!__mg.geom, temp: Math.round(st.iron.plate.temp),
           burnt: st.iron.cells.filter((c) => c === 2).length, done: st.iron.cells.filter((c) => c === 1).length,
           gx: Math.round(st.iron.plate.gx), gy: Math.round(st.iron.plate.gy), outcome: st.outcome };
})()`);
console.log('[dbg] 烫糊格取样前', JSON.stringify(dbg2));
const burntPx = await cdp.eval(`(function(){
  const st = __mg.state;
  if (!__mg.geom || st.screen !== 'iron') return null;
  const b = __mg.geom.board;
  const at = st.iron.cells.findIndex((c) => c === 2);
  if (at < 0) return null;
  const i = st.iron.targets[at], c = i % 10, r = Math.floor(i / 10);
  const s = window.__stat(b.bx + c * b.cell, b.by + r * b.cell, b.cell - 2, b.cell - 2);
  return { r: Math.round(s.r), g: Math.round(s.g), b: Math.round(s.b), maxL: Math.round(s.maxL) };
})()`);
const burnShot = await shot('juice-iron-burn-390x844.png');
check('⑦ 烫糊格：焦褐色（暗且 R ≥ G ≥ B）',
  burntPx !== null && burntPx.maxL < 150 && burntPx.r >= burntPx.g && burntPx.g >= burntPx.b, burntPx);

const alertExpected = afterBurn.rate >= 0.18;
const corners = await sample(4, 6, 6, 30, 30);
const cornerL = corners.reduce((a, f) => a + f.maxL, 0) / corners.length;
check('⑦ 累积告警：烫糊率 ≥18% 时四角出现暗角（角落变暗）',
  !alertExpected || cornerL < 90,
  { rate: Number(afterBurn.rate.toFixed(2)), alertExpected, cornerMaxL: Math.round(cornerL) });
console.log('截图', burnShot);

cdp.close();
await chrome.kill();
await cleanupProfiles();
mkdirSync(OUT, { recursive: true });
const failed = results.filter((r) => !r.pass);
writeFileSync(resolve(OUT, 'juice-report.json'), JSON.stringify({ results, failed: failed.length }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
