/**
 * M5 集成验证：真浏览器里真能玩。
 *
 * 验收目标（DESIGN §9 第 2 条）：模板 iaa-simple 在真 web 浏览器里跑通
 * 「点按钮 → 分数增加 → 存档 → 刷新后分数还在」。
 *
 * 每个视口都跑这套断言：
 *   1. 画布完整落在视口内（窄视口被裁是曾经的真实缺陷）
 *   2. 点主按钮后分数确实变了（读页面运行时状态，不是从截图猜）
 *   3. 底部按钮可点（画布底部的「看广告」按钮，web 无广告能力，用 hint 变化证明点击被接收）
 *   4. localStorage 里确实有存档、且内容能解析
 *   5. Canvas 真实绘制发生过：采样按钮区域的像素，存在非背景色像素
 *   6. 刷新页面后分数还在（这才是存档的真正验证）
 *
 * 手法约束：
 * - 点击走 CDP `Input.dispatchMouseEvent`（浏览器原生输入管线），
 *   **不调用游戏内的 tap() 调试钩子**；
 * - 状态只从只读钩子 `window.__mg` 读，它没有 setter、不能改状态；
 * - 像素只从 canvas 的 getImageData 读，证明「真的画了」，不是「数据对」。
 *
 * 用法：
 *   node tools/verify-web.mjs [--root <web 产物目录>] [--out <输出目录>] [--dpr <覆盖像素比>]
 *
 * --dpr 说明：headless Chrome 在 deviceScaleFactor>1 时，
 * captureScreenshot 会按 N 倍尺寸输出、却仍按 1x 渲染内容（画布缩在左上角）。
 * 那是 Chrome 的行为，不是页面问题。所以逻辑验证用各视口自带的 dpr，
 * 交付截图用 --dpr 1 再跑一遍拿 1:1 的图。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startStaticServer, startChrome, connectToPage, cleanupProfiles, purgeStaleProfiles } from './lib/harness.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const REPO = resolve(flag('repo', join(import.meta.dirname, '../../..')));
const WEB_DIR = resolve(flag('root', join(REPO, 'games/mg-m5/build/web')));
const OUT_DIR = resolve(flag('out', join(import.meta.dirname, 'out')));
const DPR_OVERRIDE = Number(flag('dpr', '0')) || 0;

/** 两个视口：常见手机比例 + 窄屏（360×640，用来抓「画布被裁、底部点不到」）。 */
const VIEWPORTS = [
  { name: 'wide', width: 430, height: 932, dpr: 3 },
  { name: 'narrow', width: 360, height: 640, dpr: 2 },
];

/** 真实点击：原生鼠标事件，不走游戏内调试钩子。 */
const realClick = async (cdp, x, y) => {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};

const DOM_INFO = `(() => {
  const list = Array.from(document.querySelectorAll('canvas'));
  const c = list[0];
  const r = c ? c.getBoundingClientRect() : null;
  return {
    innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio,
    canvasCount: list.length,
    canvas: c ? { id: c.id, attrW: c.getAttribute('width'), attrH: c.getAttribute('height'),
      backingW: c.width, backingH: c.height, cssW: c.clientWidth, cssH: c.clientHeight,
      rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null } : null,
  };
})()`;

const STORAGE_INFO = `(() => {
  const out = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    const raw = localStorage.getItem(key);
    // core/save 存的是「信封 JSON 字符串」，web 的 storage.set 又 JSON.stringify 了一次，
    // 所以最多解两层（core/save 自己也「最多解两层」）
    let value = raw; let depth = 0; let ok = true;
    while (typeof value === 'string' && depth < 2) {
      try { value = JSON.parse(value); depth += 1; } catch (e) { ok = false; break; }
    }
    out.push({ key, raw, ok, depth, value });
  }
  return out;
})()`;

