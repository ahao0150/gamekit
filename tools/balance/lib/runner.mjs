/**
 * 平衡 bot 跑批（游戏无关）：build → 静态服务 → 每个 bot 跑 N 局 → 取中位 → 判定。
 *
 * 指标只来自 `__mg.state` 快照与真实触摸输入；不读内存、不写状态、不加时间倍速。
 * 胜负判定放在 `games/<slug>.mjs` 的策略里（每个游戏口径不同）。
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createDriver, sleep } from './driver.mjs';
import { resolveChrome, startStaticServer } from '../../shots/server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..', '..');
const GAME_ROOT = join(REPO_ROOT, 'games');

export const buildGame = (slug) => {
  const dir = join(GAME_ROOT, slug);
  const output = execFileSync(process.execPath, [join(REPO_ROOT, 'packages/cli/bin/mg.mjs'), 'build', '--all'], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return output.split('\n').filter((line) => line.includes('包体') || line.includes('产物')).join('\n');
};

const createBrowser = (chrome) =>
  puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars'],
  });

/** 跑一局；返回原始指标 + 完整 timeline。 */
export const runOnce = async ({ browser, url, policy, seed, timeoutMs, screenshotPath }) => {
  const page = await browser.newPage();
  const driver = await createDriver({ page, seed, viewport: { width: 390, height: 844 } });
  const started = Date.now();
  const timeline = [];
  const stats = {
    seed,
    builds: 0,
    upgrades: 0,
    moves: 0,
    picks: 0,
    earlyCalls: 0,
    sells: 0,
    rerolls: 0,
    moveLog: [],
    pickLog: [],
    decisions: [],
  };
  let prevLives = 20;
  let livesLost = 0;
  let waveStartLives = {};
  let state = null;

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForFunction('globalThis.__mg ? true : false', { timeout: 20_000 });
    while (Date.now() - started < timeoutMs) {
      state = await driver.state();
      const battle = state.battle;
      if (state.screen === 'result') break;
      if (battle.lives < prevLives) {
        livesLost += prevLives - battle.lives;
        timeline.push({ wave: battle.wave, lives: battle.lives, lost: prevLives - battle.lives, at: Date.now() - started });
        prevLives = battle.lives;
      }
      if (battle.lives > prevLives) prevLives = battle.lives;
      if (waveStartLives[battle.wave] === undefined) waveStartLives[battle.wave] = battle.lives;

      const ctx = { driver, state, battle, stats, timeline, log: [], elapsed: Date.now() - started };
      await policy.step(ctx);
      if (battle.wave !== undefined) waveStartLives[battle.wave] ??= battle.lives;
      await sleep(200);
    }
  } catch (error) {
    stats.crash = `${error.message}`;
  }

  state = await driver.state().catch(() => state);
  const finalBattle = state?.battle ?? { wave: 0, lives: 0, kills: 0, coins: 0, towers: [], taken: [] };
  const metrics = {
    seed,
    screen: state?.screen ?? 'unknown',
    outcome: state?.result?.outcome ?? null,
    waveReached: finalBattle.wave,
    lives: finalBattle.lives,
    kills: finalBattle.kills,
    coins: finalBattle.coins,
    towers: finalBattle.towers.map((tower) => `${tower.kind}L${tower.level}@${tower.slot}`),
    taken: finalBattle.taken,
    livesLost,
    timeline,
    waveStartLives,
    stats,
    errors: driver.errors.slice(0, 20),
    elapsedSec: Math.round((Date.now() - started) / 1000),
    crash: stats.crash ?? null,
  };
  if (screenshotPath !== undefined) await driver.shot(screenshotPath).catch(() => undefined);
  await page.close();
  return metrics;
};

/** 中位：按到达波次排序取中间那局（偶数取较低一局，保守）。 */
export const medianOf = (runs) => {
  const sorted = [...runs].sort((a, b) => a.waveReached - b.waveReached || a.kills - b.kills);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

/** 跑批并落盘：每局一个 JSON、每 bot 一个 median.json 与 terminal 汇总。 */
export const runBatch = async ({ slug, policies, runs, seed, chrome, url: existingUrl, outDir, timeoutMs = 12 * 60_000 }) => {
  const dir = outDir ?? join(GAME_ROOT, slug, 'artifacts', 'bots');
  mkdirSync(dir, { recursive: true });

  const serverInfo = existingUrl === undefined ? await startStaticServer(join(GAME_ROOT, slug, 'build', 'web')) : null;
  const url = existingUrl ?? serverInfo.url;
  const browser = await createBrowser(chrome ?? resolveChrome(undefined));
  const report = { slug, seed, createdAt: new Date().toISOString(), bots: {} };

  try {
    for (const [botName, policy] of Object.entries(policies)) {
      const results = [];
      for (let index = 0; index < runs; index += 1) {
        const runSeed = (seed + index * 7919) >>> 0;
        process.stdout.write(`\n[${botName}] run ${index + 1}/${runs} seed=${runSeed} …\n`);
        const metrics = await runOnce({
          browser,
          url,
          policy: policy.create ? policy.create() : policy,
          seed: runSeed,
          timeoutMs,
          screenshotPath: join(dir, `${botName}-run${index + 1}.png`),
        });
        writeFileSync(join(dir, `${botName}-run${index + 1}.json`), JSON.stringify(metrics, null, 2));
        results.push(metrics);
        process.stdout.write(
          `[${botName}] run ${index + 1}: W${metrics.waveReached} ${metrics.outcome ?? metrics.screen} 生命${metrics.lives} 漏${metrics.livesLost} 击杀${metrics.kills} ${metrics.elapsedSec}s${metrics.crash ? ` CRASH ${metrics.crash}` : ''}\n`,
        );
      }
      const median = medianOf(results);
      const verdict = policy.judge(results, median);
      report.bots[botName] = { results, median, verdict };
      writeFileSync(join(dir, `${botName}-median.json`), JSON.stringify({ median, verdict }, null, 2));
      process.stdout.write(
        `\n[${botName}] 中位：W${median.waveReached} ${median.outcome ?? median.screen} 生命${median.lives} 漏${median.livesLost} → ${verdict.pass ? 'PASS' : 'FAIL'}（${verdict.reason}）\n`,
      );
    }
  } finally {
    await browser.close();
    serverInfo?.server?.close();
  }

  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  return report;
};
