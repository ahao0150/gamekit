/**
 * 绘制记录器契约测试。
 *
 * 测试环境是 node（没有真 canvas），所以用一个最小 mock ctx：
 * 只需要记录器实际读取/调用的成员（getTransform、五个绘制方法、两个色值属性）。
 * 这样断言的正是契约里写的三件事：类型 + 矩形 + 调用了原方法。
 */

import { describe, expect, it } from 'vitest';
import { wrapRecorder } from './recorder';
import type { Ctx2D } from './contract';

interface Call {
  readonly name: string;
  readonly args: readonly number[];
}

/** 最小可用的 ctx mock：记录调用，按 setTransform 的状态返回矩阵。 */
const mockCtx = (): { ctx: Ctx2D; calls: Call[] } => {
  const calls: Call[] = [];
  let matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const record = (name: string, args: readonly number[]): void => {
    calls.push({ name, args });
  };
  const target = {
    canvas: { width: 390, height: 844 },
    fillStyle: '#000',
    strokeStyle: '#fff',
    getTransform: (): typeof matrix => matrix,
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number): void => {
      matrix = { a, b, c, d, e, f };
    },
    save: (): void => undefined,
    restore: (): void => undefined,
    translate: (x: number, y: number): void => {
      // 只用于断言「非拦截方法被透传」
      record('translate', [x, y]);
    },
    fillRect: (x: number, y: number, w: number, h: number): void => record('fillRect', [x, y, w, h]),
    strokeRect: (x: number, y: number, w: number, h: number): void => record('strokeRect', [x, y, w, h]),
    fillText: (text: string, x: number, y: number): void => record('fillText', [x, y]),
    strokeText: (text: string, x: number, y: number): void => record('strokeText', [x, y]),
    clearRect: (x: number, y: number, w: number, h: number): void => record('clearRect', [x, y, w, h]),
    drawImage: (): void => record('drawImage', []),
    fill: (): void => record('fill', []),
    stroke: (): void => record('stroke', []),
  };
  return { ctx: target as unknown as Ctx2D, calls };
};