const PIXEL_INFO = `(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return { error: '页面里没有 canvas' };
  const ctx = canvas.getContext('2d');
  if (!ctx) return { error: 'canvas 没有 2d 上下文' };
  const r = window.__mg.layout.tapButton;
  // 布局是画布局部坐标，backing store 是 CSS×dpr 的设备像素，换算比例从画布实测
  const box = canvas.getBoundingClientRect();
  const sx = canvas.width / box.width;
  const sy = canvas.height / box.height;
  const px = Math.round(r.x * sx); const py = Math.round(r.y * sy);
  const pw = Math.max(1, Math.round(r.w * sx)); const ph = Math.max(1, Math.round(r.h * sy));
  const data = ctx.getImageData(px, py, pw, ph).data;
  // **必须看 alpha**：没画到的像素是 (0,0,0,0)，它的 RGB 也不等于背景色，
  // 只按 RGB 判会把「整块透明」误判成「画过了」——dpr 变换缺失时正是这个情况
  // （画面只占左上角 1/dpr²）。所以这里分两个口径：
  //   opaque = alpha>0 的像素（真的落笔了）
  //   ink    = alpha>0 且 RGB 不是背景色（画了，且画的是别的东西）
  let opaque = 0; let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) {
      opaque += 1;
      if (Math.abs(data[i] - 15) > 8 || Math.abs(data[i + 1] - 21) > 8 || Math.abs(data[i + 2] - 27) > 8) ink += 1;
    }
  }
  const total = pw * ph;
  const all = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let allOpaque = 0; let allInk = 0;
  for (let i = 0; i < all.length; i += 4) {
    if (all[i + 3] > 0) {
      allOpaque += 1;
      if (Math.abs(all[i] - 15) > 8 || Math.abs(all[i + 1] - 21) > 8 || Math.abs(all[i + 2] - 27) > 8) allInk += 1;
    }
  }
  const allTotal = canvas.width * canvas.height;
  return {
    canvasW: canvas.width, canvasH: canvas.height, cssW: canvas.clientWidth, cssH: canvas.clientHeight,
    scaleX: sx, scaleY: sy, sample: { x: px, y: py, w: pw, h: ph },
    opaque, ink, total, opaqueRatio: opaque / total, inkRatio: ink / total,
    allOpaque, allInk, allTotal, allOpaqueRatio: allOpaque / allTotal, allInkRatio: allInk / allTotal,
  };
})()`;

const server = await startStaticServer(WEB_DIR);
let chrome = null;
let cdp = null;
const viewportResults = [];

// 启动先清掉上轮遗留的临时目录（那时没有文件锁，一定删得掉）
purgeStaleProfiles();

