/**
 * `aspect` 原语（v0.7）的**求解语义**：已知轴推导、方向、fill 钳制、报错文案。
 *
 * 口径（与 `layout-aspect.ts` 头注释、`docs/ui-syntax.md` §4.2 一致）：
 * `aspect` 是 `put` 的同级修饰词，值统一是 `w / h`，**必须且只能有一个已知轴**。
 *
 * 换算方向（不能搞反）：
 * - `column`：交叉轴 = 宽 `w`、主轴 = 高 `h`；已知 `w` → `h = w / r`，已知 `h` → `w = h × r`
 * - `row`：交叉轴 = 高 `h`、主轴 = 宽 `w`；已知 `h` → `w = h × r`，已知 `w` → `h = w / r`
 *
 * 解析 / 语法表 / 全量 `.ui` 回归在 `layout-aspect-parse.test.ts`（拆开是为了守 300 行提醒线）。
 */

import { describe, expect, it } from 'vitest';
import { fill, ratio } from './layout';
import { rectOf, solve } from './layout-aspect.helpers';

describe('aspect：column（交叉轴 = 宽，主轴 = 高）', () => {
  it('cross 100% + aspect 1 → 100×100', () => {
    const result = solve(100, 400, 'column', 'start', [
      { name: 'cover', size: undefined, cross: ratio(1), aspect: 1 },
    ]);
    expect(rectOf(result, 'cover')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(result.errors).toEqual([]);
  });

  it('cross 100% + aspect 16:9 → w=100、h=56.25', () => {
    const result = solve(100, 400, 'column', 'start', [
      { name: 'cover', cross: ratio(1), aspect: 1.7778 },
    ]);
    expect(rectOf(result, 'cover')).toEqual({ x: 0, y: 0, w: 100, h: 56.25 });
    expect(result.errors).toEqual([]);
  });

  it('size 100 + aspect 16:9 → h=100、w=177.78', () => {
    const result = solve(100, 400, 'column', 'start', [{ name: 'banner', size: 100, aspect: 1.7778 }]);
    expect(rectOf(result, 'banner')).toEqual({ x: 0, y: 0, w: 177.78, h: 100 });
    expect(result.errors).toEqual([]);
  });

  it('aspect 推出的主轴参与 cursor 推进（第二个元素紧接其后）', () => {
    const result = solve(100, 400, 'column', 'start', [
      { name: 'a', cross: ratio(1), aspect: 1 },
      { name: 'b', cross: ratio(1), size: 40 },
    ]);
    expect(rectOf(result, 'a')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(rectOf(result, 'b')).toEqual({ x: 0, y: 100, w: 100, h: 40 });
  });
});

describe('aspect：row（交叉轴 = 高，主轴 = 宽）', () => {
  it('cross 100（高）+ aspect 16:9 → h=100、w=177.78', () => {
    const result = solve(380, 100, 'row', 'start', [{ name: 'cover', cross: 100, aspect: 1.7778 }]);
    expect(rectOf(result, 'cover')).toEqual({ x: 0, y: 0, w: 177.78, h: 100 });
    expect(result.errors).toEqual([]);
  });

  it('size 100（宽）+ aspect 16:9 → w=100、h=56.25', () => {
    const result = solve(380, 100, 'row', 'start', [{ name: 'cover', size: 100, aspect: 1.7778 }]);
    expect(rectOf(result, 'cover')).toEqual({ x: 0, y: 0, w: 100, h: 56.25 });
    expect(result.errors).toEqual([]);
  });
});

describe('aspect：align stretch 当已知轴', () => {
  it('stretch + aspect 1 → 两轴都等于容器交叉轴', () => {
    const result = solve(100, 400, 'column', 'stretch', [{ name: 'cover', aspect: 1 }]);
    expect(rectOf(result, 'cover')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(result.errors).toEqual([]);
  });

  it('size 确定时 stretch 让位给 aspect（否则交叉轴永远算不出）', () => {
    const result = solve(100, 400, 'column', 'stretch', [{ name: 'banner', size: 100, aspect: 1.7778 }]);
    expect(rectOf(result, 'banner')).toEqual({ x: 0, y: 0, w: 177.78, h: 100 });
    expect(result.errors).toEqual([]);
  });
});

describe('aspect：size fill（v0.7 修正后合法）', () => {
  it('fill + aspect 1：主轴取剩余空间、两轴相等（容器 200×100，另一元素 50）', () => {
    const result = solve(200, 100, 'column', 'start', [
      { name: 'cover', size: fill, aspect: 1 },
      { name: 'footer', size: 50, cross: ratio(1) },
    ]);
    expect(rectOf(result, 'cover')).toEqual({ x: 0, y: 0, w: 50, h: 50 });
    expect(result.errors).toEqual([]);
  });

  it('fill + aspect 1：交叉轴装不下时主轴被钳到 crossLen，差额交给 justify', () => {
    // 容器 60 宽 × 100 高：mainLimit = 60，flexSize = 100 → main = 60，free = 40
    const result = solve(60, 100, 'column', 'start', [{ name: 'cover', size: fill, aspect: 1 }], 'center');
    expect(rectOf(result, 'cover')).toEqual({ x: 0, y: 20, w: 60, h: 60 });
    expect(result.errors).toEqual([]);
  });

  it('fill + aspect 1：320 档真实数字（可用 318.25、cross 260.92 → 260.92×260.92）', () => {
    const result = solve(260.92, 318.25, 'column', 'start', [
      { name: 'cover', size: fill, aspect: 1 },
    ]);
    expect(rectOf(result, 'cover')).toEqual({ x: 0, y: 0, w: 260.92, h: 260.92 });
    expect(result.errors).toEqual([]);
  });

  it('align stretch + size fill + aspect：stretch 不生效，结果与 start 一致', () => {
    const result = solve(200, 100, 'column', 'stretch', [
      { name: 'cover', size: fill, aspect: 1 },
      { name: 'footer', size: 50, cross: ratio(1) },
    ]);
    expect(rectOf(result, 'cover')).toEqual({ x: 0, y: 0, w: 50, h: 50 });
    expect(result.errors).toEqual([]);
  });

  it('fill + aspect 16:9：column 的主轴上限 = crossLen / r', () => {
    // 容器 100 宽 × 400 高：mainLimit = 100 / 1.7778 = 56.25 < flexSize 400
    const result = solve(100, 400, 'column', 'start', [{ name: 'banner', size: fill, aspect: 1.7778 }]);
    expect(rectOf(result, 'banner')).toEqual({ x: 0, y: 0, w: 100, h: 56.25 });
    expect(result.errors).toEqual([]);
  });

  it('fill + aspect 16:9：row 的主轴上限 = crossLen × r', () => {
    // 容器 380 宽 × 100 高（row 的 cross 是高）：mainLimit = 100 × 1.7778 = 177.78
    const result = solve(380, 100, 'row', 'start', [{ name: 'banner', size: fill, aspect: 1.7778 }]);
    expect(rectOf(result, 'banner')).toEqual({ x: 0, y: 0, w: 177.78, h: 100 });
    expect(result.errors).toEqual([]);
  });

  it('free 只按 fill 部分算（定长不重复扣）：定长 20 + 被钳到 60 的 fill', () => {
    // 容器 60 宽 × 100 高：remain = 80、flexSize = 80、mainLimit = 60
    // 正确 free = 80 − 60 = 20（center → offset 10）；把定长也减进去会得 0、整体上移 10
    const result = solve(
      60,
      100,
      'column',
      'start',
      [
        { name: 'head', size: 20, cross: ratio(1) },
        { name: 'cover', size: fill, aspect: 1 },
      ],
      'center',
    );
    expect(rectOf(result, 'head')).toEqual({ x: 0, y: 10, w: 60, h: 20 });
    expect(rectOf(result, 'cover')).toEqual({ x: 0, y: 30, w: 60, h: 60 });
    expect(result.errors).toEqual([]);
  });

  it('fill + 确定 cross + aspect → 轴冲突（两轴都被别的规则占了）', () => {
    const result = solve(200, 100, 'column', 'start', [
      { name: 'cover', size: fill, cross: 80, aspect: 1 },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('aspect 的轴冲突');
  });

  it('fill + aspect 不影响其它 fill 元素的大小（差额进 free，不重新分配）', () => {
    // 容器 60 宽 × 200 高，两个 fill：flexSize=100，A 被 cross 钳到 60，B 仍是 100
    const result = solve(60, 200, 'column', 'start', [
      { name: 'a', size: fill, aspect: 1 },
      { name: 'b', size: fill, cross: ratio(1) },
    ]);
    expect(rectOf(result, 'a')).toEqual({ x: 0, y: 0, w: 60, h: 60 });
    expect(rectOf(result, 'b')).toEqual({ x: 0, y: 60, w: 60, h: 100 });
    expect(result.errors).toEqual([]);
  });
});

describe('aspect：报错（错误进 errors，不抛异常）', () => {
  it('size 与 cross 同时确定 + aspect → 轴冲突', () => {
    const result = solve(100, 400, 'column', 'start', [
      { name: 'cover', size: 100, cross: 50, aspect: 1 },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('aspect 的轴冲突');
  });

  it('只有 aspect（无 size 无 cross 且不是 stretch）→ 缺已知轴', () => {
    const result = solve(100, 400, 'column', 'start', [{ name: 'cover', aspect: 1 }]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('aspect 缺少已知轴');
  });

  it('aspect <= 0 在手写 spec 上也拦（不产出 NaN rect）', () => {
    const result = solve(100, 400, 'column', 'start', [{ name: 'cover', cross: ratio(1), aspect: 0 }]);
    expect(result.errors[0]).toContain('aspect 的比值必须大于 0');
    expect(Number.isFinite(rectOf(result, 'cover').w)).toBe(true);
  });
});
