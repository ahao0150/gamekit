#!/usr/bin/env node
/**
 * 平衡 bot 一键验收。
 *
 *   node tools/balance/run.mjs <slug> [--bots weak,normal] [--runs 3] [--seed 20261023]
 *                               [--url <已有地址>] [--chrome <path>] [--no-build]
 *                               [--timeout <分钟>] [--out <目录>]
 *
 * 默认：先 `mg build --all`，再起静态服务，按 3 局取中位。
 * 退出码：任一 bot 的中位局不满足口径 → 1（弱 bot 是否够弱 / 正常 bot 是否到 W12）。
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildGame, runBatch, REPO_ROOT } from './lib/runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = [
  '用法：node tools/balance/run.mjs <slug> [选项]',
  '',
  '  --bots <list>       weak,normal（默认两个都跑）',
  '  --runs <n>          每个 bot 跑几局（默认 3，取中位）',
  '  --seed <n>          随机种子基值（默认 20261023；第 i 局 = seed + i*7919）',
  '  --url <url>         直接打已有地址（不启静态服务）',
  '  --chrome <path>     Chrome 可执行文件（默认 CHROME_PATH 或常见路径）',
  '  --no-build          跳过 mg build（用当前 build/）',
  '  --timeout <分钟>     单局上限（默认 12）',
  '  --out <dir>         结果目录（默认 games/<slug>/artifacts/balance）',
  '  -h, --help          显示帮助',
].join('\n');

const parseArgs = (argv) => {
  const options = { bots: 'weak,normal', runs: 3, seed: 20261023, timeout: 12 };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const key = eq >= 0 ? arg.slice(0, eq) : arg;
    if (key === '--no-build') {
      options.noBuild = true;
      continue;
    }
    if (key === '-h' || key === '--help') {
      console.log(USAGE);
      process.exit(0);
    }
    const value = eq >= 0 ? arg.slice(eq + 1) : argv[(index += 1)];
    if (value === undefined) throw new Error(`参数 ${key} 缺值\n\n${USAGE}`);
    switch (key) {
      case '--bots': options.bots = value; break;
      case '--runs': options.runs = Number(value); break;
      case '--seed': options.seed = Number(value); break;
      case '--url': options.url = value; break;
      case '--chrome': options.chrome = value; break;
      case '--timeout': options.timeout = Number(value); break;
      case '--out': options.out = resolve(value); break;
      default: throw new Error(`未知参数 ${key}\n\n${USAGE}`);
    }
  }
  if (positional.length !== 1) throw new Error(`缺少游戏 slug\n\n${USAGE}`);
  options.slug = positional[0];
  return options;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const gameDir = join(REPO_ROOT, 'games', options.slug);
  if (!existsSync(join(gameDir, 'game.config.json'))) throw new Error(`games/${options.slug} 不是游戏目录`);
  const policyPath = join(HERE, 'games', `${options.slug}.mjs`);
  if (!existsSync(policyPath)) throw new Error(`缺少策略：${policyPath}`);
  const module = await import(pathToFileURL(policyPath).href);
  const wanted = options.bots.split(',').map((name) => name.trim()).filter(Boolean);
  const policies = {};
  for (const name of wanted) {
    if (module.policies[name] === undefined) throw new Error(`策略 ${options.slug} 没有 ${name}（有：${Object.keys(module.policies).join('/')}）`);
    policies[name] = module.policies[name];
  }

  if (!options.noBuild && options.url === undefined) {
    process.stdout.write(`[build] games/${options.slug} …\n`);
    process.stdout.write(`${buildGame(options.slug)}\n`);
  }

  const report = await runBatch({
    slug: options.slug,
    policies,
    runs: options.runs,
    seed: options.seed >>> 0,
    chrome: options.chrome,
    url: options.url,
    outDir: options.out,
    timeoutMs: options.timeout * 60_000,
  });

  process.stdout.write('\n=== 汇总 ===\n');
  let failed = 0;
  for (const [name, data] of Object.entries(report.bots)) {
    const { median, verdict } = data;
    if (!verdict.pass) failed += 1;
    process.stdout.write(
      `${verdict.pass ? 'PASS' : 'FAIL'} ${name}：中位 W${median.waveReached} ${median.outcome ?? median.screen} 生命${median.lives} 漏${median.livesLost} 击杀${median.kills} —— ${verdict.reason}\n`,
    );
  }
  process.stdout.write(`结果目录：${options.out ?? join(gameDir, 'artifacts', 'bots')}\n`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(2);
});
