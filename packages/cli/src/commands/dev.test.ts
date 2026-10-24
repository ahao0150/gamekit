import { describe, expect, it } from 'vitest';
import { parseArgs } from '../args';
import type { CliContext } from '../shared';
import { DEFAULT_DEV_HOST, resolveDevHost, runDev } from './dev';

const context = (cwd: string): { ctx: CliContext; out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { ctx: { cwd, stdout: (line) => out.push(line), stderr: (line) => err.push(line) }, out, err };
};

describe('resolveDevHost（--host）', () => {
  it('未传 --host → 默认 127.0.0.1', () => {
    expect(DEFAULT_DEV_HOST).toBe('127.0.0.1');
    expect(resolveDevHost(parseArgs([])).host).toBe(DEFAULT_DEV_HOST);
    expect(resolveDevHost(parseArgs(['--port', '5173'])).host).toBe(DEFAULT_DEV_HOST);
  });

  it('自定义 host 原样使用（带值 / = 形式）', () => {
    expect(resolveDevHost(parseArgs(['--host', '0.0.0.0'])).host).toBe('0.0.0.0');
    expect(resolveDevHost(parseArgs(['--host=192.168.1.20'])).host).toBe('192.168.1.20');
    expect(resolveDevHost(parseArgs(['--host', 'localhost'])).host).toBe('localhost');
  });

  it('缺值与空值都是 error，不回退到默认值', () => {
    for (const argv of [['--host'], ['--host', '--strict-port'], ['--host='], ['--host', '   ']]) {
      const result = resolveDevHost(parseArgs(argv));
      expect(result.error, JSON.stringify(argv)).toContain('--host');
      expect(result.host).toBe(DEFAULT_DEV_HOST);
    }
  });
});

describe('runDev：--host 缺值', () => {
  it('缺值 → 退出码 1 并报错（在启动 Vite 之前）', async () => {
    const { ctx, err } = context(process.cwd());
    expect(await runDev(['--host'], ctx)).toBe(1);
    expect(err.join('\n')).toContain('--host');
  });
});
