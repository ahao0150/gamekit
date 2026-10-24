import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REQUIRED_NODE_MAJOR, collectChecks, exitCodeOf } from './doctor';

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

  it('模板与产物缺失只给 warn，不拉高退出码', () => {
    const checks = collectChecks(makeRoot(), null);
    expect(checks.some((c) => c.level === 'warn' && c.message.includes('templates/iaa-ui'))).toBe(true);
    expect(checks.some((c) => c.level === 'warn' && c.message.includes('产物目录'))).toBe(true);
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
