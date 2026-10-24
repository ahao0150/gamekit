import { expect, it } from 'vitest';
import { readRenderContent, scroll } from './scroll';
import { makeBox, makeDeps, render } from './test-helpers';
import type { Ctx2D } from '../../../platform/contract';
import type { DrawDeps } from '../components';
import type { Rect } from '../contract';
import { DEFAULT_THEME } from '../components';

const BOX = makeBox(10, 100, 300, 200);

interface ContentCall {
  readonly box: Rect;
  readonly scrollTop: number;
}

/** 造带 renderContent 的依赖，并记录回调拿到的参数。 */
const contentDeps = (
  draw?: (ctx: Ctx2D, box: Rect) => void,
): { deps: DrawDeps; calls: ContentCall[] } => {
  const calls: ContentCall[] = [];
  const base = makeDeps();
  const deps: DrawDeps = {
    ...base,
    data: {
      renderContent: (ctx: Ctx2D, box: Rect, scrollTop: number) => {
        calls.push({ box: { ...box }, scrollTop });
        if (draw !== undefined) draw(ctx, box);
      },
    },
  };
  return { deps, calls };
};

it('clip 一次到自己的 box，save / restore 配对', () => {
  const { deps } = contentDeps();
  const spy = render(scroll, BOX, { scrollTop: 40 }, deps);
  expect(spy.clips).toBe(1);
  expect(spy.saves).toBe(1);
  expect(spy.restores).toBe(1);
  expect(spy.rects).toEqual([[BOX.x, BOX.y, BOX.w, BOX.h]]);
});

it('translate 精确：translate(0, -scrollTop)，只做纵向', () => {
  const { deps } = contentDeps();
  const spy = render(scroll, BOX, { scrollTop: 137 }, deps);
  expect(spy.translates).toEqual([[0, -137]]);
});

it('scrollTop = 0 时也调用 translate(0, 0)（路径稳定，不靠「没滚动就跳过」）', () => {
  const { deps } = contentDeps();
  const spy = render(scroll, BOX, { scrollTop: 0 }, deps);
  expect(spy.translates).toEqual([[0, 0]]);
});

it('renderContent 收到的 box 是**原始**坐标（未被平移），scrollTop 原样传入', () => {
  const { deps, calls } = contentDeps();
  render(scroll, BOX, { scrollTop: 88 }, deps);
  expect(calls.length).toBe(1);
  expect(calls[0]?.box).toEqual(BOX);
  expect(calls[0]?.scrollTop).toBe(88);
});

it('先填底色再画内容：bgColor 精确落盘为一次 fillRect', () => {
  const { deps } = contentDeps();
  const spy = render(scroll, BOX, { bgColor: '#0a0b0c' }, deps);
  expect(spy.fills.length).toBe(1);
  expect(spy.fills[0]?.color).toBe('#0a0b0c');
  expect(spy.fills[0]?.args).toEqual([BOX.x, BOX.y, BOX.w, BOX.h]);
});

it('没有 renderContent：只填底色、不 clip、不崩', () => {
  const base = makeDeps();
  const deps: DrawDeps = { ...base, data: {} };
  const spy = render(scroll, BOX, { bgColor: DEFAULT_THEME.panel }, deps);
  expect(spy.fills.length).toBe(1);
  expect(spy.clips).toBe(0);
  expect(spy.saves).toBe(0);
  expect(spy.translates.length).toBe(0);
});

it('renderContent 里画的坐标是内容坐标系（平移由组件负责，游戏不用自己减）', () => {
  const { deps } = contentDeps((ctx, box) => {
    ctx.fillRect(box.x, box.y, box.w, 40);
  });
  const spy = render(scroll, BOX, { scrollTop: 60, bgColor: '#111111' }, deps);
  // 底色一次 + 内容一次；内容写在 box 坐标（100），不是 100-60=40
  expect(spy.fills.length).toBe(2);
  expect(spy.fills[1]?.args).toEqual([BOX.x, BOX.y, BOX.w, 40]);
  // 偏移由 translate 承担
  expect(spy.translates).toEqual([[0, -60]]);
});

it('scrollTop 远超 contentH：不崩、不产生 NaN、translate 按原值', () => {
  const { deps } = contentDeps();
  const spy = render(scroll, BOX, { scrollTop: 99999, contentH: 300 }, deps);
  expect(spy.translates).toEqual([[0, -99999]]);
  expect(spy.clips).toBe(1);
  expect(Number.isFinite(spy.translates[0]?.[1] ?? Number.NaN)).toBe(true);
});

it('坏输入（NaN scrollTop）退化成 0（不把 NaN 传给 makeTransform）', () => {
  const { deps } = contentDeps();
  const spy = render(scroll, BOX, { scrollTop: Number.NaN }, deps);
  expect(spy.translates).toEqual([[0, 0]]);
});

it('容器尺寸为 0：直接返回，不填色、不 clip、不调回调', () => {
  const { deps, calls } = contentDeps();
  expect(render(scroll, makeBox(0, 0, 0, 200), { bgColor: '#fff' }, deps).fills.length).toBe(0);
  expect(render(scroll, makeBox(0, 0, 300, 0), { bgColor: '#fff' }, deps).fills.length).toBe(0);
  expect(calls.length).toBe(0);
});

it('readRenderContent：只认函数，其它类型一律当没有', () => {
  expect(readRenderContent({ renderContent: () => undefined })).not.toBeNull();
  expect(readRenderContent({ renderContent: 'nope' })).toBeNull();
  expect(readRenderContent({ renderContent: 42 })).toBeNull();
  expect(readRenderContent(undefined)).toBeNull();
});

it('assert：contentH 负数 / scrollTop 负数 / 超最大滚动位都报中文问题', () => {
  const issuesOf = (props: Record<string, string | number | boolean>): readonly string[] =>
    scroll.def.assert?.(BOX, props) ?? [];
  expect(issuesOf({ contentH: -1 }).join('\n')).toContain('contentH 不能是负数');
  expect(issuesOf({ scrollTop: -5 }).join('\n')).toContain('scrollTop 不能是负数');
  const tooFar = issuesOf({ contentH: 300, scrollTop: 200 }).join('\n');
  expect(tooFar).toContain('超过最大滚动位');
  // 合法输入不报
  expect(issuesOf({ contentH: 300, scrollTop: 100 })).toEqual([]);
});
