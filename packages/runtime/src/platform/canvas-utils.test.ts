/**
 * 平台画布工具契约测试（T30）。
 *
 * 这个文件守的是「wx / tt 两端共用同一份画布包装 + 尺寸钳制口径」：
 * 尺寸 0 或 NaN 会让 canvas 的后续绘制**静默失效**（画了但什么都没有），
 * 所以钳制必须只有一份实现、且被钉死。
 */
import { describe, expect, it } from 'vitest';
import type { Ctx2D } from './contract';
import { createMiniOffscreenCanvas, safeCanvasDimension, wrapMiniCanvas } from './canvas-utils';

interface FakeMiniCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): Ctx2D | null;
}

const fakeMiniCanvas = (): FakeMiniCanvas => ({
  width: 0,
  height: 0,
  getContext: (): Ctx2D | null => null,
});

describe('safeCanvasDimension', () => {
  it('正常值取整', () => {
    expect(safeCanvasDimension(390)).toBe(390);
    expect(safeCanvasDimension(1.6)).toBe(2);
  });

  it('0 / 负数 / NaN → 1（尺寸 0 会让绘制静默消失）', () => {
    expect(safeCanvasDimension(0)).toBe(1);
    expect(safeCanvasDimension(-5)).toBe(1);
    expect(safeCanvasDimension(Number.NaN)).toBe(1);
    expect(safeCanvasDimension(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('wrapMiniCanvas', () => {
  it('width / height 跟着平台 canvas 走（getter，不是快照）', () => {
    const mini = fakeMiniCanvas();
    const wrapped = wrapMiniCanvas(mini);
    mini.width = 390;
    mini.height = 844;
    expect(wrapped.width).toBe(390);
    expect(wrapped.height).toBe(844);
  });

  it('native 是平台 canvas 对象本身，getContext 透传', () => {
    const mini = fakeMiniCanvas();
    const wrapped = wrapMiniCanvas(mini);
    expect(wrapped.native).toBe(mini);
    expect(wrapped.getContext('2d')).toBeNull();
  });
});

describe('createMiniOffscreenCanvas', () => {
  it('调一次平台 createCanvas，并按传入尺寸设置', () => {
    const created: FakeMiniCanvas[] = [];
    const view = createMiniOffscreenCanvas(() => {
      const c = fakeMiniCanvas();
      created.push(c);
      return c;
    }, 780, 1688);
    expect(created).toHaveLength(1);
    expect(created[0]?.width).toBe(780);
    expect(created[0]?.height).toBe(1688);
    expect(view.width).toBe(780);
    expect(view.height).toBe(1688);
  });

  it('非法尺寸钳到 1（与 safeCanvasDimension 同口径）', () => {
    const made = fakeMiniCanvas();
    const view = createMiniOffscreenCanvas(() => made, 0, Number.NaN);
    expect(view.width).toBe(1);
    expect(view.height).toBe(1);
  });

  it('每次调用都新建一张（不会复用同一张离屏画布）', () => {
    let count = 0;
    const create = (): FakeMiniCanvas => {
      count += 1;
      return fakeMiniCanvas();
    };
    createMiniOffscreenCanvas(create, 10, 10);
    createMiniOffscreenCanvas(create, 10, 10);
    expect(count).toBe(2);
  });
});
