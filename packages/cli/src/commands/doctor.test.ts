import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REQUIRED_NODE_MAJOR, collectChecks, collectProjectChecks, exitCodeOf, runDoctor } from './doctor';

const made: string[] = [];

const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'mg-doctor-'));
  made.push(root);
  return root;
};

afterEach(() => {
  while (made.length > 0) rmSync(made.pop() ?? '', { recursive: true, force: true });
});

describe('collectChecks', () => {
  it('空目录：缺包目录与契约 → error，退出码 1', () => {
    const checks = collectChecks(makeRoot(), null);
    expect(exitCodeOf(checks)).toBe(1);
    expect(checks.some((c) => c.level === 'error' && c.message.includes('缺少包目录'))).toBe(true);
    expect(checks.some((c) => c.level === 'error' && c.message.includes('缺少契约文件'))).toBe(true);
  });

  it('node 与 pnpm 两条体检项都在', () => {
    const checks = collectChecks(makeRoot(), '11.21.0');
    expect(checks.some((c) => c.message.startsWith('Node.js ') || c.message.startsWith('当前 Node.js'))).toBe(true);
    expect(checks.some((c) => c.message === 'pnpm 11.21.0 已安装')).toBe(true);
  });

  it('仓库级体检不误报游戏配置与产物缺失', () => {
    const checks = collectChecks(makeRoot(), null);
    expect(checks.some((c) => c.level === 'warn' && c.message.includes('templates/iaa-ui'))).toBe(true);
    expect(checks.some((c) => c.message.includes('产物') || c.message.includes('game.config'))).toBe(false);
  });
});

describe('exitCodeOf', () => {
  it('只有 warn/ok 时为 0，出现 error 为 1', () => {
    expect(exitCodeOf([{ level: 'ok', message: 'a' }, { level: 'warn', message: 'b' }])).toBe(0);
    expect(exitCodeOf([{ level: 'warn', message: 'b' }, { level: 'error', message: 'c' }])).toBe(1);
  });
});

describe('REQUIRED_NODE_MAJOR', () => {
  it('与 engines 口径一致：≥ 22', () => {
    expect(REQUIRED_NODE_MAJOR).toBe(22);
  });
});

describe('项目体检', () => {
  it('读取项目而非仓库根的配置、三端入口，空build目录不算已构建', () => {
    const project = join(makeRoot(), 'games', 'demo');
    mkdirSync(join(project, 'build', 'web'), { recursive: true });
    writeFileSync(join(project, 'game.config.json'), JSON.stringify({ design: { width: 390, height: 844 } }));
    expect(collectProjectChecks(project).some(c => c.level === 'error')).toBe(false);
    expect(collectProjectChecks(project).some(c => c.message.includes('尚未构建'))).toBe(true);
    for (const target of ['web', 'wx', 'tt']) {
      mkdirSync(join(project, 'build', target), { recursive: true });
      writeFileSync(join(project, 'build', target, 'game.js'), '// built');
    }
    expect(collectProjectChecks(project).every(c => c.level === 'ok')).toBe(true);
  });
  it('缺失或损坏的项目配置是错误；兼容package.json的mg字段', () => {
    const project = makeRoot();
    expect(exitCodeOf(collectProjectChecks(project))).toBe(1);
    writeFileSync(join(project, 'game.config.json'), '{bad');
    expect(exitCodeOf(collectProjectChecks(project))).toBe(1);
    writeFileSync(join(project, 'package.json'), JSON.stringify({ mg: { design: { width: 320, height: 568 } } }));
    expect(exitCodeOf(collectProjectChecks(project))).toBe(0);
  });
  it('相对--root按ctx.cwd解析，仍从上级工作区检查引擎', async () => {
    const root = makeRoot(), project = join(root, 'games', 'demo'), out: string[] = [];
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages: []");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'game.config.json'), JSON.stringify({ design: { width: 390, height: 844 } }));
    await runDoctor(['--root', 'games/demo'], { cwd: root, stdout: line => out.push(line), stderr: () => undefined });
    expect(out).toContain(`mg doctor: 仓库根 ${root}`);
    expect(out).toContain(`mg doctor: 游戏项目 ${project}`);
    expect(out.some(line => line.includes('项目配置有效'))).toBe(true);
  });
});

it('从框架子目录执行doctor仍是仓库体检，不误判成游戏', async () => {
  const root = makeRoot(), cwd = join(root, 'packages', 'cli'), out: string[] = [];
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []');
  mkdirSync(cwd, { recursive: true });
  await runDoctor([], { cwd, stdout: line => out.push(line), stderr: () => undefined });
  expect(out).toContain(`mg doctor: 仓库根 ${root}`);
  expect(out.some(line => line.startsWith('mg doctor: 游戏项目'))).toBe(false);
});
