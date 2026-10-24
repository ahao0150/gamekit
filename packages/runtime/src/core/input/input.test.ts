import { describe, expect, it } from 'vitest';
import type {
  PlatformAdapter,
  PointerEvent as PlatformPointerEvent,
} from '../../platform/contract';
import { ZERO_INSETS } from '../../platform/contract';
import type { DragEvent, TapEvent } from './contract';
import { createDesignMapping, createInput } from './index';

function makePlatform(): {
  platform: PlatformAdapter;
  emit: (e: PlatformPointerEvent) => void;
  listenerCount: () => number;
} {
  let listener: ((e: PlatformPointerEvent) => void) | null = null;
  const platform: PlatformAdapter = {
    name: 'mock',
    canvas: { width: 390, height: 844, getContext: () => null, native: null },
    screen: { width: 390, height: 844, dpr: 2, insets: ZERO_INSETS, orientation: 'portrait' },
    can: () => false,
    onResize: () => () => undefined,
    onPointer: (cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
    loadImage: () => Promise.resolve(null),
    storage: { get: () => null, set: () => true, remove: () => undefined },
  };
  return {
    platform,
    emit: (e) => {
      listener?.(e);
    },
    listenerCount: () => (listener ? 1 : 0),
  };
}

const pe = (
  kind: 'down' | 'move' | 'up' | 'cancel',
  id: number,
  x: number,
  y: number,
  time: number,
): PlatformPointerEvent => ({ kind, pointer: { id, x, y }, time });

function collect(): {
  taps: TapEvent[];
  drags: DragEvent[];
  input: ReturnType<typeof createInput>;
} {
  const { platform } = makePlatform();
  const input = createInput(platform);
  const taps: TapEvent[] = [];
  const drags: DragEvent[] = [];
  input.onTap((e) => taps.push(e));
  input.onDrag((e) => drags.push(e));
  return { taps, drags, input };
}

describe('tap 判定', () => {
  it('短按小位移是 tap', () => {
    const { taps, input } = collect();
    input.handle(pe('down', 0, 20, 20, 1000));
    input.handle(pe('up', 0, 22, 23, 1200));
    expect(taps).toHaveLength(1);
    expect(taps[0]).toMatchObject({ id: 0, x: 22, y: 23, duration: 200 });
  });

  it('位移达到 12px 不算 tap（走拖拽）', () => {
    const { taps, drags, input } = collect();
    input.handle(pe('down', 0, 0, 0, 0));
    input.handle(pe('up', 0, 12, 0, 100));
    expect(taps).toHaveLength(0);
    expect(drags.map((d) => d.phase)).toEqual(['start', 'end']);
  });

  it('时长达到 400ms 不算 tap', () => {
    const { taps, input } = collect();
    input.handle(pe('down', 0, 0, 0, 0));
    input.handle(pe('up', 0, 0, 0, 400));
    expect(taps).toHaveLength(0);
  });

  it('长按但没动也不 tap', () => {
    const { taps, input } = collect();
    input.handle(pe('down', 0, 0, 0, 0));
    input.handle(pe('up', 0, 0, 0, 900));
    expect(taps).toHaveLength(0);
  });

  it('cancel 不产生 tap', () => {
    const { taps, drags, input } = collect();
    input.handle(pe('down', 0, 0, 0, 0));
    input.handle(pe('cancel', 0, 0, 0, 100));
    expect(taps).toHaveLength(0);
    expect(drags).toHaveLength(0);
  });

  it('没有 down 的 up 被忽略', () => {
    const { taps, input } = collect();
    input.handle(pe('up', 7, 10, 10, 100));
    expect(taps).toHaveLength(0);
  });

  it('多指各自判定', () => {
    const { taps, input } = collect();
    input.handle(pe('down', 0, 10, 10, 0));
    input.handle(pe('down', 1, 50, 50, 10));
    input.handle(pe('up', 0, 10, 10, 100));
    input.handle(pe('up', 1, 50, 50, 120));
    expect(taps.map((t) => t.id)).toEqual([0, 1]);
  });
});

describe('drag 判定', () => {
  it('超过阈值后依次 start / move / end', () => {
    const { drags, input } = collect();
    input.handle(pe('down', 0, 0, 0, 0));
    input.handle(pe('move', 0, 5, 0, 10));
    expect(drags).toHaveLength(0);
    input.handle(pe('move', 0, 20, 0, 20));
    input.handle(pe('move', 0, 30, 5, 30));
    input.handle(pe('up', 0, 30, 5, 40));
    expect(drags.map((d) => d.phase)).toEqual(['start', 'move', 'end']);
    expect(drags[2]).toMatchObject({ startX: 0, startY: 0, dx: 30, dy: 5 });
  });

  it('up 时才超阈值：补发 start + end，不 tap', () => {
    const { taps, drags, input } = collect();
    input.handle(pe('down', 0, 0, 0, 0));
    input.handle(pe('up', 0, 40, 0, 100));
    expect(taps).toHaveLength(0);
    expect(drags.map((d) => d.phase)).toEqual(['start', 'end']);
  });

  it('cancel 结束拖拽', () => {
    const { drags, input } = collect();
    input.handle(pe('down', 0, 0, 0, 0));
    input.handle(pe('move', 0, 40, 0, 10));
    input.handle(pe('cancel', 0, 40, 0, 20));
    expect(drags.map((d) => d.phase)).toEqual(['start', 'end']);
  });

  it('位移阈值按设计坐标算，不受缩放影响', () => {
    const { platform } = makePlatform();
    const input = createInput(platform, {
      mapping: { scaleX: 2, scaleY: 2, originX: 0, originY: 0 },
    });
    const taps: TapEvent[] = [];
    const drags: DragEvent[] = [];
    input.onTap((e) => taps.push(e));
    input.onDrag((e) => drags.push(e));
    // 屏幕位移 20 = 设计位移 10 < 12 → tap
    input.handle(pe('down', 0, 0, 0, 0));
    input.handle(pe('up', 0, 20, 0, 100));
    expect(taps).toHaveLength(1);
    expect(drags).toHaveLength(0);
    // 屏幕位移 24 = 设计位移 12 → 拖拽
    input.handle(pe('down', 0, 0, 0, 200));
    input.handle(pe('up', 0, 24, 0, 300));
    expect(drags.map((d) => d.phase)).toEqual(['start', 'end']);
  });
});

describe('isDown 与生命周期', () => {
  it('按下计数与 isDown', () => {
    const { input } = collect();
    expect(input.isDown()).toBe(false);
    input.handle(pe('down', 0, 0, 0, 0));
    input.handle(pe('down', 1, 0, 0, 0));
    expect(input.downCount).toBe(2);
    expect(input.isDown(0)).toBe(true);
    expect(input.isDown(9)).toBe(false);
    input.handle(pe('up', 0, 0, 0, 10));
    expect(input.downCount).toBe(1);
    expect(input.isDown()).toBe(true);
  });

  it('退订后不再收到回调', () => {
    const { platform } = makePlatform();
    const input = createInput(platform);
    let count = 0;
    const off = input.onTap(() => {
      count += 1;
    });
    off();
    input.handle(pe('down', 0, 0, 0, 0));
    input.handle(pe('up', 0, 0, 0, 10));
    expect(count).toBe(0);
  });

  it('dispose 退订平台事件并清空状态', () => {
    const { platform, listenerCount } = makePlatform();
    const input = createInput(platform);
    let count = 0;
    input.onTap(() => {
      count += 1;
    });
    input.handle(pe('down', 0, 0, 0, 0));
    input.dispose();
    expect(listenerCount()).toBe(0);
    expect(input.downCount).toBe(0);
    input.handle(pe('down', 0, 0, 0, 0));
    input.handle(pe('up', 0, 0, 0, 10));
    expect(count).toBe(0);
  });
});

describe('createDesignMapping', () => {
  it('contain：等比缩放并居中', () => {
    const m = createDesignMapping({ width: 780, height: 844 }, { width: 390, height: 844 }, 'contain');
    expect(m.scaleX).toBe(1);
    expect(m.scaleY).toBe(1);
    expect(m.originX).toBe(195);
    expect(m.originY).toBe(0);
  });

  it('height：高度撑满，宽度按比例溢出居中', () => {
    const m = createDesignMapping({ width: 390, height: 844 }, { width: 390, height: 844 }, 'height');
    expect(m.scaleX).toBeCloseTo(1, 10);
    expect(m.originX).toBeCloseTo(0, 10);
  });

  it('width：宽度撑满', () => {
    const m = createDesignMapping({ width: 780, height: 844 }, { width: 390, height: 844 }, 'width');
    expect(m.scaleX).toBeCloseTo(2, 10);
  });

  it('非法设计尺寸不产生 0 缩放', () => {
    const m = createDesignMapping({ width: 390, height: 844 }, { width: 0, height: 0 }, 'contain');
    expect(m.scaleX).toBeGreaterThan(0);
    expect(Number.isFinite(m.scaleX)).toBe(true);
  });
});
