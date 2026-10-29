/**
 * `svg-rect-diff.mjs` 的三态自测：绿 / 超差 / 名字对不上。
 *
 * 为什么必须有这份：**只会报绿的工具不算验过**。尺子本身要能报红，
 * 而且要能区分「偏了几像素」和「名字根本没对上」—— 这两种错指的是完全不同的返工。
 *
 * 用 vitest（不是 `node:test`）：根 `vitest.config.ts` 的 include 收 `tools` 目录下的
 * `*.test.mjs`，用 node:test 会被 vitest 收进来报「No test suite found」、把 `pnpm -w test` 整体拖红。
 * （注意：块注释里不要写「星号紧跟斜杠」的组合，那会提前结束注释、后面的中文变成代码。）
 *
 * 每个用例都要起一次无头 Chrome（约 3.7 秒），所以逐个给 `timeout: 30000` ——
 * vitest 默认 5 秒会超时。样例在临时目录现生成、跑完删。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const TOOL = resolve(import.meta.dirname, 'svg-rect-diff.mjs');

/** `.ui` 算出来 panel = { x: 30, y: 0, w: 200, h: 60 }（region pad-x 30 + cross 200 + size 60）。 */
const UI_SOURCE = 'region body fill column pad-x 30 align start\nput panel cross 200 size fixed 60\n';

const svgOf = (shapes) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 844" width="390" height="844">
${shapes}
</svg>
`;

const run = (svgPath, uiPath, extra = []) => {
  const result = spawnSync(process.execPath, [TOOL, '--svg', svgPath, '--ui', uiPath, ...extra], {
    encoding: 'utf8',
  });
  return { code: result.status, text: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

let dir = '';
let uiPath = '';
let okPath = '';
let driftPath = '';
let missingPath = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'svg-rect-diff-'));
  uiPath = join(dir, 'screen.ui');
  okPath = join(dir, 'ok.svg');
  driftPath = join(dir, 'drift.svg');
  missingPath = join(dir, 'missing.svg');
  await writeFile(uiPath, UI_SOURCE);
  await writeFile(okPath, svgOf('<rect data-name="panel" x="30" y="0" width="200" height="60"/>'));
  await writeFile(driftPath, svgOf('<rect data-name="panel" x="20" y="0" width="200" height="60"/>'));
  await writeFile(missingPath, svgOf(
    '<rect data-name="panel" x="30" y="0" width="200" height="60"/>'
    + '<rect data-name="extra" x="100" y="200" width="50" height="50"/>',
  ));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

describe('svg-rect-diff 三态自测', () => {
  it('对齐的样例 → 退出码 0，全部在 tol 内', { timeout: 30000 }, () => {
    const { code, text } = run(okPath, uiPath);
    expect(code, `期望 0，实际 ${code}\n${text}`).toBe(0);
    expect(text).toMatch(/PASS/);
    expect(text).toMatch(/\+0\.0000/);
  });

  it('偏 10px 的样例 → 退出码 1，dx 约等于 +10', { timeout: 30000 }, () => {
    const { code, text } = run(driftPath, uiPath);
    expect(code, `期望 1，实际 ${code}\n${text}`).toBe(1);
    expect(text).toMatch(/\+10\.0000/);
    expect(text).toMatch(/超差/);
  });

  it('放宽容差到 12px → 同一份超差样例变绿（阈值真的可调）', { timeout: 30000 }, () => {
    const { code } = run(driftPath, uiPath, ['--tol', '12']);
    expect(code).toBe(0);
  });

  it('SVG 多一个 data-name → 退出码 2，并列出缺失名', { timeout: 30000 }, () => {
    const { code, text } = run(missingPath, uiPath);
    expect(code, `期望 2，实际 ${code}\n${text}`).toBe(2);
    expect(text).toMatch(/extra/);
  });

  it('viewBox 与 --viewport 不同 → 退出码 3（不静默按错误坐标系对拍）', { timeout: 30000 }, () => {
    const { code, text } = run(okPath, uiPath, ['--viewport', '320x568']);
    expect(code, `期望 3，实际 ${code}\n${text}`).toBe(3);
    expect(text).toMatch(/viewBox/);
  });
});
