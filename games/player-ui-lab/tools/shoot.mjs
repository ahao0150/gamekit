#!/usr/bin/env node
/**
 * 真渲染截图（本工程自用）：起 `mg dev` → 无头 Chrome → 两个视口各截一张。
 *
 * 顺手把 `window.__player` 的布局结果与 errors 打出来 —— 截图是给人看的，
 * 数字是给报告引用的，两者必须在同一帧上取（避免「截图是旧的、数字是新的」）。
 *
 * 用法：node games/player-ui-lab/tools/shoot.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startMgDev } from '../../../templates/iaa-simple/tools/lib/devserver.mjs';
import {
  cleanupProfiles, connectToPage, purgeStaleProfiles, startChrome,
} from '../../../templates/iaa-simple/tools/lib/harness.mjs';

const REPO = resolve(import.meta.dirname, '../../..');
const PROJECT = resolve(REPO, 'games/player-ui-lab');
const OUT = resolve(PROJECT, 'artifacts');

const VIEWPORTS = [
  { width: 390, height: 844, file: 'player-390.png' },
  { width: 375, height: 812, file: 'player-375.png' },
  // 用户就是在这个比例下看到「播放键凸出玻璃面板」的，必须常驻回归
  { width: 375, height: 667, file: 'player-375x667.png' },
  { width: 320, height: 568, file: 'player-320.png' },
];

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

const main = async () => {
  await mkdir(OUT, { recursive: true });
  purgeStaleProfiles();
  const dev = await startMgDev(PROJECT, REPO);
  const chrome = await startChrome({ width: 420, height: 900 });
  const cdp = await connectToPage(chrome.port);
  try {
    await cdp.send('Page.enable');
    for (const vp of VIEWPORTS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false,
      });
      await cdp.send('Page.navigate', { url: `${dev.url}/` });
      await cdp.waitFor('globalThis.__player !== undefined', { timeoutMs: 20000, label: '游戏启动' });
      await sleep(400); // 让 createLoop 至少画一帧
      const state = await cdp.eval(`(() => {
        const p = globalThis.__player;
        return {
          viewport: p.viewport,
          errors: p.errors,
          rects: p.rects,
          canvas: (() => {
            const c = document.querySelector('canvas');
            return c === null ? null : {
              cssW: Math.round(c.getBoundingClientRect().width * 100) / 100,
              cssH: Math.round(c.getBoundingClientRect().height * 100) / 100,
              backingW: c.width, backingH: c.height,
            };
          })(),
        };
      })()`);
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 1 },
        captureBeyondViewport: false,
      });
      const buf = Buffer.from(shot.data, 'base64');
      const file = resolve(OUT, vp.file);
      await writeFile(file, buf);
      const size = pngSize(buf);
      console.log(`\n== ${vp.width}×${vp.height} ==`);
      console.log(`  canvas css=${JSON.stringify(state.canvas)}`);
      console.log(`  layout viewport=${JSON.stringify(state.viewport)} errors=${JSON.stringify(state.errors)}`);
      const names = Object.keys(state.rects);
      console.log(`  rects(${names.length}): ${names.map((n) => {
        const r = state.rects[n];
        return `${n}=${r.x},${r.y},${r.w},${r.h}`;
      }).join('  ')}`);
      console.log(`  PNG ${size.w}×${size.h} · ${buf.length} 字节 → ${file}`);
    }
  } finally {
    cdp.close();
    await chrome.kill();
    await dev.stop();
    await cleanupProfiles();
  }
};

main().catch((error) => {
  console.error(`✗ 截图失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
