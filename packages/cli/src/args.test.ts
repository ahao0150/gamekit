import { describe, expect, it } from 'vitest';
import { boolFlag, parseArgs, portFlag, stringFlag } from './args';

describe('parseArgs', () => {
  it('位置参数 + 带值选项', () => {
    const parsed = parseArgs(['my-game', '--template', 'iaa-simple']);
    expect(parsed.positionals).toEqual(['my-game']);
    expect(parsed.flags).toEqual({ template: 'iaa-simple' });
  });

  it('--flag=value 形式', () => {
    const parsed = parseArgs(['--target=wx', '--out-dir=dist/wx']);
    expect(parsed.flags).toEqual({ target: 'wx', 'out-dir': 'dist/wx' });
  });

  it('布尔选项与短选项', () => {
    const parsed = parseArgs(['--all', '-h', '--write']);
    expect(boolFlag(parsed, 'all')).toBe(true);
    expect(boolFlag(parsed, 'write')).toBe(true);
    expect(boolFlag(parsed, 'h')).toBe(true);
    expect(parsed.positionals).toEqual([]);
  });

  it('缺值的选项不会吞掉下一个选项', () => {
    const parsed = parseArgs(['--target', '--all']);
    expect(parsed.flags['target']).toBe(true);
    expect(boolFlag(parsed, 'all')).toBe(true);
  });

  it('-- 之后全部当位置参数（含 - 开头）', () => {
    const parsed = parseArgs(['--all', '--', '--not-a-flag', 'x']);
    expect(parsed.positionals).toEqual(['--not-a-flag', 'x']);
    expect(boolFlag(parsed, 'all')).toBe(true);
  });

  it('stringFlag 只在值确实是字符串时返回', () => {
    const parsed = parseArgs(['--all', '--target', 'tt']);
    expect(stringFlag(parsed, 'all')).toBeUndefined();
    expect(stringFlag(parsed, 'target')).toBe('tt');
    expect(stringFlag(parsed, 'missing')).toBeUndefined();
  });
});

describe('portFlag', () => {
  it('合法端口原样返回', () => {
    expect(portFlag(parseArgs(['--port', '5173']), 'port')).toBe(5173);
    expect(portFlag(parseArgs(['--port=8080']), 'port')).toBe(8080);
    expect(portFlag(parseArgs(['--port', '1']), 'port')).toBe(1);
    expect(portFlag(parseArgs(['--port', '65535']), 'port')).toBe(65535);
  });

  it('缺值与未传都是 undefined', () => {
    // 缺值：`--port` 后面直接跟另一个选项 → 值被吞成布尔 true
    expect(portFlag(parseArgs(['--port', '--all']), 'port')).toBeUndefined();
    expect(portFlag(parseArgs(['--port']), 'port')).toBeUndefined();
    expect(portFlag(parseArgs([]), 'port')).toBeUndefined();
  });

  it('数字非法一律 undefined：负数 / 小数 / 字母 / 空串 / 带 + 号', () => {
    expect(portFlag(parseArgs(['--port=-1']), 'port')).toBeUndefined();
    expect(portFlag(parseArgs(['--port', '80.5']), 'port')).toBeUndefined();
    expect(portFlag(parseArgs(['--port', 'abc']), 'port')).toBeUndefined();
    expect(portFlag(parseArgs(['--port=']), 'port')).toBeUndefined();
    expect(portFlag(parseArgs(['--port', '+8080']), 'port')).toBeUndefined();
  });

  it('越界端口 undefined：0 与 65536', () => {
    expect(portFlag(parseArgs(['--port', '0']), 'port')).toBeUndefined();
    expect(portFlag(parseArgs(['--port', '65536']), 'port')).toBeUndefined();
  });
});
