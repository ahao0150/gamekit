// @long-file 定高 vs 实渲染 vs 变高三条路径的绘制断言放一处，才看得出「哪条路径漏画」的对照关系
/**
 * `list` 组件测试（T16）：两种模式**真实绘制次数**对比 + 空列表 + 分割线 + list.ui 校验。
 *
 * 团队硬规则：断言「真实绘制发生过」，所以这里数的是 `fillRect` 调用次数和
 * `renderItem` 被调用的下标，而不是只断言「算出来的窗口对不对」。
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Ctx2D } from '../../../platform/contract';
import type { Rect } from '../contract';
import { bindComponents } from '../bind';
import { layout } from '../layout';
import { parse } from '../parse';
import type { DrawDeps } from '../components';
import { list } from './list';
import { createWidgetRegistry } from './index';
import { makeBox, makeDeps, makeEnv, render, spyCtx } from './test-helpers';

/** 10000 项假数据（只有 renderItem 会碰它）。 */
const items = (count: number): readonly number[] => Array.from({ length: count }, (_, i) => i);

/** 带游戏数据的 deps。 */
const withData = (data: Record<string, unknown>): DrawDeps => ({ ...makeDeps(), data });

/** 记录 renderItem 收到的下标与矩形。 */
const recorder = (): { seen: number[]; rects: Rect[]; renderItem: (ctx: Ctx2D, item: unknown, rect: Rect, index: number) => void } => {
  const seen: number[] = [];
  const rects: Rect[] = [];
  return {
    seen,
    rects,
    renderItem: (_ctx: Ctx2D, _item: unknown, rect: Rect, index: number): void => {
      seen.push(index);
      rects.push(rect);
    },
  };
};

/** 视口高 448 = 8 × 56，正好装 8 项（不带头尾部分可见）。 */
const box = makeBox(0, 100, 300, 448);

