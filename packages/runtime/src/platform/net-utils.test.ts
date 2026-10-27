/**
 * `platform/net-utils` 的契约测试。
 *
 * 重点是 `lowercaseHeaders`：web 端传进来的是 **`Headers` 实例**，它没有可枚举自有属性 ——
 * `Object.entries(headers)` 返回 `[]`，曾导致 web 端响应头恒为 `{}`（wx/tt 传普通对象所以没事，
 * 只在 web 崩的三端不一致 bug）。第一条用例把「为什么必须走 entries()」钉在测试里。
 */

import { describe, expect, it } from 'vitest';
import { abortError, failMessage, lowercaseHeaders, normalizeBody } from './net-utils';

describe('lowercaseHeaders', () => {
  it('`Headers` 确实没有可枚举自有属性 —— 这就是必须走 entries() 的原因', () => {
    const headers = new Headers({ 'Content-Type': 'application/json', 'X-Total': '42' });
    expect(Object.keys(headers)).toEqual([]);
    expect(Object.entries(headers)).toEqual([]);
    expect([...headers.entries()]).toEqual([
      ['content-type', 'application/json'],
      ['x-total', '42'],
    ]);
  });

  it('真 Headers 实例：能读回全部头且已小写', () => {
    const headers = new Headers({ 'Content-Type': 'application/json', 'X-Total': '42' });
    const out = lowercaseHeaders(headers);
    expect(out['content-type']).toBe('application/json');
    expect(out['x-total']).toBe('42');
    expect(Object.keys(out)).toHaveLength(2);
  });

  it('普通对象（wx/tt 的 res.header）：同样读回并小写', () => {
    const out = lowercaseHeaders({ 'Content-Type': 'application/json', 'X-Total': '42' });
    expect(out).toEqual({ 'content-type': 'application/json', 'x-total': '42' });
  });

  it('数值 value 转成字符串（wx 的 header 偶尔给数字）', () => {
    expect(lowercaseHeaders({ 'X-Retry': 3 })).toEqual({ 'x-retry': '3' });
  });

  it('null / 非对象一律空表，不抛', () => {
    expect(lowercaseHeaders(null)).toEqual({});
    expect(lowercaseHeaders(undefined)).toEqual({});
    expect(lowercaseHeaders('content-type: json')).toEqual({});
    expect(lowercaseHeaders(42)).toEqual({});
  });
});

describe('normalizeBody', () => {
  it('字符串与 ArrayBuffer 原样返回', () => {
    expect(normalizeBody('{"a":1}')).toBe('{"a":1}');
    const bytes = new Uint8Array([1, 2]).buffer;
    expect(normalizeBody(bytes)).toBe(bytes);
  });

  it('null / undefined → null', () => {
    expect(normalizeBody(null)).toBeNull();
    expect(normalizeBody(undefined)).toBeNull();
  });

  it('意外拿到对象（老基础库自作主张 JSON.parse）→ 序列化回文本', () => {
    expect(normalizeBody({ a: 1 })).toBe('{"a":1}');
  });
});

describe('abortError / failMessage', () => {
  it('abortError 的 name 是 AbortError（平台层与 core 的约定）', () => {
    const err = abortError('请求已取消');
    expect(err.name).toBe('AbortError');
    expect(err.message).toBe('请求已取消');
  });

  it('failMessage 优先取 errMsg，其次 message，最后兜底', () => {
    expect(failMessage({ errMsg: 'request:fail timeout' }, '兜底')).toBe('request:fail timeout');
    expect(failMessage(new Error('boom'), '兜底')).toBe('boom');
    expect(failMessage(undefined, '兜底')).toBe('兜底');
  });
});
