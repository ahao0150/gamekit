import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CliContext } from '../shared';
import type { ArtifactFile, CheckInput } from './check';
import { inspectArtifacts, MAIN_LIMIT_BYTES, runCheck } from './check';

const MB = 1024 * 1024;

const wxBase = (): ArtifactFile[] => [
  { relative: 'game.js', bytes: 4000 },
  { relative: 'game.json', bytes: 100 },
  { relative: 'project.config.json', bytes: 200 },
  { relative: 'asset-manifest.json', bytes: 100 },
  { relative: 'assets/ui/btn.png', bytes: 3 },
];

const gameJsonBase = (): Record<string, unknown> => ({
  deviceOrientation: 'portrait',
  showStatusBar: false,
});

const manifestBase = (): Record<string, unknown> => ({
  'ui.btn': ['assets/ui/btn.png'],
});

const inspect = (over: Partial<CheckInput> = {}) =>
  inspectArtifacts({
    target: 'wx',
    files: wxBase(),
    gameJson: gameJsonBase(),
    manifest: manifestBase(),
    ...over,
  });

const errorsOf = (outcome: ReturnType<typeof inspect>): string[] =>
  outcome.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message);

describe('inspectArtifacts：合规产物', () => {
  it('wx 产物齐全 → 无 error，主包计入全部字节', () => {
    const outcome = inspect();
    expect(errorsOf(outcome)).toEqual([]);
    expect(outcome.ok).toBe(true);
    expect(outcome.mainBytes).toBe(4000 + 100 + 200 + 100 + 3);
  });

  it('web 产物齐全（index.html + game.js）→ 通过', () => {
    const outcome = inspect({
      target: 'web',
      files: [
        { relative: 'index.html', bytes: 500 },
        { relative: 'game.js', bytes: 9000 },
        { relative: 'asset-manifest.json', bytes: 100 },
      ],
      gameJson: null,
      manifest: {},
    });
    expect(errorsOf(outcome)).toEqual([]);
    expect(outcome.ok).toBe(true);
  });

  it('清单为空只给 warn，不算失败', () => {
    const outcome = inspect({ manifest: {} });
    expect(outcome.ok).toBe(true);
    expect(outcome.issues.filter((issue) => issue.level === 'warn')).toHaveLength(1);
  });

  it('红线常量为 3MB', () => {
    expect(MAIN_LIMIT_BYTES).toBe(3 * MB);
  });
});