describe('虚拟渲染 vs 实渲染：真实绘制次数', () => {
  it('virtual=true：10000 项只画视口内的 8 项（不是 10000）', () => {
    const spy = spyCtx();
    const rec = recorder();
    list.def.draw(spy.ctx, box, { itemH: 56 }, withData({ items: items(10000), renderItem: rec.renderItem }));
    expect(rec.seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(spy.fills).toHaveLength(8); // 每项一次背景 fillRect
    // 每一块背景都落在视口内、宽度撑满 box（真实绘制位置，不是「状态对」）
    for (const fill of spy.fills) {
      const [x, y, w, h] = fill.args as [number, number, number, number];
      expect(x).toBe(box.x);
      expect(w).toBe(box.w);
      expect(y).toBeGreaterThanOrEqual(box.y);
      expect(y + h).toBeLessThanOrEqual(box.y + box.h);
    }
  });

  it('绘制前 clip 到自己的框（T31）：部分可见项不溢出容器，save/restore 配对', () => {
    const spy = spyCtx();
    list.def.draw(spy.ctx, box, { itemH: 56 }, withData({ items: items(100), renderItem: () => undefined }));
    expect(spy.clips).toBe(1);
    expect(spy.rects).toContainEqual([box.x, box.y, box.w, box.h]);
    // save/restore 必须配对：不配对的话 clip 会泄漏到之后绘制的所有组件
    expect(spy.saves).toBe(spy.restores);
  });

  it('virtual=false：同样 10000 项，全部画（证明两种模式真的不同）', () => {
    const spy = spyCtx();
    const rec = recorder();
    list.def.draw(spy.ctx, box, { itemH: 56, virtual: false }, withData({ items: items(10000), renderItem: rec.renderItem }));
    expect(rec.seen).toHaveLength(10000);
    expect(rec.seen[0]).toBe(0);
    expect(rec.seen[9999]).toBe(9999);
    expect(spy.fills).toHaveLength(10000);
  });

  it('virtual=true 且滚动到第 100 项：只画 100..107，首项贴视口顶', () => {
    const spy = spyCtx();
    const rec = recorder();
    list.def.draw(spy.ctx, box, { itemH: 56, scrollTop: 5600 }, withData({ items: items(10000), renderItem: rec.renderItem }));
    expect(rec.seen).toEqual([100, 101, 102, 103, 104, 105, 106, 107]);
    expect(rec.rects[0]?.y).toBe(box.y);
    expect(spy.fills[0]?.args[1]).toBe(box.y);
  });
});

describe('布局细节', () => {
  it('gap 生效：第 2 项 y = box.y + itemH + gap，且可见项数按 pitch 算', () => {
    const spy = spyCtx();
    const rec = recorder();
    list.def.draw(spy.ctx, box, { itemH: 56, gap: 8 }, withData({ items: items(10000), renderItem: rec.renderItem }));
    expect(rec.rects[1]?.y).toBe(box.y + 56 + 8);
    expect(rec.seen).toHaveLength(7); // ceil(448 / 64) = 7
    expect(spy.fills).toHaveLength(7);
  });

  it('divider=true：每项背景后跟一条 1px 线，颜色可覆盖', () => {
    const spy = spyCtx();
    list.def.draw(
      spy.ctx,
      box,
      { itemH: 56, divider: true, itemColor: '#111111', dividerColor: '#222222' },
      withData({ items: items(10000), renderItem: () => undefined }),
    );
    expect(spy.fills).toHaveLength(16); // 8 项背景 + 8 条线
    expect(spy.fills[0]?.color).toBe('#111111');
    const line = spy.fills[1];
    expect(line?.color).toBe('#222222');
    expect(line?.args).toEqual([box.x, box.y + 56 - 1, box.w, 1]);
  });

  it('没有 renderItem 时只画背景，不崩', () => {
    const spy = spyCtx();
    list.def.draw(spy.ctx, box, { itemH: 56 }, withData({ items: items(20) }));
    expect(spy.fills).toHaveLength(8);
  });
});

describe('空列表与缺失数据', () => {
  it('空列表画 emptyText 居中', () => {
    const spy = spyCtx();
    list.def.draw(spy.ctx, box, { itemH: 56, emptyText: '暂无内容' }, withData({ items: [] }));
    expect(spy.fills).toHaveLength(0);
    expect(spy.texts).toHaveLength(1);
    expect(spy.texts[0]?.text).toBe('暂无内容');
    expect(spy.texts[0]?.x).toBe(box.x + box.w / 2);
    expect(spy.texts[0]?.y).toBe(box.y + box.h / 2);
  });

  it('空列表且没给 emptyText：什么都不画', () => {
    const spy = spyCtx();
    list.def.draw(spy.ctx, box, { itemH: 56 }, withData({ items: [] }));
    expect(spy.fills).toHaveLength(0);
    expect(spy.texts).toHaveLength(0);
  });

  it('deps 没有 data / items 不是数组：当作空列表，不崩', () => {
    for (const deps of [makeDeps(), withData({ items: 'oops' }), withData({})]) {
      const spy = spyCtx();
      list.def.draw(spy.ctx, box, { itemH: 56, emptyText: '空' }, deps);
      expect(spy.fills).toHaveLength(0);
      expect(spy.texts.map((text) => text.text)).toEqual(['空']);
    }
  });

  it('itemH 非法 / box 高为 0：不绘制，也不抛异常', () => {
    const rec = recorder();
    const deps = withData({ items: items(10), renderItem: rec.renderItem });
    for (const [props, targetBox] of [
      [{ itemH: 0 }, box],
      [{ itemH: -1 }, box],
      [{ itemH: 56 }, makeBox(0, 0, 300, 0)],
    ] as const) {
      const spy = spyCtx();
      expect(() => list.def.draw(spy.ctx, targetBox, props, deps)).not.toThrow();
      expect(spy.fills).toHaveLength(0);
    }
  });
});

describe('measure 与 assert', () => {
  it('measure 回显可用框（高度由外层 fill 决定）', () => {
    expect(list.def.measure(makeEnv(), makeBox(0, 0, 288, 512), {})).toEqual({ w: 288, h: 512 });
  });

  it('assert：itemH <= 0 / gap < 0 / 视口装不下一项都报中文', () => {
    const issues = list.def.assert?.(box, { itemH: 0, gap: -4 }) ?? [];
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues.join(' ')).toContain('itemH');
    expect(issues.join(' ')).toContain('gap');
    expect(list.def.assert?.(makeBox(0, 0, 300, 40), { itemH: 56 })).toHaveLength(1);
    expect(list.def.assert?.(box, { itemH: 56 })).toEqual([]);
  });
});

describe('style 数字串修复（T16）', () => {
  it('badge 的 text="3" 保持字符串，bindComponents 不再报类型错', () => {
    const registry = createWidgetRegistry();
    const parsed = parse('region body fill\nput badge size fixed 24 cross 24 style text="3" dotSize=10\n', {
      knownComponents: registry.names(),
      componentProps: registry.propKeys(),
      fileName: 'quote.ui',
    });
    expect(parsed.errors).toEqual([]);
    const bound = bindComponents(parsed.spec, { registry, env: makeEnv() });
    // 修复前：text 被 coerce 成 number，badge 的参数声明是 string → 这里会有一条 errors
    expect(bound.errors).toEqual([]);
    expect(bound.props.badge).toEqual({ text: '3', dotSize: 10 });
  });
});

