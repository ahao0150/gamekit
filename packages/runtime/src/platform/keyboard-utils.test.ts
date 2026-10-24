/**
 * 软键盘参数归一的契约测试。
 *
 * 这三条归一看着琐碎，但它们是「同一个值在三端表达同一件事」的唯一保证：
 * `maxLength: 0` 在 HTML 里是「一个字符都不许输」，而很多人会以为是「不限制」；
 * 一旦 web 按 0、微信按不传处理，同一个游戏在两个平台就是两种行为。
 */

import { describe, expect, it } from 'vitest';
import {
  NO_MAX_LENGTH,
  normalizeConfirmType,
  normalizeDefaultValue,
  normalizeKeyboardOptions,
  normalizeMaxLength,
} from './keyboard-utils';

describe('normalizeMaxLength', () => {
  it('0 保留（= 一个字符都不许输，与 input.maxLength 一致）', () => {
    expect(normalizeMaxLength(0)).toBe(0);
  });

  it('负数 / NaN / undefined → 不限制', () => {
    expect(normalizeMaxLength(-1)).toBe(NO_MAX_LENGTH);
    expect(normalizeMaxLength(-99)).toBe(NO_MAX_LENGTH);
    expect(normalizeMaxLength(Number.NaN)).toBe(NO_MAX_LENGTH);
    expect(normalizeMaxLength(undefined)).toBe(NO_MAX_LENGTH);
  });

  it('小数向下取整', () => {
    expect(normalizeMaxLength(12.9)).toBe(12);
  });

  it('NO_MAX_LENGTH 就是 -1（与 HTMLInputElement.maxLength 的无限制值一致）', () => {
    expect(NO_MAX_LENGTH).toBe(-1);
  });
});

describe('normalizeConfirmType', () => {
  it('四个合法值原样返回', () => {
    for (const v of ['done', 'next', 'search', 'send'] as const) {
      expect(normalizeConfirmType(v)).toBe(v);
    }
  });

  it('非法值 / undefined / 非字符串 → done', () => {
    expect(normalizeConfirmType('瞎写')).toBe('done');
    expect(normalizeConfirmType(undefined)).toBe('done');
    expect(normalizeConfirmType(123)).toBe('done');
    expect(normalizeConfirmType(null)).toBe('done');
    expect(normalizeConfirmType('DONE')).toBe('done'); // 大小写不宽容，透传给系统会失败
  });
});

describe('normalizeDefaultValue', () => {
  it('字符串原样返回（含空串）', () => {
    expect(normalizeDefaultValue('你好')).toBe('你好');
    expect(normalizeDefaultValue('')).toBe('');
  });

  it('非字符串 → 空串', () => {
    expect(normalizeDefaultValue(undefined)).toBe('');
    expect(normalizeDefaultValue(42)).toBe('');
    expect(normalizeDefaultValue({ a: 1 })).toBe('');
  });
});

describe('normalizeKeyboardOptions', () => {
  it('undefined → 一套安全的默认值', () => {
    expect(normalizeKeyboardOptions()).toEqual({
      defaultValue: '',
      maxLength: NO_MAX_LENGTH,
      confirmType: 'done',
    });
  });

  it('合法参数全透传', () => {
    expect(
      normalizeKeyboardOptions({ defaultValue: 'abc', maxLength: 6, confirmType: 'next' }),
    ).toEqual({ defaultValue: 'abc', maxLength: 6, confirmType: 'next' });
  });
});
