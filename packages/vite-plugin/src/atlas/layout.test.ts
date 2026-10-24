import { describe, expect, it } from 'vitest';
import { packLayout } from './layout';
import type { PackItem } from './layout';
import type { PackOptions } from './types';

const OPTS: PackOptions = { maxTextureSize: 128, padding: 2, maxFrameSize: 512 };

const items = (specs: readonly (readonly [string, number, number])[]): PackItem[] =>
  specs.map(([key, width, height]) => ({ key, width, height }));

/** 两矩形是否重叠（只算面积重叠，不留缝）。 */
const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('shelf 排布', () => {
  it('任意两帧不重叠，且间隔 ≥ padding', () => {
    const layout = packLayout(
      items([
        ['a', 40, 30], ['b', 30, 30], ['c', 60, 20], ['d', 20, 50],
        ['e', 50, 40], ['f', 25, 25], ['g', 35, 15],
      ]),
      OPTS,
    );
    const rects = layout.flatMap((page) => page.rects);
    expect(rects.length).toBe(7);
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        // 跨页不算重叠（各自页内坐标）
        const samePage = layout.findIndex((p) => p.rects.includes(rects[i]!))
          === layout.findIndex((p) => p.rects.includes(rects[j]!));
        if (!samePage) continue;
        expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
        // 间隔：x 或 y 方向至少隔 padding
        const gapX = Math.max(rects[j]!.x - (rects[i]!.x + rects[i]!.w), rects[i]!.x - (rects[j]!.x + rects[j]!.w));
        const gapY = Math.max(rects[j]!.y - (rects[i]!.y + rects[i]!.h), rects[i]!.y - (rects[j]!.y + rects[j]!.h));
        expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(OPTS.padding);
      }
    }
  });

  it('每帧都在页内，且离页边 ≥ padding', () => {
    const layout = packLayout(
      items([['a', 60, 40], ['b', 50, 30], ['c', 40, 40], ['d', 30, 20]]),
      OPTS,
    );
    for (const page of layout) {
      expect(page.width).toBe(OPTS.maxTextureSize);
      expect(page.height).toBeLessThanOrEqual(OPTS.maxTextureSize);
      for (const rect of page.rects) {
        expect(rect.x).toBeGreaterThanOrEqual(OPTS.padding);
        expect(rect.y).toBeGreaterThanOrEqual(OPTS.padding);
        expect(rect.x + rect.w + OPTS.padding).toBeLessThanOrEqual(page.width);
        expect(rect.y + rect.h + OPTS.padding).toBeLessThanOrEqual(page.height);
      }
    }
  });

  it('一页装不下就开新页（不放宽约束硬塞）', () => {
    // 64 页宽、padding 2：40 宽的图一行只能放一张 → 三张就是三页
    const layout = packLayout(
      items([['a', 40, 40], ['b', 40, 40], ['c', 40, 40]]),
      { maxTextureSize: 64, padding: 2, maxFrameSize: 512 },
    );
    expect(layout.map((page) => page.name)).toEqual(['atlas-0.png', 'atlas-1.png', 'atlas-2.png']);
    expect(layout.every((page) => page.rects.length === 1)).toBe(true);
  });

  it('同尺寸多张能塞进同一页（一行两张 × 两行）', () => {
    const layout = packLayout(
      items([['a', 20, 20], ['b', 20, 20], ['c', 20, 20], ['d', 20, 20]]),
      { maxTextureSize: 64, padding: 2, maxFrameSize: 512 },
    );
    // 行内：2 + 20 + 2 + 20 + 2 = 46 ≤ 64；第三张要 46+22=68 > 64 → 一行两张
    // 行间：y = 2 / 24，两行共 4 张刚好一页
    expect(layout.length).toBe(1);
    expect(layout[0]!.rects.length).toBe(4);
    expect(layout[0]!.height).toBe(46); // 2 + 20 + 2 + 20 + 2
  });

  it('排布与输入顺序无关（确定性）', () => {
    const a = packLayout(items([['a', 40, 30], ['b', 30, 50], ['c', 20, 20]]), OPTS);
    const b = packLayout(items([['c', 20, 20], ['b', 30, 50], ['a', 40, 30]]), OPTS);
    const flat = (layout: ReturnType<typeof packLayout>): unknown =>
      layout.map((page) => [...page.rects].sort((l, r) => l.key.localeCompare(r.key)));
    expect(flat(a)).toEqual(flat(b));
  });

  it('页高按实际用量裁短（不留大片空白）', () => {
    const layout = packLayout(items([['a', 30, 20]]), { maxTextureSize: 256, padding: 2, maxFrameSize: 512 });
    expect(layout[0]!.height).toBe(2 + 20 + 2);
    expect(layout[0]!.usedHeight).toBe(24);
  });

  it('比一页还大的图不会硬塞（被跳过）', () => {
    const layout = packLayout(items([['huge', 200, 200], ['ok', 20, 20]]), OPTS);
    const keys = layout.flatMap((page) => page.rects.map((rect) => rect.key));
    expect(keys).toEqual(['ok']);
  });

  it('空输入返回空排布', () => {
    expect(packLayout([], OPTS)).toEqual([]);
  });
});
