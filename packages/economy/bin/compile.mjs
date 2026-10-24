#!/usr/bin/env node
import { resolve } from 'node:path';
import { compileTablesFromDir } from './lib.mjs';

const usage = () => {
  process.stderr.write(
    '用法: node packages/economy/bin/compile.mjs --table <源目录> [--out <输出目录>]\n' +
      '  读 levels/production/prices 的 .tsv/.csv，写出 JSON（默认输出到源目录）。\n',
  );
};

const args = process.argv.slice(2);
let tableDir = '';
let outDir = '';

for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--table' && args[i + 1]) {
    tableDir = resolve(args[++i]);
  } else if (a === '--out' && args[i + 1]) {
    outDir = resolve(args[++i]);
  } else if (a === '--help' || a === '-h') {
    usage();
    process.exit(0);
  }
}

if (!tableDir) {
  usage();
  process.exit(1);
}

const dest = outDir.length > 0 ? outDir : tableDir;
compileTablesFromDir(tableDir, dest);
process.stdout.write(`已编译配表 → ${dest}\n`);