describe('list.ui 校验（离线 ui.check 不接注册表，靠这条守住）', () => {
  const source = (): string => readFileSync(new URL('../../../../../../games/ui-demo/ui/list.ui', import.meta.url), 'utf8');
  const registry = createWidgetRegistry();

  it('组件名与参数键全部通过注册表校验', () => {
    const parsed = parse(source(), {
      knownComponents: registry.names(),
      componentProps: registry.propKeys(),
      fileName: 'list.ui',
    });
    expect(parsed.errors).toEqual([]);
    expect([...parsed.components]).toEqual(['label', 'list']);
  });

  it('bindComponents 无错，参数值类型全合法（引号值保持字符串）', () => {
    const parsed = parse(source(), {
      knownComponents: registry.names(),
      componentProps: registry.propKeys(),
      fileName: 'list.ui',
    });
    const bound = bindComponents(parsed.spec, { registry, env: makeEnv() });
    expect(bound.errors).toEqual([]);
    const props = bound.props.list ?? {};
    expect(props.itemH).toBe(56);
    expect(typeof props.emptyText).toBe('string');
  });

  it('两视口布局无错、矩形在视口内且高度 > 0', () => {
    const parsed = parse(source(), {
      knownComponents: registry.names(),
      componentProps: registry.propKeys(),
      fileName: 'list.ui',
    });
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const bound = bindComponents(parsed.spec, { registry, env: makeEnv(viewport.width, viewport.height) });
      const solved = layout(bound.spec, viewport);
      expect(solved.errors, `${viewport.width}×${viewport.height} 布局错误`).toEqual([]);
      const rect = solved.rects.list;
      if (rect === undefined) throw new Error(`${viewport.width} 下 list 没有矩形`);
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
      expect(rect.y + rect.h).toBeLessThanOrEqual(viewport.height + 0.01);
    }
  });
});

/**
 * 变高通道（`data.itemHeights`）：聊天消息这类「按文本变高」的列表走这条。
 *
 * 断言口径与定高部分一致：数**真实绘制**（renderItem 的下标与矩形），
 * 最后一条再做像素等价的覆盖统计 —— 光断言「算出来的窗口对」会漏掉「一格没画」的老坑。
 */
describe('变高通道 data.itemHeights', () => {
  /** 视口 448 下：120 + 80 + 200 = 400，第 3 项（60）部分可见，第 4 项起在视口外 */
  const heights = [120, 80, 200, 60, 40, 100, 90, 70];
  const data = (extra: Record<string, unknown>): DrawDeps => withData({ items: items(8), ...extra });

  it('按各自高度定位（不是 itemH=56），且只画视口内的项', () => {
    const spy = spyCtx();
    const rec = recorder();
    list.def.draw(spy.ctx, box, { itemH: 56 }, data({ itemHeights: heights, renderItem: rec.renderItem }));
    expect(rec.seen).toEqual([0, 1, 2, 3]);
    expect(rec.rects.map((r) => r.h)).toEqual([120, 80, 200, 60]);
    expect(rec.rects.map((r) => r.y)).toEqual([100, 220, 300, 500]);
  });

  it('长度不匹配：抛中文错误并报出两个长度（不静默按短的画）', () => {
    const spy = spyCtx();
    expect(() => list.def.draw(spy.ctx, box, { itemH: 56 }, data({ itemHeights: [10, 20] })))
      .toThrow(/itemHeights 长度 2 与 items 长度 8 不一致/);
  });

  it('没有 itemHeights 时仍走定高（旧界面零改动）', () => {
    const spy = spyCtx();
    const rec = recorder();
    list.def.draw(spy.ctx, box, { itemH: 56 }, data({ renderItem: rec.renderItem }));
    expect(rec.seen).toHaveLength(8);
    expect(new Set(rec.rects.map((r) => r.h))).toEqual(new Set([56]));
  });

  it('滚动后画的是滚动后的那几项（前缀和生效）', () => {
    const spy = spyCtx();
    const rec = recorder();
    // totalH = 760，视口 448 → 最大滚 312；滚 300 后从项 2（offsets 200）之后开始
    list.def.draw(spy.ctx, box, { itemH: 56, scrollTop: 300 }, data({ itemHeights: heights, renderItem: rec.renderItem }));
    expect(rec.seen[0]).toBe(2);
    expect(rec.rects[0]?.y).toBe(box.y - 100); // 300 − (offsets[2]=200) … 顶边在视口上方 100
  });

  it('像素等价断言：气泡真的画出来了（唯一色 ≥ 4、覆盖面积 > 视口 50%）', () => {
    const spy = spyCtx();
    const bubbleColors = ['#112233', '#445566', '#778899', '#aabbcc'];
    list.def.draw(
      spy.ctx,
      box,
      { itemH: 0, itemColor: '#0f0f0f', divider: true, dividerColor: '#eeeeee' },
      data({
        itemHeights: heights,
        renderItem: (ctx: Ctx2D, _item: unknown, rect: Rect, index: number): void => {
          ctx.fillStyle = bubbleColors[index % bubbleColors.length] as string;
          ctx.fillRect(rect.x + 4, rect.y + 4, rect.w - 8, rect.h - 8);
        },
      }),
    );
    // 1) 唯一填充色 ≥ 4（背景 / 分割线 / 气泡多种颜色，不是一片空白）
    const colors = new Set(spy.fills.map((f) => f.color));
    expect(colors.size).toBeGreaterThanOrEqual(4);
    // 2) 被填充的总面积 > 视口 50%（气泡真的铺开了，不是只画了个边框）
    const covered = spy.fills.reduce((sum, f) => sum + (f.args[2] ?? 0) * (f.args[3] ?? 0), 0);
    expect(covered / (box.w * box.h)).toBeGreaterThan(0.5);
  });
});
