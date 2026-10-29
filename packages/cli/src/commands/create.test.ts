import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CliContext } from '../shared';
import { DEFAULT_TEMPLATE, assertGamekitRoot, runCreate, validateGameName } from './create';

const made: string[] = [];

const makeWorkspace = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'mg-create-'));
  made.push(root);
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'games/*'\n");
  mkdirSync(join(root, 'packages'), { recursive: true });
  mkdirSync(join(root, 'templates'), { recursive: true });
  return root;
};

const makeTemplate = (root: string): string => {
  const template = join(root, 'templates', 'iaa-ui');
  mkdirSync(join(template, 'src'), { recursive: true });
  writeFileSync(
    join(template, 'package.json'),
    `${JSON.stringify({ name: 'mg-template-iaa-simple', version: '0.0.0', scripts: { dev: 'vite' } }, null, 2)}\n`,
  );
  writeFileSync(join(template, 'src', 'main.ts'), 'export {};\n');
  return template;
};

const context = (cwd: string): { ctx: CliContext; out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { ctx: { cwd, stdout: (line) => out.push(line), stderr: (line) => err.push(line) }, out, err };
};

afterEach(() => {
  while (made.length > 0) rmSync(made.pop() ?? '', { recursive: true, force: true });
});

describe('validateGameName', () => {
  it('接受小写字母 / 数字 / 连字符', () => {
    for (const name of ['a', 'my-game', 'abc123', 'x'.repeat(32)]) {
      expect(validateGameName(name)).toBeNull();
    }
  });

  it('拒绝空名 / 大写 / 下划线 / 数字开头 / 过短过长', () => {
    for (const name of ['', 'My-Game', 'a_b', '1abc', '-abc', 'x'.repeat(33)]) {
      expect(validateGameName(name)).not.toBeNull();
    }
  });
});

