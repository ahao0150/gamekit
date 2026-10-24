#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadStoryFromPath } from './flat.mjs';
import { lintStory } from './lib.mjs';

const file = process.argv[2];
if (!file) {
  process.stderr.write(
    '用法: node packages/story/bin/lint-story.mjs <script.story.tsv|script.json>\n',
  );
  process.exit(1);
}

let raw;
try {
  raw = loadStoryFromPath(resolve(file), readFileSync);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
const report = lintStory(raw);
if (report.ok) {
  process.stdout.write('OK：未发现死路、断链或不可达结局\n');
  process.exit(0);
}
for (const issue of report.issues) {
  process.stderr.write(`[${issue.kind}] ${issue.nodeId}: ${issue.message}\n`);
}
process.exit(1);
