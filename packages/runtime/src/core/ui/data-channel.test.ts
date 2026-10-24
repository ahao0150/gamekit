import { describe, expect, it } from 'vitest';
import { resolveUiData } from './data-channel';

describe('resolveUiData', () => {
  it('两边都空 → 无错', () => {
    expect(resolveUiData({}, undefined)).toEqual({ data: {}, errors: [] });
    expect(resolveUiData({}, {})).toEqual({ data: {}, errors: [] });
  });

  it('布局有数据、绘制未传 → 报漏传，仍返回布局数据', () => {
    const out = resolveUiData({ items: [1, 2] }, undefined);
    expect(out.data).toEqual({ items: [1, 2] });
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain('绘制期未传入 data');
  });

  it('绘制缺布局已有键 → 报缺键；draw 覆盖同名', () => {
    const out = resolveUiData({ items: [1], cols: 3 }, { items: [9] });
    expect(out.data).toEqual({ items: [9], cols: 3 });
    expect(out.errors[0]).toContain('cols');
  });

  it('绘制覆盖齐全 → 无错', () => {
    const out = resolveUiData({ items: [1], cols: 3 }, { items: [1], cols: 3, extra: true });
    expect(out.errors).toEqual([]);
    expect(out.data).toEqual({ items: [1], cols: 3, extra: true });
  });
});