describe('runCreate（真实临时目录）', () => {
  it('复制模板并替换 package.json 的 name', async () => {
    const root = makeWorkspace();
    makeTemplate(root);
    const { ctx, out, err } = context(root);

    expect(await runCreate(['my-game'], ctx)).toBe(0);
    const gameDir = join(root, 'games', 'my-game');
    expect(existsSync(join(gameDir, 'src', 'main.ts'))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(gameDir, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg['name']).toBe('my-game');
    expect(pkg['version']).toBe('0.0.0');
    expect(out.join('\n')).toContain('已创建 games/my-game/');
    expect(err).toEqual([]);
  });

  it('目标已存在 → 返回 1', async () => {
    const root = makeWorkspace();
    makeTemplate(root);
    mkdirSync(join(root, 'games', 'my-game'), { recursive: true });
    const { ctx, err } = context(root);
    expect(await runCreate(['my-game'], ctx)).toBe(1);
    expect(err.join('\n')).toContain('目标已存在');
  });

  it('模板不存在 → 返回 1 并说明', async () => {
    const root = makeWorkspace();
    const { ctx, err } = context(root);
    expect(await runCreate(['my-game'], ctx)).toBe(1);
    expect(err.join('\n')).toContain('模板不存在');
  });

  it('非法项目名 → 返回 1', async () => {
    const root = makeWorkspace();
    const { ctx, err } = context(root);
    expect(await runCreate(['Bad_Name'], ctx)).toBe(1);
    expect(err.join('\n')).toContain('项目名');
  });

  it('复制模板时跳过 node_modules / build / dist / .vite', async () => {
    const root = makeWorkspace();
    const template = makeTemplate(root);
    mkdirSync(join(template, 'node_modules', 'junk'), { recursive: true });
    writeFileSync(join(template, 'node_modules', 'junk', 'x.js'), '');
    mkdirSync(join(template, 'build'), { recursive: true });
    writeFileSync(join(template, 'build', 'old.js'), '');
    mkdirSync(join(template, '.vite'), { recursive: true });
    writeFileSync(join(template, '.vite', 'cache'), '');

    const { ctx } = context(root);
    expect(await runCreate(['my-game'], ctx)).toBe(0);
    const gameDir = join(root, 'games', 'my-game');
    expect(existsSync(join(gameDir, 'node_modules'))).toBe(false);
    expect(existsSync(join(gameDir, 'build'))).toBe(false);
    expect(existsSync(join(gameDir, '.vite'))).toBe(false);
    expect(existsSync(join(gameDir, 'src', 'main.ts'))).toBe(true);
  });

  // T50 追加：模板里的验证产物 / 美术中间产物不能跟着进新工程（尤其开源后，
  // 新人 mg create 出来一堆与他的游戏无关的过期截图）。按路径跳过，不按目录名。
  it('复制模板时跳过 tools/out 与 artifacts（嵌套产物目录）', async () => {
    const root = makeWorkspace();
    const template = makeTemplate(root);
    mkdirSync(join(template, 'tools', 'out'), { recursive: true });
    writeFileSync(join(template, 'tools', 'out', 'shot.png'), 'png');
    writeFileSync(join(template, 'tools', 'out', 'verify-platform.json'), '{}');
    writeFileSync(join(template, 'tools', 'verify-platform.mjs'), 'export {};\n');
    mkdirSync(join(template, 'artifacts', 'samples'), { recursive: true });
    writeFileSync(join(template, 'artifacts', 'samples', 'bg.png'), 'png');
    writeFileSync(join(template, 'artifacts.md'), '# 边界：名字前缀相同但不是目录\n');

    const { ctx } = context(root);
    expect(await runCreate(['my-game'], ctx)).toBe(0);
    const gameDir = join(root, 'games', 'my-game');
    expect(existsSync(join(gameDir, 'tools', 'out'))).toBe(false);
    expect(existsSync(join(gameDir, 'artifacts'))).toBe(false);
    // tools/ 下的脚本要留下，否则新工程的验证门禁就没了
    expect(existsSync(join(gameDir, 'tools', 'verify-platform.mjs'))).toBe(true);
    // 前缀匹配必须按路径段，不能把 artifacts.md 一起吞掉
    expect(existsSync(join(gameDir, 'artifacts.md'))).toBe(true);
  });

  // T50：模板里的 AGENTS.md 是「给 AI 的工程说明书」，会被复制进每个新工程；
  // 提示里要指路，否则用户/AI 进去仍然只会翻仓库。
  it('模板带 AGENTS.md → 复制进新工程，并在提示里指路', async () => {
    const root = makeWorkspace();
    const template = makeTemplate(root);
    writeFileSync(join(template, 'AGENTS.md'), '# AGENTS.md —— 给 AI 的工程说明书\n');
    const { ctx, out, err } = context(root);
    expect(await runCreate(['my-game'], ctx)).toBe(0);
    expect(existsSync(join(root, 'games', 'my-game', 'AGENTS.md'))).toBe(true);
    expect(out.join('\n')).toContain('先读：games/my-game/AGENTS.md');
    expect(err).toEqual([]);
  });

  it('模板没有 AGENTS.md → 不提示（老模板不误导）', async () => {
    const root = makeWorkspace();
    makeTemplate(root);
    const { ctx, out } = context(root);
    expect(await runCreate(['my-game'], ctx)).toBe(0);
    expect(out.join('\n')).not.toContain('AGENTS.md');
  });
});

describe('默认模板与仓库根校验', () => {
  it('DEFAULT_TEMPLATE 是 iaa-ui', () => {
    expect(DEFAULT_TEMPLATE).toBe('iaa-ui');
  });

  it('默认用 iaa-ui；成功提示含可复制的 node …/mg.mjs dev', async () => {
    const root = makeWorkspace();
    makeTemplate(root);
    const { ctx, out } = context(root);
    expect(await runCreate(['my-game'], ctx)).toBe(0);
    expect(out.join('\n')).toContain('模板 iaa-ui');
    expect(out.join('\n')).toContain('node ../../packages/cli/bin/mg.mjs dev');
    expect(out.join('\n')).toContain('pnpm mg -- dev --root games/my-game');
  });

  it('无 pnpm-workspace → 拒绝（仓库外）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mg-create-out-'));
    made.push(root);
    const { ctx, err } = context(root);
    expect(await runCreate(['my-game'], ctx)).toBe(1);
    expect(err.join('\n')).toMatch(/仓库根|gamekit/);
  });

  it('assertGamekitRoot：缺 templates 报错', () => {
    const root = mkdtempSync(join(tmpdir(), 'mg-create-bad-'));
    made.push(root);
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    mkdirSync(join(root, 'packages'));
    expect(assertGamekitRoot(root)).toMatch(/templates/);
  });
});

it('create的相对--root遵循调用上下文，不依赖进程cwd', async () => {
  const root = makeWorkspace();
  makeTemplate(root);
  const { ctx, err } = context(root);
  expect(await runCreate(['context-game', '--root', '.'], ctx), err.join('\n')).toBe(0);
  expect(existsSync(join(root, 'games', 'context-game', 'src', 'main.ts'))).toBe(true);
});
