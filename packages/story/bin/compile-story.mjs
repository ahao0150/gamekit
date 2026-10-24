#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseFlatStory } from './flat.mjs';

const usage = () => {
  process.stderr.write(
    '用法: node packages/story/bin/compile-story.mjs <file.story.tsv> [--out <demo.json>]\n',
  );
};

const args = process.argv.slice(2);
let input = '';
let outPath = '';

for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--out' && args[i + 1]) {
    outPath = resolve(args[++i]);
  } else if (a === '--help' || a === '-h') {
    usage();
    process.exit(0);
  } else if (!a.startsWith('-') && input.length === 0) {
    input = resolve(a);
  }
}

if (!input) {
  usage();
  process.exit(1);
}

const text = readFileSync(input, 'utf8');
const script = parseFlatStory(text);
const dest = outPath.length > 0 ? outPath : resolve(dirname(input), 'demo.json');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, `${JSON.stringify(script, null, 2)}\n`);
process.stdout.write(`已编译剧情 → ${dest}\n`);
