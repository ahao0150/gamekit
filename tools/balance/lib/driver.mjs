/**
 * 平衡 bot 的浏览器驱动：真实触摸事件 + 只读快照 + 固定随机种子。
 *
 * 不碰游戏代码：种子靠 `evaluateOnNewDocument` 在页面加载前覆写 `Math.random`，
 * 读数只走 `__mg.state / __mg.geom / __mg.layout`（与 shots 同一套只读钩子）。
 * 输入走 CDP `Input.dispatchTouchEvent`，和手指一样会产生 down/move/up。
 */

export const SEEDABLE = true;

/** mulberry32：小、快、够用。种子注入必须在页面脚本之前。 */
export const seedScript = (seed) => `(() => {
  let s = ${seed >>> 0};
  Math.random = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();`;

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * 建驱动。`page` 必须是还没导航过的空白页（种子要先注入）。
 * 返回的对象只提供「看」与「点」，没有写状态的入口。
 */
export const createDriver = async ({ page, seed, viewport }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });

  await page.evaluateOnNewDocument(seedScript(seed));
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const touch = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });

  const evaluate = async (expression) => {
    const result = await page.evaluate(expression);
    return result;
  };
  const state = () => evaluate('JSON.parse(JSON.stringify(__mg.state))');
  const geom = () => evaluate('JSON.parse(JSON.stringify(__mg.geom))');
  const layout = () => evaluate('JSON.parse(JSON.stringify(__mg.layout))');

  const tap = async (x, y) => {
    await touch('touchStart', x, y);
    await touch('touchEnd');
  };
  const tapKey = async (key) => {
    const rects = await layout();
    const rect = rects[key];
    if (rect === undefined) return false;
    await tap(rect.x + rect.w / 2, rect.y + rect.h / 2);
    return true;
  };
  /** 长按 ≥80ms 抬起阵 → 拖到目标 → 松手（真实 touch 序列，不是直接调用）。 */
  const drag = async (from, to) => {
    await touch('touchStart', from.x, from.y);
    await sleep(140);
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    await touch('touchMove', midX, midY);
    await sleep(40);
    await touch('touchMove', to.x, to.y);
    await sleep(40);
    await touch('touchEnd');
  };
  const shot = async (path) => {
    await page.screenshot({ path });
  };

  return { page, cdp, errors, state, geom, layout, tap, tapKey, drag, shot, evaluate };
};
