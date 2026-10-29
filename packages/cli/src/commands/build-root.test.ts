import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseArgs } from '../args';
import { projectRoot } from '../shared';
import { runBuild } from './build';

it('--root构建必须加载目标项目的Vite配置，三端都能编译自定义.ui', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mg-build-root-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'game.config.json'), JSON.stringify({ design: { width: 390, height: 844 } }));
  writeFileSync(join(root, 'src/main.ts'), "import ui from './home.ui'; console.log(ui);");
  writeFileSync(join(root, 'src/home.ui'), '# fixture: project-config-loaded');
  writeFileSync(join(root, 'vite.config.mjs'), `export default { plugins: [{ name: 'fixture-ui', transform(code, id) {
    if (id.endsWith('.ui')) return { code: 'export default '+JSON.stringify(code), map: null };
  }}] };`);
  const err: string[] = [];
  try {
    const exit = await runBuild(['--root', root, '--all', '--skip-typecheck'], {
      cwd: process.cwd(), stdout: () => undefined, stderr: line => err.push(line),
    });
    expect(exit, err.join('\n')).toBe(0);
    for (const target of ['web', 'wx', 'tt']) {
      expect(readFileSync(join(root, 'build', target, 'game.js'), 'utf8')).toContain('project-config-loaded');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('项目相对路径以CliContext.cwd为基准，不读取进程全局cwd', () => {
  const cwd = join(tmpdir(), 'mg-context-root');
  expect(projectRoot({ cwd, stdout: () => undefined, stderr: () => undefined }, parseArgs(['--root', 'games/demo'])))
    .toBe(join(cwd, 'games', 'demo'));
});
