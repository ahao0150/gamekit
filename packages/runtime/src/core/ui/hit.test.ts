/**
 * 命中判定的契约测试（T13a）。
 *
 * 这组测试守的是真实回归：曾经命中按「声明顺序」找第一个，导致视觉在上、命中在下，
 * 全屏遮罩吃不掉点击。所以顺序类断言（layer / index / 逆序关系）比单点命中更关键。
 */

import { describe, expect, it } from 'vitest';
import { hitTest, pickHit, sortForPaint } from './hit';
import type { HitEntry } from './hit';
import type { Rect } from './contract';

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

const entry = (name: string, over: Partial<HitEntry> = {}): HitEntry => ({
  name,
  rect: rect(0, 0, 100, 100),
  hit: 'self',
  layer: 0,
  index: 0,
  ...over,
});

const CENTER = { x: 50, y: 50 };

describe('pickHit：谁在上面谁先接', () => {
  it('两个重叠元素：layer 大的赢（与数组顺序无关）', () => {
    const bottom = entry('bottom', { layer: 0 });
    const top = entry('top', { layer: 1 });
    expect(pickHit([top, bottom], CENTER)?.name).toBe('top');
    expect(pickHit([bottom, top], CENTER)?.name).toBe('top');
  });

  it('同层：index 大的赢（后声明的画在上）', () => {
    const first = entry('first', { index: 0 });
    const second = entry('second', { index: 1 });
    expect(pickHit([first, second], CENTER)?.name).toBe('second');
    expect(pickHit([second, first], CENTER)?.name).toBe('second');
  });

  it('block 盖在 self 上面：返回 block，不穿透到底层', () => {
    const button = entry('button', { layer: 0, hit: 'self' });
    const mask = entry('mask', { layer: 10, hit: 'block' });
    const picked = pickHit([button, mask], CENTER);
    expect(picked?.name).toBe('mask');
    expect(picked?.hit).toBe('block'); // 调用方据此不执行任何 action
  });

  it('none 盖在 self 上面：穿透，返回下面的 self', () => {
    const button = entry('button', { layer: 0, hit: 'self' });
    const decoration = entry('decoration', { layer: 10, hit: 'none' });
    expect(pickHit([button, decoration], CENTER)?.name).toBe('button');
  });

  it('多个 none 叠在 self 上：一路穿透', () => {
    const button = entry('button', { layer: 0, hit: 'self' });
    const glow = entry('glow', { layer: 5, hit: 'none' });
    const deco = entry('deco', { layer: 9, hit: 'none' });
    expect(pickHit([glow, button, deco], CENTER)?.name).toBe('button');
  });

  it('全 none / 空白处 → null', () => {
    expect(pickHit([entry('a', { hit: 'none' }), entry('b', { layer: 2, hit: 'none' })], CENTER)).toBeNull();
    expect(pickHit([entry('button')], { x: 500, y: 500 })).toBeNull();
    expect(pickHit([], CENTER)).toBeNull();
  });

  it('上层元素矩形不覆盖点击点时，落到下层', () => {
    const bottom = entry('bottom', { layer: 0, rect: rect(0, 0, 100, 100) });
    const top = entry('top', { layer: 1, rect: rect(200, 200, 50, 50) });
    expect(pickHit([bottom, top], CENTER)?.name).toBe('bottom');
  });
});

describe('sortForPaint', () => {
  it('layer 升序、同层 index 升序', () => {
    const entries = [
      entry('c', { layer: 1, index: 0 }),
      entry('a', { layer: 0, index: 1 }),
      entry('b', { layer: 0, index: 0 }),
      entry('d', { layer: 1, index: 1 }),
    ];
    expect(sortForPaint(entries).map((e) => e.name)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('不修改入参（返回新数组）', () => {
    const entries = [entry('b', { index: 1 }), entry('a', { index: 0 })];
    const snapshot = entries.map((e) => e.name);
    const sorted = sortForPaint(entries);
    expect(sorted).not.toBe(entries);
    expect(entries.map((e) => e.name)).toEqual(snapshot);
  });

  it('绘制顺序与 pickHit 的命中顺序严格互为反向', () => {
    const entries = [
      entry('a', { layer: 0, index: 1 }),
      entry('b', { layer: 0, index: 2 }),
      entry('c', { layer: 1, index: 0 }),
      entry('d', { layer: 2, index: 0 }),
    ];
    const paintOrder = sortForPaint(entries).map((e) => e.name);

    // 依次拿走「最上面的」，看 pickHit 的返回序列
    const hitOrder: string[] = [];
    let pool: readonly HitEntry[] = entries;
    for (let i = 0; i < entries.length; i += 1) {
      const picked = pickHit(pool, CENTER);
      if (picked === null) break;
      hitOrder.push(picked.name);
      pool = pool.filter((e) => e.name !== picked.name);
    }

    expect(paintOrder).toEqual(['a', 'b', 'c', 'd']);
    expect(hitOrder).toEqual(['d', 'c', 'b', 'a']);
    expect(hitOrder).toEqual([...paintOrder].reverse());
  });
});

describe('hitTest：单矩形边界', () => {
  it('左闭右开：左上角命中，右下边界不命中', () => {
    const r = rect(10, 10, 100, 50);
    expect(hitTest(r, { x: 10, y: 10 })).toBe(true); // 左上角属于矩形
    expect(hitTest(r, { x: 109.9, y: 59.9 })).toBe(true);
    expect(hitTest(r, { x: 110, y: 30 })).toBe(false); // 右边界开区间
    expect(hitTest(r, { x: 30, y: 60 })).toBe(false); // 下边界开区间
    expect(hitTest(r, { x: 9.9, y: 10 })).toBe(false);
  });

  it('宽或高为 0 / 负数一律不命中', () => {
    expect(hitTest(rect(0, 0, 0, 100), { x: 0, y: 0 })).toBe(false);
    expect(hitTest(rect(0, 0, 100, 0), { x: 0, y: 0 })).toBe(false);
    expect(hitTest(rect(0, 0, -10, -10), { x: 0, y: 0 })).toBe(false);
  });

  it('未定义矩形不命中', () => {
    expect(hitTest(undefined, { x: 0, y: 0 })).toBe(false);
  });

  it('负坐标区域（部分在屏幕外的元素）也能正确判定', () => {
    const r = rect(-10, -10, 20, 20);
    expect(hitTest(r, { x: -5, y: -5 })).toBe(true);
    expect(hitTest(r, { x: -10, y: -10 })).toBe(true);
    expect(hitTest(r, { x: -11, y: -5 })).toBe(false);
    expect(hitTest(r, { x: -5, y: 10 })).toBe(false);
  });

  it('NaN 坐标不命中（判据层不能把坏数据传成命中）', () => {
    expect(hitTest(rect(0, 0, 100, 100), { x: Number.NaN, y: 50 })).toBe(false);
    expect(hitTest(rect(0, 0, 100, 100), { x: 50, y: Number.NaN })).toBe(false);
  });
});