try {
  console.log(`静态服务：${server.url}（根目录 ${WEB_DIR}）`);
  chrome = await startChrome({ width: 430, height: 932 });
  await mkdir(OUT_DIR, { recursive: true });

  for (const vp of VIEWPORTS) {
    const dpr = DPR_OVERRIDE > 0 ? DPR_OVERRIDE : vp.dpr;
    const checks = [];
    const record = (name, pass, detail) => {
      checks.push({ name, pass, detail });
      console.log(`${pass ? 'PASS' : 'FAIL'}  [${vp.name}] ${name}  ${JSON.stringify(detail)}`);
    };

    /**
     * 每个视口起**独立的 Chrome 实例**。
     * 原因：headless Chrome 在同一个实例里切换 device metrics 之后，
     * canvas 的 2D 内容会被 GPU 丢弃，getImageData 读回全空（像素断言假失败）。
     * 单独跑第二个视口时正常、跟在第一个视口后面就空 —— 是环境坑，不是页面问题。
     * 一个视口一个干净实例，结果才可复现。
     */
    chrome = await startChrome({ width: vp.width, height: vp.height });
    cdp = await connectToPage(chrome.port);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: dpr, mobile: false,
    });
    await cdp.send('Page.navigate', { url: server.url });
    await cdp.waitFor('!!window.__mg', { label: `[${vp.name}] 只读钩子 window.__mg 出现` });
    await cdp.waitFor('window.__mg.platform.width > 0', { label: `[${vp.name}] 平台屏幕尺寸就绪` });

    const dom = await cdp.eval(DOM_INFO);
    const rect = dom.canvas?.rect ?? { left: 0, top: 0, width: 0, height: 0 };
    console.log(
      `[${vp.name}] 视口 ${dom.innerWidth}x${dom.innerHeight} dpr=${dom.dpr}；canvas 数 ${dom.canvasCount}；` +
        `backing ${dom.canvas?.backingW}x${dom.canvas?.backingH}，css ${dom.canvas?.cssW}x${dom.canvas?.cssH}，` +
        `rect ${JSON.stringify(rect)}`,
    );

    // --- 断言 1：画布完整落在视口内（不被裁）-----------------------------
    const eps = 0.5;
    const inside =
      rect.left >= -eps && rect.top >= -eps &&
      rect.left + rect.width <= vp.width + eps && rect.top + rect.height <= vp.height + eps;
    record('画布完整落在视口内（不被裁）', inside, {
      rect, viewport: { width: vp.width, height: vp.height },
      right: rect.left + rect.width, bottom: rect.top + rect.height,
    });

    // --- 断言 2：点主按钮分数变 -------------------------------------------
    const before = await cdp.eval('window.__mg.state.score');
    const layout = await cdp.eval('window.__mg.layout');
    const btn = layout.tapButton;
    const x = Math.round(rect.left + btn.x + btn.w / 2);
    const y = Math.round(rect.top + btn.y + btn.h / 2);
    await realClick(cdp, x, y);
    await cdp.waitFor('window.__mg.state.score > 0', { label: `[${vp.name}] 分数增加` });
    const after = await cdp.eval('window.__mg.state.score');
    record('点击按钮后分数增加', after === before + 1, { before, after, delta: after - before, clickAt: { x, y }, buttonRect: btn });

    // --- 断言 3：底部按钮可点（画布最下方的按钮）-------------------------
    // web 端没有广告能力（can('ad-rewarded')=false），这个按钮设计上不加分，
    // 所以用「hint 变化」证明点击被正确接收（不是分数）。
    const bottom = layout.rewardedButton;
    const bx = Math.round(rect.left + bottom.x + bottom.w / 2);
    const by = Math.round(rect.top + bottom.y + bottom.h / 2);
    const hintBefore = await cdp.eval('window.__mg.state.hint');
    await realClick(cdp, bx, by);
    await cdp.waitFor(`window.__mg.state.hint !== ${JSON.stringify(hintBefore)}`, { label: `[${vp.name}] 底部按钮被点中` });
    const hintAfter = await cdp.eval('window.__mg.state.hint');
    record('画布底部按钮可点（hint 变化）', hintAfter !== hintBefore, {
      clickAt: { x: bx, y: by }, buttonRect: bottom, hintBefore, hintAfter,
      inViewport: bx >= 0 && bx <= vp.width && by >= 0 && by <= vp.height,
    });

    // --- 断言 4：localStorage 里有可解析的存档 -----------------------------
    const storage = await cdp.eval(STORAGE_INFO);
    const saveEntry = storage.find(
      (e) => e.ok && e.value && typeof e.value === 'object' && e.value.data && typeof e.value.data.score === 'number',
    );
    record('localStorage 有可解析的存档', Boolean(saveEntry) && saveEntry.value.data.score === after, {
      keys: storage.map((e) => e.key), envelope: saveEntry ? saveEntry.value : null,
      foundScore: saveEntry ? saveEntry.value.data.score : null, expected: after,
    });

    // --- 断言 5：Canvas 真的画了（像素，不是数据）-------------------------
    // 判据按 alpha 分两档：
    // - 整画布 opaqueRatio > 0.9：dpr 变换缺失时画面只占左上角 1/dpr²
    //   （dpr=2 → 0.25、dpr=3 → 0.111），这条能把那种错位直接抓出来；
    // - 按钮区 inkRatio > 0.3：按钮区里确有「不是背景色」的内容。
    const pixels = await cdp.eval(PIXEL_INFO);
    record(
      'Canvas 真实绘制发生（整画布不透明 + 按钮区有内容）',
      !pixels.error && pixels.allOpaqueRatio > 0.9 && pixels.opaqueRatio > 0.9 && pixels.inkRatio > 0.3,
      pixels,
    );

    // --- 截图 ---------------------------------------------------------------
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: rect.left, y: rect.top, width: rect.width, height: rect.height, scale: 1 },
    });
    const shotPath = join(OUT_DIR, `shot-${vp.name}.png`);
    await writeFile(shotPath, Buffer.from(shot.data, 'base64'));
    console.log(`截图：${shotPath}`);

    // --- 断言 6：刷新后分数还在 --------------------------------------------
    await cdp.send('Page.reload', { ignoreCache: true });
    await cdp.waitFor('!!window.__mg', { label: `[${vp.name}] 刷新后钩子重新出现` });
    const afterReload = await cdp.eval('window.__mg.state.score');
    record('刷新页面后分数还在', afterReload === after, { afterReload, expected: after });

    viewportResults.push({ viewport: vp.name, width: vp.width, height: vp.height, dpr, checks, dom, screenshot: shotPath });

    // 这个视口用完了：关掉它自己的 Chrome，下一个视口起一个干净的
    cdp.close();
    cdp = null;
    await chrome.kill();
    chrome = null;
  }

  const allChecks = viewportResults.flatMap((v) => v.checks);
  const failed = allChecks.filter((c) => !c.pass);
  const result = {
    ok: failed.length === 0,
    target: WEB_DIR,
    url: server.url,
    checks: allChecks,
    viewports: viewportResults,
  };
  const reportPath = join(OUT_DIR, DPR_OVERRIDE > 0 ? `verify-result-dpr${DPR_OVERRIDE}.json` : 'verify-result.json');
  await writeFile(reportPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n${allChecks.length - failed.length}/${allChecks.length} 条通过；报告：${reportPath}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
} catch (err) {
  console.error('验证失败：', err);
  process.exitCode = 1;
} finally {
  cdp?.close();
  if (chrome) await chrome.kill();
  await server.close();
  // 所有 Chrome 都退了之后再统一清临时目录（此时文件锁已释放）
  await cleanupProfiles();
  console.log('静态服务已关闭。');
}

// 显式退出：headless Chrome 的 WebSocket 句柄在进程被杀后可能仍挂着，
// 事件循环不会自己空掉 → 脚本跑完了却不退出（会挂住 CI）。
process.exit(process.exitCode ?? 0);
