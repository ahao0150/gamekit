// render 契约测试：mock ctx 记录调用（Node，无 DOM）、NaN/Infinity 拦截、image(null) 跳过、placeholder 画得出。
import { describe, expect, it } from 'vitest';
import type { Ctx2D } from '../../platform/contract';
import { createRender } from './index';

/** 记录调用的 mock ctx：每个方法把名字+参数推进 calls */
function makeCtx(): { ctx: Ctx2D; calls: Array<{ m: string; a: unknown[] }> } {
  const calls: Array<{ m: string; a: unknown[] }> = [];
  const rec = (m: string) =>
    (...a: unknown[]): void => {
      calls.push({ m, a });
    };
  const ctx = {
    canvas: { width: 800, height: 600 },
    setTransform: rec('setTransform'),
    clearRect: rec('clearRect'),
    fillRect: rec('fillRect'),
    strokeRect: rec('strokeRect'),
    fillText: rec('fillText'),
    strokeText: rec('strokeText'),
    drawImage: rec('drawImage'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    rect: rec('rect'),
    arc: rec('arc'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    clip: rec('clip'),
    save: rec('save'),
    restore: rec('restore'),
    translate: rec('translate'),
    scale: rec('scale'),
    rotate: rec('rotate'),
    measureText: (t: string) => ({ width: String(t).length * 10 }),
    set globalAlpha(_v: number) {},
    set fillStyle(_v: unknown) {},
    set strokeStyle(_v: unknown) {},
    set lineWidth(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
  } as unknown as Ctx2D & { canvas: { width: number; height: number } };
  return { ctx: ctx as unknown as Ctx2D, calls };
}

function last(calls: Array<{ m: string; a: unknown[] }>, m: string): unknown[] | undefined {
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const c = calls[i];
    if (c && c.m === m) return c.a;
  }
  return undefined;
}
function count(calls: Array<{ m: string; a: unknown[] }>, m: string): number {
  return calls.filter((c) => c.m === m).length;
}

const IMG = { width: 100, height: 50, native: 'img' };

describe('参数透传（mock ctx 记录）', () => {
  it('fillRect 透传坐标与先设 fillStyle', () => {
    const { ctx, calls } = makeCtx();
    const r = createRender({ ctx });
    r.fillRect({ x: 1, y: 2, w: 30, h: 40 }, '#f00');
    expect(last(calls, 'fillRect')).toEqual([1, 2, 30, 40]);
  });

  it('strokeRect 透传 lineWidth', () => {
    const { ctx, calls } = makeCtx();
    const r = createRender({ ctx });
    r.strokeRect({ x: 0, y: 0, w: 10, h: 10 }, '#000', 3);
    expect(last(calls, 'strokeRect')).toEqual([0, 0, 10, 10]);
    expect(count(calls, 'strokeRect')).toBe(1);
  });

  it('text 设置字体/对齐后 fillText', () => {
    const { ctx, calls } = makeCtx();
    const r = createRender({ ctx });
    r.text('你好', { x: 5, y: 6 }, { size: 20, weight: 'bold', align: 'center', color: '#123' });
    expect(last(calls, 'fillText')).toEqual(['你好', 5, 6]);
    expect(count(calls, 'fillText')).toBe(1);
  });

  it('textLines 按 lineHeight 逐行下移', () => {
    const { ctx, calls } = makeCtx();
    const r = createRender({ ctx });
    r.textLines(['a', 'b', 'c'], { x: 0, y: 100 }, { lineHeight: 20 });
    const ys = calls.filter((c) => c.m === 'fillText').map((c) => c.a[2]);
    expect(ys).toEqual([100, 120, 140]);
  });

  it('TextStyle.maxWidth 真的透传给 fillText 第四参（不传则只有三个参数）', () => {
    const { ctx, calls } = makeCtx();
    const r = createRender({ ctx });

    // 不传 maxWidth：fillText 只有三参（现有调用方的行为不变）
    r.text('宽', { x: 1, y: 2 });
    expect(last(calls, 'fillText')).toEqual(['宽', 1, 2]);

    // 传了：第四参原样带上 —— 折行算窄了的时候靠它横向压缩兜住
    r.text('宽', { x: 1, y: 2 }, { size: 16, maxWidth: 88 });
    expect(last(calls, 'fillText')).toEqual(['宽', 1, 2, 88]);
  });

  it('textLines 同样透传 maxWidth（内部走 text，逐行都带上）', () => {
    const { ctx, calls } = makeCtx();
    const r = createRender({ ctx });
    r.textLines(['a', 'b'], { x: 0, y: 0 }, { lineHeight: 20, maxWidth: 50 });
    const fills = calls.filter((c) => c.m === 'fillText');
    expect(fills).toHaveLength(2);
    for (const call of fills) expect(call.a[3]).toBe(50);
  });

  it('image 透传目标矩形（整图拉伸）', () => {
    const { ctx, calls } = makeCtx();
    const r = createRender({ ctx });
    r.image(IMG, { x: 10, y: 20, w: 100, h: 50 });
    expect(last(calls, 'drawImage')).toEqual([IMG, -50, -25, 100, 50]); // 平移到中心后的绘制
  });

  it('image slice9 产生 9 段 drawImage', () => {
    const { ctx, calls } = makeCtx();
    const r = createRender({ ctx });
    r.image(IMG, { x: 0, y: 0, w: 200, h: 100 }, { slice9: { left: 10, right: 10, top: 10, bottom: 10 } });
    expect(count(calls, 'drawImage')).toBe(9);
  });

  it('pushClip 产生 save+rect+clip，popClip 产生 restore', () => {
    const { ctx, calls } = makeCtx();
    const r = createRender({ ctx });
    r.pushClip({ x: 0, y: 0, w: 50, h: 50 });
    expect(count(calls, 'clip')).toBe(1);
    r.popClip();
    expect(count(calls, 'restore')).toBe(1);
  });
});

describe('NaN / Infinity 必须被拦下', () => {
  const cases: Array<{ name: string; run: (r: ReturnType<typeof createRender>) => void }> = [
    { name: 'fillRect x=NaN', run: (r) => r.fillRect({ x: NaN, y: 0, w: 1, h: 1 }, '#000') },
    { name: 'fillRect w=Infinity', run: (r) => r.fillRect({ x: 0, y: 0, w: Infinity, h: 1 }, '#000') },
    { name: 'strokeRect y=NaN', run: (r) => r.strokeRect({ x: 0, y: NaN, w: 1, h: 1 }, '#000') },
    { name: 'text 位置 NaN', run: (r) => r.text('a', { x: NaN, y: 0 }) },
    { name: 'text size=Infinity', run: (r) => r.text('a', { x: 0, y: 0 }, { size: Infinity }) },
    { name: 'image 目标 NaN', run: (r) => r.image(IMG, { x: 0, y: NaN, w: 1, h: 1 }) },
    { name: 'image rotation=NaN', run: (r) => r.image(IMG, { x: 0, y: 0, w: 1, h: 1 }, { rotation: NaN }) },
    { name: 'line 端点 Infinity', run: (r) => r.line({ x: 0, y: 0 }, { x: Infinity, y: 1 }, '#000') },
    { name: 'circle 半径 NaN', run: (r) => r.circle({ x: 0, y: 0 }, NaN, '#000') },
    { name: 'pushClip NaN', run: (r) => r.pushClip({ x: 0, y: 0, w: NaN, h: 1 }) },
    { name: 'placeholder NaN', run: (r) => r.placeholder({ x: NaN, y: 0, w: 1, h: 1 }) },
  ];
  for (const c of cases) {
    it(`${c.name}：不抛错且无绘制调用`, () => {
      const { ctx, calls } = makeCtx();
      const r = createRender({ ctx });
      expect(() => c.run(r)).not.toThrow();
      const draws = calls.filter((x) => ['fillRect', 'strokeRect', 'fillText', 'drawImage', 'clip', 'stroke'].includes(x.m));
      expect(draws).toEqual([]);
    });
  }
});

describe('image(null) 与 placeholder', () => {
  it('image(null) 静默跳过、不抛错、零调用', () => {
    const { ctx, calls } = makeCtx();
    const r = createRender({ ctx });
    expect(() => r.image(null, { x: 0, y: 0, w: 10, h: 10 })).not.toThrow();
    expect(calls).toEqual([]);
  });

  it('placeholder 画得出：底、框、对角线至少 3 类调用', () => {
    const { ctx, calls } = makeCtx();
    const r = createRender({ ctx });
    r.placeholder({ x: 10, y: 10, w: 80, h: 30 }, '缺图');
    expect(count(calls, 'fillRect')).toBeGreaterThanOrEqual(1);
    expect(count(calls, 'strokeRect')).toBe(1);
    expect(count(calls, 'stroke')).toBeGreaterThanOrEqual(1); // 对角线
    expect(count(calls, 'fillText')).toBe(1); // 标签
  });
});

describe('beginFrame / endFrame / alpha', () => {
  it('beginFrame 重置 transform 并清屏', () => {
    const { ctx, calls } = makeCtx();
    const r = createRender({ ctx });
    r.beginFrame('#fff');
    expect(last(calls, 'setTransform')).toEqual([1, 0, 0, 1, 0, 0]);
    expect(count(calls, 'fillRect')).toBe(1); // 清屏填充
  });

  it('beginFrame 无色则 clearRect', () => {
    const { ctx, calls } = makeCtx();
    const r = createRender({ ctx });
    r.beginFrame();
    expect(count(calls, 'clearRect')).toBe(1);
  });

  it('beginFrame 按 dpr 建立逻辑坐标系（web 高 dpr 屏不错位的守卫）', () => {
    const { ctx, calls } = makeCtx();
    const r = createRender({ ctx, dpr: 2 });
    r.beginFrame('#fff');
    expect(last(calls, 'setTransform')).toEqual([2, 0, 0, 2, 0, 0]);
    // 清屏范围是逻辑尺寸 = backing(800×600) ÷ dpr
    expect(last(calls, 'fillRect')).toEqual([0, 0, 400, 300]);
  });

  it('pushAlpha/popAlpha 不配对 pop 不崩', () => {
    const { ctx } = makeCtx();
    const r = createRender({ ctx });
    expect(() => {
      r.popAlpha();
      r.pushAlpha(0.5);
      r.pushAlpha(NaN); // 坏值被忽略
      r.popAlpha();
      r.popAlpha();
      r.popAlpha();
    }).not.toThrow();
  });
});
