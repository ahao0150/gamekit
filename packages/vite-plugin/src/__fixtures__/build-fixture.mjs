// 三端产物校验（构建由 vite CLI 跑，见 vite.config.ts）：
//   MG_TARGET=web|wx|tt node_modules/vite/bin/vite.js build --config <本目录>/vite.config.ts
//   node packages/vite-plugin/src/__fixtures__/build-fixture.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), 'iaa-mini');

const walk = (dir, base = dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full, base));
    else out.push({ rel: full.slice(base.length + 1).split('\\').join('/'), bytes: stat.size });
  }
  return out;
};

const report = {};
for (const target of ['web', 'wx', 'tt']) {
  const outDir = join(root, 'build', target);
  if (!existsSync(outDir)) {
    report[target] = { error: 'build missing' };
    continue;
  }
  const files = walk(outDir).sort((a, b) => a.rel.localeCompare(b.rel));
  const manifest = JSON.parse(readFileSync(join(outDir, 'asset-manifest.json'), 'utf8'));
  const gameJson = existsSync(join(outDir, 'game.json'))
    ? JSON.parse(readFileSync(join(outDir, 'game.json'), 'utf8'))
    : null;
  const projectJson = existsSync(join(outDir, 'project.config.json'))
    ? JSON.parse(readFileSync(join(outDir, 'project.config.json'), 'utf8'))
    : null;
  const gameJs = files.find((file) => file.rel === 'game.js');
  report[target] = {
    files: files.length,
    mainBytes: files
      .filter((file) => !file.rel.startsWith('subpackages/'))
      .reduce((sum, file) => sum + file.bytes, 0),
    gameJsBytes: gameJs?.bytes ?? 0,
    manifestEntries: Object.keys(manifest).length,
    manifest,
    gameJson,
    appid: projectJson?.appid ?? null,
    listing: files.map((file) => `${file.rel} ${file.bytes}B`),
  };
}
console.log(JSON.stringify(report, null, 2));
