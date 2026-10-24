import { describe, expect, it } from 'vitest';
import { computeReport, formatReport, kb, listFiles } from './report';
import { MAIN_LIMIT_BYTES } from './types';

const file = (relative: string, bytes: number): { relative: string; bytes: number } => ({
  relative,
  bytes,
});

describe('listFiles', () => {
  it('目录不存在返回空数组', () => {
    expect(listFiles('/definitely/not/here')).toEqual([]);
  });
});

describe('computeReport', () => {
  it('主包不含 subpackages/ 目录，分包单独统计', () => {
    const report = computeReport(
      [
        file('game.js', 100),
        file('assets/a.webp', 50),
        file('subpackages/city/assets/bg.webp', 70),
      ],
      ['city'],
    );
    expect(report.main).toBe(150);
    expect(report.total).toBe(220);
    expect(report.subpackages).toEqual([{ name: 'city', bytes: 70 }]);
    expect(report.files).toBe(3);
    expect(report.ok).toBe(true);
  });

  it('主包超 4MB 硬限时 ok=false', () => {
    const report = computeReport([file('game.js', MAIN_LIMIT_BYTES + 1)], []);
    expect(report.ok).toBe(false);
    expect(report.limitBytes).toBe(MAIN_LIMIT_BYTES);
  });

  it('未在配置里声明的分包也会被统计（不会算进主包）', () => {
    const report = computeReport([file('subpackages/extra/assets/x.webp', 10)], []);
    expect(report.main).toBe(0);
    expect(report.subpackages).toEqual([{ name: 'extra', bytes: 10 }]);
  });
});

describe('formatReport', () => {
  it('web 只报总量，不提主包红线', () => {
    const text = formatReport(computeReport([file('game.js', 2048)], []), 'web');
    expect(text).toContain('mg 产物（web）');
    expect(text).not.toContain('主包');
  });

  it('wx 超限打红字并保留明细', () => {
    const report = computeReport([file('game.js', MAIN_LIMIT_BYTES + 1)], []);
    const text = formatReport(report, 'wx');
    expect(text).toContain('\x1b[31m');
    expect(text).toContain('4MB');
  });

  it('kb 保留一位小数', () => {
    expect(kb(1536)).toBe(1.5);
  });
});
