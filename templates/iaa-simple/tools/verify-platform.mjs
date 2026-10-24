/**
 * 平台适配端到端回归门禁。
 *
 * 目标不是"再验一遍能玩"，而是让两类真实缺陷以后**不可能再溜过去**：
 *   A. dpr 变换缺失（backing 是 CSS×dpr，但没建立 setTransform(dpr,…)）
 *      → 画面只占左上角 1/dpr²，点击与画面差 dpr 倍。dpr=1 完全看不出来。
 *   B. 窄视口画布被裁（CSS 写死设计尺寸，视口比它小就点不到底部）
 *
 * 矩阵：dpr 五档 × 两种视口 × 两种模式（build 产物 / mg dev）= 20 个组合。
 * 每个组合断言四条：
 *   1. backing 契约：canvas.width === round(cssWidth × dpr)（height 同理）
 *   2. ctx.getTransform().a === dpr 且 .d === dpr —— dpr bug 的直接守卫
 *   3. opaqueRatio > 0.9 —— 整张画布真落笔，不是只剩左上角
 *   4. 点主按钮命中（分数前进）
 * 外加**反例自检**：手动把变换打回 identity 重绘一次，断言 opaqueRatio
 * 掉到 ≈1/dpr² —— 证明第 3 条的门槛真的能抓到错，不是又一次假阳性。
 * 再加一条**门禁自检**：坏状态下「变换 = dpr」与「覆盖率 > 0.9」两条断言
 * 必须同时报红 —— 门禁自己也要能证明它抓得住错。
 *
 * 用法：
 *   node tools/verify-platform.mjs [--repo <仓库根>] [--out <报告目录>] [--rebuild] [--keep]
 *   （--keep：跑完保留临时游戏项目 games/mg-m5，默认跑完就删）
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  startStaticServer,
  startChrome,
  connectToPage,
  cleanupProfiles,
  purgeStaleProfiles,
} from './lib/harness.mjs';
import { startMgDev, ensureProject, removeProject } from './lib/devserver.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const REPO = resolve(flag('repo', join(import.meta.dirname, '../../..')));
const OUT_DIR = resolve(flag('out', join(import.meta.dirname, 'out')));
const REBUILD = args.includes('--rebuild');
/** --keep：保留临时游戏项目（默认跑完就删，不留垃圾）。 */
const KEEP = args.includes('--keep');

/** dpr 五档：1 是基准，1.25/1.5 是常见安卓密度，2/3 是主流高密度屏。 */
const DPRS = [1, 1.25, 1.5, 2, 3];
/** 两种视口：设计尺寸 + 窄屏（比设计窄，画布必须缩而不是被裁）。 */
const VIEWPORTS = [
  { name: 'design', width: 390, height: 844 },
  { name: 'narrow', width: 320, height: 480 },
];

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** 一次读全：backing、css 尺寸、当前变换、整画布不透明率。 */
const PROBE = `(() => {
  const c = document.querySelector('canvas');
  if (!c) return { error: '页面里没有 canvas' };
  const ctx = c.getContext('2d');
  if (!ctx) return { error: 'canvas 没有 2d 上下文' };
  const t = ctx.getTransform();
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque += 1;
  const total = c.width * c.height;
  return {
    backing: [c.width, c.height], css: [c.clientWidth, c.clientHeight],
    transform: [t.a, t.d], dpr: window.devicePixelRatio,
    opaque, total, opaqueRatio: total > 0 ? opaque / total : 0,
    scripts: Array.from(document.scripts).map((s) => s.src),
    href: location.href,
    mg: window.__mg ? {
      screen: [window.__mg.platform.width, window.__mg.platform.height],
      score: window.__mg.state.score, hint: window.__mg.state.hint,
    } : null,
  };
})()`;

/**
 * 手动把变换打回 identity，**并清空整张 backing**。
 *
 * 为什么必须清空：只打掉变换的话，之前按 dpr 画好的画面还留在 backing 上，
 * 整张画布依旧「有内容」→ 测不出错位。清空后按 identity 重绘，
 * 才复现出「画面只占左上角 1/dpr²」的真实现场。
 */
const BREAK_TRANSFORM = `(() => {
  const c = document.querySelector('canvas');
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  return true;
})()`;

