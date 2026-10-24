#!/usr/bin/env node
/**
 * 验收截图（游戏无关）：按每游戏的步骤配置走「首页 → 游戏中段 → 结算」，
 * 点真实坐标、读只读快照、断言屏幕/进度、截图。
 *
 * 用法：
 *   node tools/shots/shots.mjs <slug> [--url <url>] [--mode mobile|desktop|both]
 *                              [--chrome <path>] [--start <layoutKey>] [--tap-ms <ms>]
 *                              [--steps <path>]
 *
 * 步骤配置：tools/shots/steps/<slug>.json（格式见 steps/README.md）。
 * 没有配置时用通用默认流程，并在终端明确提示缺什么。
 *
 * 截图：games/<slug>/artifacts/shots/<mode>-<序号>-<步骤名>.png
 * 退出码：pageerror / console.error / HTTP>=400 任意一条，或有 required 步骤未达成 -> 1。
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { runFlow } from './flow.mjs';
import { resolveChrome, startStaticServer } from './server.mjs';
import { loadSteps } from './steps.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const USAGE = [
  '用法：node tools/shots/shots.mjs <slug> [选项]',
  '',
  '  --url <url>       直接截已有地址（不启静态服务）',
  '  --mode <mode>     mobile | desktop | both（默认 both）',
  '  --chrome <path>   Chrome/Chromium 可执行文件（默认 CHROME_PATH 或常见路径）',
  '  --start <key>     覆盖步骤配置里的开始按钮 layout key',
  '  --tap-ms <ms>     默认点击间隔（步骤配置里的 tapMs 优先，默认 300ms）',
  '  --steps <path>    覆盖步骤配置路径（默认 tools/shots/steps/<slug>.json）',
  '  -h, --help        显示帮助',
].join('\n');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const parseArgs = (argv) => {
  const options = { mode: 'both', tapMs: 300 };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf('=');
    const key = equals >= 0 ? arg.slice(0, equals) : arg;
    const value = equals >= 0 ? arg.slice(equals + 1) : argv[(index += 1)];
    if (value === undefined || value === '') throw new Error(`参数 ${key} 缺少值\n\n${USAGE}`);
    switch (key) {
      case '--url':
        options.url = value;
        break;
      case '--mode':
        options.mode = value;
        break;
      case '--chrome':
        options.chrome = value;
        break;
      case '--start':
        options.start = value;
        break;
      case '--steps':
        options.steps = value;
        break;
      case '--tap-ms': {
        const ms = Number(value);
        if (!Number.isFinite(ms) || ms <= 0) throw new Error(`--tap-ms 必须是正数，收到 ${value}`);
        options.tapMs = ms;
        break;
      }
      default:
        throw new Error(`未知参数 ${key}\n\n${USAGE}`);
    }
  }
  return { options, positionals };
};

/** 单个模式：开页 → 装钩子 → 交给 flow。 */
const runMode = async ({ browser, mode, url, slug, config, options, errors }) => {
  const mobile = mode === 'mobile';
  const page = await browser.newPage();
  const shotsDir = join(ROOT, 'games', slug, 'artifacts', 'shots');
  mkdirSync(shotsDir, { recursive: true });

  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(`[${mode}] pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`[${mode}] console.error: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`[${mode}] HTTP ${response.status()} ${response.url()}`);
  });

  await page.setViewport(
    mobile
      ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { width: 1280, height: 800, deviceScaleFactor: 1 },
  );

  console.log(`\n=== [${mode}] ${mobile ? '390×844 DPR2 touch' : '1280×800 DPR1 mouse'} ===`);
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 10000 }).catch(() => {
      errors.push(`[${mode}] 页面上找不到 canvas`);
    });
    try {
      await page.waitForFunction(() => Boolean(globalThis.__mg), { timeout: 15000 });
    } catch {
      errors.push(`[${mode}] 页面没有只读调试钩子 globalThis.__mg，无法定位布局`);
    }
    await sleep(1200);
    return await runFlow({ page, mode, config, options, shotsDir, root: ROOT });
  } finally {
    await page.close().catch(() => {});
  }
};

const main = async () => {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE);
    if (argv.length === 0) process.exitCode = 1;
    return;
  }
  const { options, positionals } = parseArgs(argv);
  const slug = positionals[0];
  if (slug === undefined) throw new Error(`缺少 <slug>\n\n${USAGE}`);
  if (positionals.length > 1) throw new Error(`只接受一个 <slug>，多出：${positionals.slice(1).join(' ')}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`非法 slug：${slug}`);
  if (!['mobile', 'desktop', 'both'].includes(options.mode)) {
    throw new Error(`--mode 只能是 mobile / desktop / both，收到 ${options.mode}`);
  }

  const loaded = loadSteps({
    root: ROOT,
    slug,
    startOverride: options.start,
    stepsPath: options.steps === undefined ? undefined : resolve(options.steps),
  });
  const { config, warning } = loaded;
  if (warning !== null) console.log(`⚠ ${warning}`);
  console.log(`步骤配置：${config.source ?? '（通用默认流程）'}（${config.steps.length} 步，上限 ${config.maxSteps}；${config.screenPath}；start=${config.start}）`);
  for (const step of config.steps) {
    const targets = step.drag === undefined ? (step.taps ?? (step.tap === undefined ? [] : [step.tap])) : ['drag'];
    console.log(`  - ${step.name}: ${targets.length === 0 ? '只等待' : JSON.stringify(targets)}`);
  }

  let serverHandle = null;
  let url = options.url;
  if (url === undefined) {
    const webDir = resolve(ROOT, 'games', slug, 'build', 'web');
    if (!existsSync(webDir) || !statSync(webDir).isDirectory()) {
      throw new Error(
        `games/${slug}/build/web 不存在。先跑构建：\n` +
          `  cd games/${slug} && pnpm mg build --target web\n` +
          `（或只截已有地址：--url <url>）`,
      );
    }
    serverHandle = await startStaticServer(webDir);
    url = serverHandle.url;
    console.log(`静态服务：${url} → games/${slug}/build/web`);
  }

  const chrome = resolveChrome(options.chrome);
  const errors = [];
  const results = [];
  const modes = options.mode === 'both' ? ['mobile', 'desktop'] : [options.mode];
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
    });
    for (const mode of modes) {
      results.push(await runMode({ browser, mode, url, slug, config, options, errors }));
    }
  } finally {
    if (browser !== null) await browser.close().catch(() => {});
    if (serverHandle !== null) {
      await new Promise((done) => serverHandle.server.close(done));
    }
  }

  const checks = results.flatMap((result) => result.checks);
  const failed = checks.filter((item) => item.ok === false);
  const skipped = checks.filter((item) => item.ok === null);
  const shots = results.flatMap((result) => result.shots);
  console.log(
    `\n步骤检查：${checks.length - failed.length - skipped.length} 通过 / ${failed.length} 失败 / ${skipped.length} 跳过；截图 ${shots.length} 张。`,
  );

  if (errors.length > 0) {
    console.error(`\n发现 ${errors.length} 条错误（pageerror / console.error / HTTP>=400）：`);
    for (const error of errors) console.error(`  - ${error}`);
  } else {
    console.log('无 pageerror / console.error / HTTP>=400。');
  }
  if (errors.length > 0 || failed.length > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error(`shots 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
