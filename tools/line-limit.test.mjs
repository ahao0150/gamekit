import { describe, expect, it } from 'vitest';
import {
  HARD_WARN_LINE_LIMIT,
  LONG_FILE_EXEMPT,
  SOFT_LINE_LIMIT,
  checkLineLimit,
} from './line-limit.mjs';

function fileOf(lines, first = '') {
  const body = Array.from({ length: lines }, (_, i) => `line ${i + 1}`);
  if (first !== '') body[0] = first;
  return body;
}

describe('checkLineLimit', () => {
  it('300 行是提醒线以内，返回 ok', () => {
    expect(checkLineLimit('a.ts', fileOf(SOFT_LINE_LIMIT))).toEqual({ level: 'ok' });
  });

  it('301 行返回 notice，且文案含「提醒线 300」', () => {
    const result = checkLineLimit('a.ts', fileOf(SOFT_LINE_LIMIT + 1));
    expect(result.level).toBe('notice');
    expect(result.message).toContain(`提醒线 ${SOFT_LINE_LIMIT}`);
  });

  it('501 行返回 warning，且文案含「警告线 500」', () => {
    const result = checkLineLimit('a.ts', fileOf(HARD_WARN_LINE_LIMIT + 1));
    expect(result.level).toBe('warning');
    expect(result.message).toContain(`警告线 ${HARD_WARN_LINE_LIMIT}`);
  });

  it('前 5 行内有带原因的 @long-file 时豁免', () => {
    const lines = fileOf(HARD_WARN_LINE_LIMIT + 100, `// ${LONG_FILE_EXEMPT} 历史数据表，拆不动`);
    expect(checkLineLimit('a.ts', lines)).toEqual({ level: 'ok' });
  });

  it('@long-file 没写原因时不豁免，并 warning 说明需要写原因', () => {
    const lines = fileOf(SOFT_LINE_LIMIT + 1, `// ${LONG_FILE_EXEMPT}`);
    const result = checkLineLimit('a.ts', lines);
    expect(result.level).not.toBe('ok');
    expect(result.level).toBe('warning');
    expect(result.message).toContain('原因');
  });
});