describe('inspectArtifacts：入口与包体', () => {
  it('web 缺 index.html 与 game.js 都报 error', () => {
    const outcome = inspect({ target: 'web', files: [], gameJson: null });
    const messages = errorsOf(outcome).join('|');
    expect(messages).toContain('index.html');
    expect(messages).toContain('game.js');
  });

  it('wx 缺 game.js 报 error', () => {
    const outcome = inspect({ files: wxBase().filter((file) => file.relative !== 'game.js') });
    expect(errorsOf(outcome).join('|')).toContain('game.js');
  });

  it('主包超过 3MB 团队发布线 → 失败', () => {
    const big = 3.5 * MB;
    const outcome = inspect({
      files: [...wxBase(), { relative: 'assets/big.bin', bytes: big }],
      manifest: { ...manifestBase(), 'ui.big': ['assets/big.bin'] },
    });
    expect(outcome.ok).toBe(false);
    expect(errorsOf(outcome).join('|')).toContain('3MB');
  });

  it('分包目录的字节不计入主包', () => {
    const big = 3.5 * MB;
    const outcome = inspect({
      gameJson: { ...gameJsonBase(), subpackages: [{ name: 'sub', root: 'subpackages/sub/' }] },
      files: [...wxBase(), { relative: 'subpackages/sub/level.bin', bytes: big }],
      manifest: { ...manifestBase(), 'sub.level': ['subpackages/sub/level.bin'] },
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.mainBytes).toBeLessThan(MB);
  });
});

describe('inspectArtifacts：game.json 与产物目录一致', () => {
  it('声明的分包在产物里没有文件 → error', () => {
    const outcome = inspect({
      gameJson: { ...gameJsonBase(), subpackages: [{ name: 'sub', root: 'subpackages/sub/' }] },
    });
    expect(errorsOf(outcome).join('|')).toContain('没有文件');
  });

  it('分包 root 不符合 subpackages/<name>/ 约定 → error', () => {
    const outcome = inspect({
      gameJson: { ...gameJsonBase(), subpackages: [{ name: 'sub', root: 'sub/' }] },
      files: [...wxBase(), { relative: 'sub/level.bin', bytes: 10 }],
    });
    expect(errorsOf(outcome).join('|')).toContain('root 应为');
  });

  it('产物分包目录未在 game.json 声明 → error', () => {
    const outcome = inspect({ files: [...wxBase(), { relative: 'subpackages/sub/a.png', bytes: 10 }] });
    expect(errorsOf(outcome).join('|')).toContain('未在 game.json.subpackages 声明');
  });

  it('产物顶层出现未知目录 → error', () => {
    const outcome = inspect({ files: [...wxBase(), { relative: 'extra/a.png', bytes: 10 }] });
    expect(errorsOf(outcome).join('|')).toContain('不属于主包 assets/ 或分包 subpackages/');
  });

  it('game.json 缺失/无法解析 → error', () => {
    expect(errorsOf(inspect({ gameJson: null })).join('|')).toContain('game.json');
  });
});

describe('inspectArtifacts：资源清单与产物一致', () => {
  it('清单登记的路径在产物里不存在 → error（客户端会 404）', () => {
    const outcome = inspect({ manifest: { ...manifestBase(), ghost: ['assets/ghost.png'] } });
    expect(errorsOf(outcome).join('|')).toContain('不存在');
  });

  it('清单条目不是候选路径数组 → error', () => {
    const outcome = inspect({ manifest: { 'ui.btn': 'assets/ui/btn.png' } });
    expect(errorsOf(outcome).join('|')).toContain('没有候选路径');
  });

  it('清单条目里含非字符串路径 → error', () => {
    const outcome = inspect({ manifest: { 'ui.btn': [42] } });
    expect(errorsOf(outcome).join('|')).toContain('非法路径');
  });

  it('清单文件缺失 → error', () => {
    expect(errorsOf(inspect({ manifest: null })).join('|')).toContain('asset-manifest.json');
  });
});

const made: string[] = [];

const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'mg-check-'));
  made.push(root);
  return root;
};

const writeWxArtifacts = (root: string): string => {
  const dir = join(root, 'build', 'wx');
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'game.js'), 'x');
  writeFileSync(join(dir, 'game.json'), JSON.stringify({ deviceOrientation: 'portrait' }));
  writeFileSync(join(dir, 'project.config.json'), '{}');
  writeFileSync(join(dir, 'assets', 'btn.png'), 'png');
  writeFileSync(join(dir, 'asset-manifest.json'), JSON.stringify({ 'ui.btn': ['assets/btn.png'] }));
  return dir;
};

const context = (cwd: string): { ctx: CliContext; out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    ctx: { cwd, stdout: (line) => out.push(line), stderr: (line) => err.push(line) },
    out,
    err,
  };
};

afterEach(() => {
  while (made.length > 0) rmSync(made.pop() ?? '', { recursive: true, force: true });
});

describe('runCheck（真实产物目录）', () => {
  it('合规产物 → 0，输出 check 通过', async () => {
    const root = makeRoot();
    writeWxArtifacts(root);
    const { ctx, out } = context(root);
    expect(await runCheck(['--target', 'wx'], ctx)).toBe(0);
    expect(out.join('\n')).toContain('check 通过');
  });

  it('清单指向不存在的资源 → 1，并指出 404 风险', async () => {
    const root = makeRoot();
    const dir = writeWxArtifacts(root);
    writeFileSync(
      join(dir, 'asset-manifest.json'),
      JSON.stringify({ 'ui.btn': ['assets/btn.png'], ghost: ['assets/ghost.png'] }),
    );
    const { ctx, out } = context(root);
    expect(await runCheck(['--target', 'wx'], ctx)).toBe(1);
    expect(out.join('\n')).toContain('不存在');
  });

  it('显式目标但产物目录不存在 → 1', async () => {
    const root = makeRoot();
    const { ctx, err } = context(root);
    expect(await runCheck(['--target', 'tt'], ctx)).toBe(1);
    expect(err.join('\n')).toContain('不存在');
  });

  it('完全没有产物 → 1，提示先构建', async () => {
    const root = makeRoot();
    const { ctx, err } = context(root);
    expect(await runCheck([], ctx)).toBe(1);
    expect(err.join('\n')).toContain('没有任何可检查的产物');
  });
});