const realClick = async (cdp, x, y) => {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};

const results = [];
let failures = 0;

const record = (label, pass, detail) => {
  if (!pass) failures += 1;
  results.push({ label, pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${label}  ${JSON.stringify(detail)}`);
};

/** 跑一个组合：起独立 Chrome → 四条断言 → 反例自检 → 关掉。 */
const runCase = async ({ mode, url, viewport, dpr }) => {
  const label = `[${mode} ${viewport.name} ${viewport.width}x${viewport.height} dpr${dpr}]`;
  const chrome = await startChrome({ width: viewport.width, height: viewport.height });
  const cdp = await connectToPage(chrome.port);
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width, height: viewport.height, deviceScaleFactor: dpr, mobile: false,
    });
    await cdp.send('Page.navigate', { url });
    await cdp.waitFor('!!window.__mg', { label: `${label} 只读钩子出现` });
    await cdp.waitFor('window.__mg.platform.width > 0', { label: `${label} 平台就绪` });
    await sleep(250); // 等一帧，确保已经画过

    const probe = await cdp.eval(PROBE);
    if (probe.error) {
      record(`${label} 探针`, false, probe);
      return;
    }

    // 断言 1：backing 契约
    // 用 getBoundingClientRect 的**未取整**宽高：clientWidth 已被浏览器取整
    // （例：布局宽 221.6 → clientWidth 222），而 backing 是按未取整值算的，
    // 直接用 clientWidth 会差 1 像素。允许 ±1 的容差。
    const box = await cdp.eval(
      `(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, top: r.top }; })()`,
    );
    const expectW = Math.round(box.w * dpr);
    const expectH = Math.round(box.h * dpr);
    record(
      `${label} backing = CSS×dpr`,
      Math.abs(probe.backing[0] - expectW) <= 1 && Math.abs(probe.backing[1] - expectH) <= 1,
      {
        backing: probe.backing, cssLayout: [box.w, box.h], cssClient: probe.css,
        expect: [expectW, expectH], dpr, diff: [probe.backing[0] - expectW, probe.backing[1] - expectH],
      },
    );

    // 断言 2：变换已建立（dpr bug 的直接守卫）
    record(
      `${label} ctx 变换 = dpr`,
      Math.abs(probe.transform[0] - dpr) < 1e-6 && Math.abs(probe.transform[1] - dpr) < 1e-6,
      { transform: probe.transform, dpr, expect: [dpr, dpr] },
    );

    // 断言 3：整画布真落笔
    record(
      `${label} 整画布不透明率 > 0.9`,
      probe.opaqueRatio > 0.9,
      { opaqueRatio: probe.opaqueRatio, opaque: probe.opaque, total: probe.total },
    );

    // 断言 4：点主按钮命中
    const before = probe.mg?.score ?? 0;
    const layout = await cdp.eval('window.__mg.layout');
    const btn = layout.tapButton;
    const x = Math.round(box.left + btn.x + btn.w / 2);
    const y = Math.round(box.top + btn.y + btn.h / 2);
    await realClick(cdp, x, y);
    await cdp.waitFor(`window.__mg.state.score > ${before}`, { label: `${label} 分数前进` });
    const after = await cdp.eval('window.__mg.state.score');
    record(`${label} 点主按钮命中`, after === before + 1, { before, after, clickAt: { x, y } });

    // 反例自检：把变换打回 identity，画面应缩到左上角 1/dpr²
    if (dpr > 1) {
      await cdp.eval(BREAK_TRANSFORM);
      await sleep(250); // 等一帧重绘
      const broken = await cdp.eval(PROBE);
      const expect = 1 / (dpr * dpr);
      record(
        `${label} 反例：打掉变换后不透明率掉到 ≈1/dpr²`,
        broken.opaqueRatio < 0.9 && Math.abs(broken.opaqueRatio - expect) < 0.12,
        { afterBreak: broken.opaqueRatio, expectApprox: expect, transformNow: broken.transform },
      );
    }
  } finally {
    cdp.close();
    await chrome.kill();
  }
};

/**
 * 门禁自检：故意把 dpr 变换打断，门禁**必须**报红。
 *
 * 为什么要有这条：门禁自己也可能是假阳性。团队踩过一次 ——
 * 「RGB ≠ 背景色」判不出透明像素，实现错了测试照样绿。
 * 所以门禁要能证明自己抓得住错：这里人为制造「画面只占左上角 1/dpr²」
 * 的坏状态，断言「变换 = dpr」和「覆盖率 > 0.9」两条**必须**失败。
 * 这两条同时红，才说明门禁不是又一次假阳性。
 */
const runNegativeCase = async ({ url, viewport, dpr }) => {
  const label = `[反例 ${viewport.name} ${viewport.width}x${viewport.height} dpr${dpr}]`;
  const chrome = await startChrome({ width: viewport.width, height: viewport.height });
  const cdp = await connectToPage(chrome.port);
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width, height: viewport.height, deviceScaleFactor: dpr, mobile: false,
    });
    await cdp.send('Page.navigate', { url });
    await cdp.waitFor('!!window.__mg', { label: `${label} 只读钩子出现` });
    await cdp.waitFor('window.__mg.platform.width > 0', { label: `${label} 平台就绪` });
    await sleep(250);

    await cdp.eval(BREAK_TRANSFORM);
    await sleep(250);
    const broken = await cdp.eval(PROBE);

    const transformBad =
      !(Math.abs(broken.transform[0] - dpr) < 1e-6 && Math.abs(broken.transform[1] - dpr) < 1e-6);
    const opaqueBad = !(broken.opaqueRatio > 0.9);
    record(
      `${label} 坏状态被门禁抓住（变换与覆盖率两条都要红）`,
      transformBad && opaqueBad,
      {
        transformNow: broken.transform, transformExpect: [dpr, dpr],
        opaqueRatio: broken.opaqueRatio, coverageThreshold: 0.9, expectApprox: 1 / (dpr * dpr),
      },
    );
  } finally {
    cdp.close();
    await chrome.kill();
  }
};

purgeStaleProfiles();
const { projectDir } = ensureProject(REPO, { rebuild: REBUILD });
console.log(`游戏项目：${projectDir}`);

const staticServer = await startStaticServer(join(projectDir, 'build', 'web'));
let dev = null;
try {
  dev = await startMgDev(projectDir, REPO);
  console.log(`mg dev：${dev.url}（--port ${dev.port} --strict-port，归属确定）`);
  await mkdir(OUT_DIR, { recursive: true });

  // dev 模式的入口形态：module 脚本 + HMR 客户端（缺一说明 dev 链路没通）
  const devScripts = [...dev.html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  record(
    '[dev] 首页含 module 入口与 HMR 客户端',
    dev.html.includes('type="module"') &&
      dev.html.includes('/src/main.ts') &&
      dev.html.includes('/@vite/client'),
    { scripts: devScripts, url: dev.url },
  );

  const modes = [
    { mode: 'build', url: staticServer.url },
    { mode: 'dev', url: dev.url },
  ];
  for (const m of modes) {
    for (const viewport of VIEWPORTS) {
      for (const dpr of DPRS) {
        await runCase({ mode: m.mode, url: m.url, viewport, dpr });
      }
    }
  }

  // 门禁自检：坏状态必须被抓住（否则门禁自己是假阳性）
  await runNegativeCase({
    url: staticServer.url,
    viewport: { name: 'design', width: 390, height: 844 },
    dpr: 2,
  });

  const report = {
    ok: failures === 0,
    cases: results.length,
    failed: failures,
    matrix: { dprs: DPRS, viewports: VIEWPORTS, modes: modes.map((m) => m.mode) },
    results,
  };
  const reportPath = join(OUT_DIR, 'verify-platform.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n${results.length - failures}/${results.length} 条通过；报告：${reportPath}`);
} catch (err) {
  console.error('验证失败：', err);
  failures += 1;
} finally {
  if (dev) await dev.stop();
  await staticServer.close();
  await cleanupProfiles();
  if (KEEP) {
    console.log(`静态服务与 dev server 已关闭；临时项目保留在 ${projectDir}`);
  } else {
    const removed = removeProject(REPO);
    console.log(`静态服务与 dev server 已关闭；临时项目${removed ? '已删除' : '删除失败（下次会再清）'}。`);
  }
}

process.exit(failures === 0 ? 0 : 1);