describe('wrapRecorder', () => {
  it('拦截 fillRect：记录目标矩形与填充色', () => {
    const { ctx, calls } = mockCtx();
    const rec = wrapRecorder(ctx);
    rec.ctx.fillRect(10, 20, 100, 40);
    const frame = rec.latest();
    expect(frame).not.toBeNull();
    expect(frame?.calls).toHaveLength(1);
    const call = frame?.calls[0];
    expect(call?.kind).toBe('rect');
    expect(call?.rect).toEqual({ x: 10, y: 20, w: 100, h: 40 });
    expect(call?.color).toBe('#000');
    // 原方法必须真的被调用（否则只是记了个假的）
    expect(calls).toEqual([{ name: 'fillRect', args: [10, 20, 100, 40] }]);
  });

  it('拦截 drawImage：区分 9 参的源矩形与 5 参的整图绘制', () => {
    const { ctx } = mockCtx();
    const rec = wrapRecorder(ctx);
    const img = { width: 64, height: 32, src: 'assets/ui/btn-primary_normal.webp' };
    rec.ctx.drawImage(img as unknown as CanvasImageSource, 8, 16, 32, 16, 10, 20, 100, 40);
    rec.ctx.drawImage(img as unknown as CanvasImageSource, 1, 2, 3, 4);
    const calls = rec.latest()?.calls ?? [];
    expect(calls[0]?.kind).toBe('image');
    expect(calls[0]?.rect).toEqual({ x: 10, y: 20, w: 100, h: 40 });
    expect(calls[0]?.source).toEqual({ x: 8, y: 16, w: 32, h: 16 });
    expect(calls[0]?.asset).toBe('btn-primary_normal.webp');
    expect(calls[1]?.rect).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    // 5 参时源矩形 = 整图
    expect(calls[1]?.source).toEqual({ x: 0, y: 0, w: 64, h: 32 });
  });

  it('拦截 fillText：记录文字内容与锚点矩形', () => {
    const { ctx } = mockCtx();
    const rec = wrapRecorder(ctx);
    rec.ctx.fillText('开始配送', 195, 700);
    const call = rec.latest()?.calls[0];
    expect(call?.kind).toBe('text');
    expect(call?.text).toBe('开始配送');
    expect(call?.rect).toEqual({ x: 195, y: 700, w: 1, h: 1 });
  });

  it('坐标乘当前变换矩阵：translate 之后记录的矩形是屏幕坐标', () => {
    const { ctx } = mockCtx();
    const rec = wrapRecorder(ctx);
    // 平台层建立 dpr 变换：逻辑 10×10 在屏幕上占 20×20
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    rec.ctx.fillRect(0, 0, 10, 10);
    // 界面层的居中偏移：+30 / +40
    ctx.setTransform(1, 0, 0, 1, 30, 40);
    rec.ctx.fillRect(0, 0, 10, 10);
    const calls = rec.latest()?.calls ?? [];
    expect(calls[0]?.rect).toEqual({ x: 0, y: 0, w: 20, h: 20 });
    expect(calls[1]?.rect).toEqual({ x: 30, y: 40, w: 10, h: 10 });
  });

  it('按调用间隔切帧：间隔小于阈值算同一帧', () => {
    const { ctx } = mockCtx();
    const rec = wrapRecorder(ctx, { frameGapMs: 50 });
    rec.ctx.fillRect(0, 0, 1, 1);
    rec.ctx.fillRect(1, 1, 1, 1);
    expect(rec.stats().drawsPerFrame).toBe(2);
    expect(rec.stats().retained).toBe(1);
  });

  it('非拦截方法原样透传（save / translate 等）', () => {
    const { ctx, calls } = mockCtx();
    const rec = wrapRecorder(ctx);
    rec.ctx.translate(5, 6);
    expect(calls).toEqual([{ name: 'translate', args: [5, 6] }]);
    // 透传的方法不需要记录进绘制树
    expect(rec.latest()).toBeNull();
  });

  it('关掉开关后不再记录，但绘制照常发生', () => {
    const { ctx, calls } = mockCtx();
    const rec = wrapRecorder(ctx);
    rec.ctx.fillRect(0, 0, 10, 10);
    rec.setEnabled(false);
    rec.ctx.fillRect(1, 1, 10, 10);
    expect(calls).toHaveLength(2);
    expect(rec.stats().enabled).toBe(false);
    // 关掉前那一帧被收尾，之后不再新增
    expect(rec.stats().retained).toBe(1);
    rec.setEnabled(true);
    rec.ctx.fillRect(2, 2, 10, 10);
    expect(rec.latest()?.calls[0]?.rect).toEqual({ x: 2, y: 2, w: 10, h: 10 });
  });

  it('环形缓冲不超过容量，且保留的是最近的帧', () => {
    const { ctx } = mockCtx();
    // frameGapMs 设 0 不可能（0 表示每次调用都切帧，这里正好用它制造多帧）
    const rec = wrapRecorder(ctx, { capacity: 2, frameGapMs: -1 });
    for (let i = 1; i <= 5; i += 1) {
      rec.ctx.fillRect(i, i, 1, 1);
    }
    expect(rec.capacity).toBe(2);
    expect(rec.stats().retained).toBe(2);
    const frames = rec.recent(10);
    expect(frames).toHaveLength(2);
    // 保留的应该是最后两帧（x = 4 和 5）
    expect(frames[0]?.calls[0]?.rect?.x).toBe(4);
    expect(frames[1]?.calls[0]?.rect?.x).toBe(5);
  });

  it('stats 给出每帧绘制数与保留帧数', () => {
    const { ctx } = mockCtx();
    const rec = wrapRecorder(ctx);
    rec.ctx.fillRect(0, 0, 1, 1);
    rec.ctx.fillText('a', 0, 0);
    rec.ctx.drawImage({ width: 1, height: 1 } as unknown as CanvasImageSource, 0, 0, 1, 1);
    const stats = rec.stats();
    expect(stats.drawsPerFrame).toBe(3);
    expect(stats.retained).toBe(1);
    expect(stats.enabled).toBe(true);
    expect(stats.frameMs).toBeGreaterThanOrEqual(0);
  });
});
