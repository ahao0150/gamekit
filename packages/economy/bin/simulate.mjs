#!/usr/bin/env node
import { resolve } from 'node:path';
import { loadTablesFromDir, simulate } from './lib.mjs';

const usage = () => {
  process.stderr.write(
    '用法: node packages/economy/bin/simulate.mjs --table <目录> --days <N> [--json] [--hours <每天游玩小时>]\n',
  );
};

const args = process.argv.slice(2);
let tableDir = '';
let days = 7;
let json = false;
let hours = 1;

for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--table' && args[i + 1]) {
    tableDir = resolve(args[++i]);
  } else if (a === '--days' && args[i + 1]) {
    days = Number(args[++i]);
  } else if (a === '--hours' && args[i + 1]) {
    hours = Number(args[++i]);
  } else if (a === '--json') {
    json = true;
  } else if (a === '--help' || a === '-h') {
    usage();
    process.exit(0);
  }
}

if (!tableDir) {
  usage();
  process.exit(1);
}

const tables = loadTablesFromDir(tableDir);
const report = simulate(tables, {
  days,
  playHoursPerDay: hours,
  startLevel: 1,
  startGold: 0,
});

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    `模拟 ${report.days} 天（每天 ${hours}h）→ 等级 ${report.finalLevel}，金币 ${report.finalGold.toFixed(0)}，经验余 ${report.finalExp}\n`,
  );
  if (report.blockedByGold) {
    process.stdout.write(`金币不足购买下一项：${report.blockedItemId}\n`);
  }
  for (const d of report.daily) {
    process.stdout.write(
      `  第${d.day}天: Lv${d.level} 金${d.gold.toFixed(0)} (+${d.goldEarned.toFixed(0)}) 升级${d.levelUps}次 购买[${d.purchases.join(',')}]\n`,
    );
  }
}
