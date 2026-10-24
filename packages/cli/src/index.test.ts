import { describe, expect, it } from 'vitest';
import { COMMAND_HELP, COMMANDS, main, USAGE } from './index';
import type { CliContext } from './shared';

const capture = (cwd: string): { ctx: CliContext; out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { ctx: { cwd, stdout: (line) => out.push(line), stderr: (line) => err.push(line) }, out, err };
};

describe('main 调度', () => {
  it('无参数 / help / -h / --help 打印用法并返回 0', async () => {
    for (const argv of [[], ['help'], ['-h'], ['--help']]) {
      const { ctx, out } = capture(process.cwd());
      expect(await main(argv, ctx)).toBe(0);
      expect(out.join('\n')).toContain('用法');
    }
    expect(USAGE).toContain('用法');
    expect(USAGE).toContain('build');
    expect(USAGE).toContain('doctor');
  });

  it('未知命令返回 1 并提示', async () => {
    const { ctx, err } = capture(process.cwd());
    expect(await main(['nope'], ctx)).toBe(1);
    expect(err.join('\n')).toContain('未知命令');
  });

  it('命令缺参数返回 1（create 缺项目名）', async () => {
    const { ctx, err } = capture(process.cwd());
    expect(await main(['create'], ctx)).toBe(1);
    expect(err.join('\n')).toContain('缺少项目名');
  });

  it('命令内 -h 只打印用法，不执行命令', async () => {
    const { ctx, out } = capture(process.cwd());
    expect(await main(['build', '-h'], ctx)).toBe(0);
    expect(out.join('\n')).toContain('用法');
  });

  it('`mg <命令> --help` 打印**该命令**的帮助并返回 0（不是整份命令表）', async () => {
    for (const command of Object.keys(COMMANDS)) {
      const { ctx, out } = capture(process.cwd());
      expect(await main([command, '--help'], ctx), `${command} --help 退出码`).toBe(0);
      const text = out.join('\n');
      // 是子命令帮助：带自己的用法行
      expect(text, `${command} 缺自己的用法行`).toContain(`用法：mg ${command}`);
      // 不是总帮助：不应出现别的命令的 create 用法行
      expect(text, `${command} --help 打成了总帮助`).not.toContain('mg create <name> [--template <名>]               从模板');
    }
  });

  it('每个命令都有子命令帮助，且写清了参数', () => {
    for (const command of Object.keys(COMMANDS)) {
      const help = COMMAND_HELP[command];
      expect(help, `${command} 缺 COMMAND_HELP`).toBeDefined();
      if (help === undefined) continue;
      expect(help).toContain(`mg ${command}`);
      expect(help).toContain('--help');
    }
    // 命令表与帮助表不能漂移（新增命令忘了写帮助）
    expect(Object.keys(COMMAND_HELP).sort()).toEqual(Object.keys(COMMANDS).sort());
  });
});
