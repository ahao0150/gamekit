/**
 * 离屏层缓存契约测试（T30）。
 *
 * 重点钉死三件事（对应实现注释里的三个坑）：
 * 1. **dpr**：离屏 backing = 逻辑 × dpr，重画前必须 setTransform(dpr) —— 否则高 dpr 屏
 *    上缓存层只占左上角 1/dpr²（和主画布那个屏幕适配 bug 同源）；
 * 2. **blit**：每帧都 drawImage 一次，参数是 (native, 0, 0, 逻辑宽, 逻辑高)；
 * 3. **降级**：没有离屏能力 / 已 dispose / getContext 失败时退化成直画，不崩不丢内容。
 */
import { describe, expect, it } from 'vitest';
import type { Ctx2D, GameCanvas } from '../../platform/contract';
import { createLayerCache, createLayerCacheFor } from './cache';

interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

/** 记录调用的假 ctx（只实现缓存会碰到的几个方法）。 */
function fakeCtx(): { ctx: Ctx2D; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push({ name, args });
    };
  const ctx = {
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    drawImage: record('drawImage'),
    fillRect: record('fillRect'),
  } as unknown as Ctx2D;
  return { ctx, calls };
}

interface FakeCanvasFactory {
  readonly create: (width: number, height: number) => GameCanvas;
  readonly sizes: { width: number; height: number }[];
  readonly natives: { width: number; height: number }[];
}

/** 假 createCanvas：记录「建了多大」，native 是可写的普通对象（dispose 会置 0）。 */
function fakeCanvasFactory(ctx: Ctx2D | null): FakeCanvasFactory {
  const sizes: { width: number; height: number }[] = [];
  const natives: { width: number; height: number }[] = [];
  const create = (width: number, height: number): GameCanvas => {
    const native = { width, height };
    sizes.push({ width, height });
    natives.push(native);
    return {
      get width(): number {
        return native.width;
      },
      get height(): number {
        return native.height;
      },
      getContext: (): Ctx2D | null => ctx,
      native,
    };
  };
  return { create, sizes, natives };
}

const names = (calls: readonly RecordedCall[]): string[] => calls.map((c) => c.name);

describe('createLayerCache', () => {
  it('首次 draw 调 drawFn 一次，并 blit 一次', () => {
    const cache = fakeCtx();
    const factory = fakeCanvasFactory(cache.ctx);
    const main = fakeCtx();
    const layer = createLayerCache({ createCanvas: factory.create, width: 390, height: 844, dpr: 2 });
    let drawn = 0;
    layer.draw(main.ctx, () => {
      drawn += 1;
    });
    expect(drawn).toBe(1);
    expect(names(main.calls).filter((n) => n === 'drawImage')).toHaveLength(1);
  });

  it('第二次 draw（未 invalidate）不重画，但仍然 blit', () => {
    const cache = fakeCtx();
    const factory = fakeCanvasFactory(cache.ctx);
    const main = fakeCtx();
    const layer = createLayerCache({ createCanvas: factory.create, width: 390, height: 844, dpr: 1 });
    let drawn = 0;
    const drawFn = (): void => {
      drawn += 1;
    };
    layer.draw(main.ctx, drawFn);
    layer.draw(main.ctx, drawFn);
    expect(drawn).toBe(1);
    expect(names(main.calls).filter((n) => n === 'drawImage')).toHaveLength(2);
  });

  it('invalidate 后下一次 draw 会重画', () => {
    const cache = fakeCtx();
    const factory = fakeCanvasFactory(cache.ctx);
    const main = fakeCtx();
    const layer = createLayerCache({ createCanvas: factory.create, width: 100, height: 100, dpr: 1 });
    let drawn = 0;
    const drawFn = (): void => {
      drawn += 1;
    };
    layer.draw(main.ctx, drawFn);
    layer.invalidate();
    layer.draw(main.ctx, drawFn);
    expect(drawn).toBe(2);
  });

  it('离屏 backing 尺寸 = 逻辑尺寸 × dpr', () => {
    const cache = fakeCtx();
    const factory = fakeCanvasFactory(cache.ctx);
    createLayerCache({ createCanvas: factory.create, width: 390, height: 844, dpr: 2 });
    expect(factory.sizes).toEqual([{ width: 780, height: 1688 }]);
  });

  it('重画前建立 dpr 变换并按逻辑尺寸清屏（高 dpr 不错位的守卫）', () => {
    const cache = fakeCtx();
    const factory = fakeCanvasFactory(cache.ctx);
    const main = fakeCtx();
    const layer = createLayerCache({ createCanvas: factory.create, width: 390, height: 844, dpr: 2 });
    layer.draw(main.ctx, () => undefined);
    const transform = cache.calls.find((c) => c.name === 'setTransform');
    expect(transform?.args).toEqual([2, 0, 0, 2, 0, 0]);
    const cleared = cache.calls.find((c) => c.name === 'clearRect');
    expect(cleared?.args).toEqual([0, 0, 390, 844]);
  });

  it('blit 参数 = (native, 0, 0, 逻辑宽, 逻辑高)', () => {
    const cache = fakeCtx();
    const factory = fakeCanvasFactory(cache.ctx);
    const main = fakeCtx();
    const layer = createLayerCache({ createCanvas: factory.create, width: 390, height: 844, dpr: 3 });
    layer.draw(main.ctx, () => undefined);
    const blit = main.calls.find((c) => c.name === 'drawImage');
    expect(blit?.args).toEqual([factory.natives[0], 0, 0, 390, 844]);
  });

  it('size 返回逻辑尺寸（不是 backing 尺寸）', () => {
    const cache = fakeCtx();
    const factory = fakeCanvasFactory(cache.ctx);
    const layer = createLayerCache({ createCanvas: factory.create, width: 390, height: 844, dpr: 2 });
    expect(layer.size).toEqual({ width: 390, height: 844 });
  });

  it('drawFn 收到离屏上下文（不是主画布上下文）', () => {
    const cache = fakeCtx();
    const factory = fakeCanvasFactory(cache.ctx);
    const main = fakeCtx();
    const layer = createLayerCache({ createCanvas: factory.create, width: 10, height: 10, dpr: 1 });
    let received: Ctx2D | null = null;
    layer.draw(main.ctx, (c) => {
      received = c;
    });
    expect(received).toBe(cache.ctx);
  });

  it('离屏 getContext 失败时退化成直画（不崩、内容不丢）', () => {
    const factory = fakeCanvasFactory(null);
    const main = fakeCtx();
    const layer = createLayerCache({ createCanvas: factory.create, width: 100, height: 100, dpr: 1 });
    let received: Ctx2D | null = null;
    layer.draw(main.ctx, (c) => {
      received = c;
    });
    expect(received).toBe(main.ctx);
    expect(names(main.calls)).not.toContain('drawImage');
  });

  it('dispose 把 native 宽高置 0（释放显存）', () => {
    const cache = fakeCtx();
    const factory = fakeCanvasFactory(cache.ctx);
    const layer = createLayerCache({ createCanvas: factory.create, width: 390, height: 844, dpr: 2 });
    layer.dispose();
    expect(factory.natives[0]).toEqual({ width: 0, height: 0 });
  });

  it('dispose 之后 draw 不崩，退化成直画', () => {
    const cache = fakeCtx();
    const factory = fakeCanvasFactory(cache.ctx);
    const main = fakeCtx();
    const layer = createLayerCache({ createCanvas: factory.create, width: 100, height: 100, dpr: 1 });
    layer.dispose();
    let received: Ctx2D | null = null;
    expect(() => {
      layer.draw(main.ctx, (c) => {
        received = c;
      });
    }).not.toThrow();
    expect(received).toBe(main.ctx);
  });

  it('重复 dispose 安全（不会二次置零出错）', () => {
    const cache = fakeCtx();
    const factory = fakeCanvasFactory(cache.ctx);
    const layer = createLayerCache({ createCanvas: factory.create, width: 10, height: 10, dpr: 1 });
    layer.dispose();
    expect(() => layer.dispose()).not.toThrow();
  });

  it('非法 dpr（0 / NaN / 负数）回落 1', () => {
    for (const dpr of [0, Number.NaN, -2]) {
      const cache = fakeCtx();
      const factory = fakeCanvasFactory(cache.ctx);
      createLayerCache({ createCanvas: factory.create, width: 100, height: 50, dpr });
      expect(factory.sizes[0]).toEqual({ width: 100, height: 50 });
    }
  });

  it('非法尺寸（0 / NaN）钳到 1', () => {
    const cache = fakeCtx();
    const factory = fakeCanvasFactory(cache.ctx);
    createLayerCache({ createCanvas: factory.create, width: 0, height: Number.NaN, dpr: 1 });
    expect(factory.sizes[0]).toEqual({ width: 1, height: 1 });
  });
});

describe('createLayerCacheFor', () => {
  it('适配器没有 createCanvas → 返回 null（调用方走直画）', () => {
    expect(createLayerCacheFor({}, { width: 390, height: 844, dpr: 2 })).toBeNull();
  });

  it('适配器有 createCanvas → 用它的能力建缓存', () => {
    const cache = fakeCtx();
    const factory = fakeCanvasFactory(cache.ctx);
    const layer = createLayerCacheFor(
      { createCanvas: factory.create },
      { width: 390, height: 844, dpr: 2 },
    );
    expect(layer).not.toBeNull();
    expect(factory.sizes).toEqual([{ width: 780, height: 1688 }]);
  });
});
