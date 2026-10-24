/**
 * fx 测试用的假画布（T23）。
 *
 * 比 widgets 的 spy 多三样：**渐变对象**（`createRadialGradient` 返回带 `addColorStop`
 * 的假对象并记录色标）、**`globalCompositeOperation` 设值序列**（断言 `lighter` /
 * `destination-out` 真的用过）、以及 `createPattern` / `strokeRect`（溶解特效要用）。
 */

import type { Ctx2D } from '../../platform/contract';

/** 一个假渐变色标。 */
export interface SpyStop {
  readonly offset: number;
  readonly color: string;
}

/** 假渐变对象（只记录着色器参数与色标）。 */
export interface SpyGradient {
  readonly kind: 'radial' | 'linear';
  readonly args: readonly number[];
  readonly stops: SpyStop[];
}

export interface FxSpy {
  ctx: Ctx2D;
  /** 每次 fillRect 的参数 */
  readonly fills: number[][];
  /** 每次 fillRect 时的 fillStyle（可能是渐变对象） */
  readonly fillStyles: unknown[];
  /** createRadialGradient / createLinearGradient 的调用记录 */
  readonly gradients: SpyGradient[];
  /** globalCompositeOperation 的设值序列 */
  readonly compositeOps: string[];
  /** globalAlpha 的设值序列 */
  readonly alphas: number[];
  readonly translates: number[][];
  readonly rotates: number[];
  readonly strokes: number[][];
  saves: number;
  restores: number;
  patterns: { readonly source: unknown; readonly repetition: string }[];
  /** drawImage 次数（内容回调里可能画图） */
  drawImages: number;
}

export const fxSpy = (): FxSpy => {
  const state = {
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as string,
  };
  const spy: FxSpy = {
    ctx: null as unknown as Ctx2D,
    fills: [],
    fillStyles: [],
    gradients: [],
    compositeOps: [],
    alphas: [],
    translates: [],
    rotates: [],
    strokes: [],
    saves: 0,
    restores: 0,
    patterns: [],
    drawImages: 0,
  };

  /** 造一个带 addColorStop 的假渐变，同时记进 spy。 */
  const makeGradient = (kind: 'radial' | 'linear', args: readonly number[]): unknown => {
    const record: SpyGradient = { kind, args, stops: [] };
    spy.gradients.push(record);
    return {
      addColorStop: (offset: number, color: string): void => {
        (record.stops as SpyStop[]).push({ offset, color });
      },
    };
  };

  const ctx = {
    get fillStyle(): unknown {
      return state.fillStyle;
    },
    set fillStyle(value: unknown) {
      state.fillStyle = value;
    },
    get strokeStyle(): unknown {
      return state.strokeStyle;
    },
    set strokeStyle(value: unknown) {
      state.strokeStyle = value;
    },
    get globalAlpha(): number {
      return state.globalAlpha;
    },
    set globalAlpha(value: number) {
      state.globalAlpha = value;
      spy.alphas.push(value);
    },
    get globalCompositeOperation(): string {
      return state.globalCompositeOperation;
    },
    set globalCompositeOperation(value: string) {
      state.globalCompositeOperation = value;
      spy.compositeOps.push(value);
    },
    save: (): void => void (spy.saves += 1),
    restore: (): void => void (spy.restores += 1),
    translate: (x: number, y: number): void => void spy.translates.push([x, y]),
    rotate: (angle: number): void => void spy.rotates.push(angle),
    fillRect: (x: number, y: number, w: number, h: number): void => {
      spy.fills.push([x, y, w, h]);
      spy.fillStyles.push(state.fillStyle);
    },
    strokeRect: (x: number, y: number, w: number, h: number): void => void spy.strokes.push([x, y, w, h]),
    drawImage: (): void => void (spy.drawImages += 1),
    createRadialGradient: (x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): unknown =>
      makeGradient('radial', [x0, y0, r0, x1, y1, r1]),
    createLinearGradient: (x0: number, y0: number, x1: number, y1: number): unknown =>
      makeGradient('linear', [x0, y0, x1, y1]),
    createPattern: (source: unknown, repetition: string): unknown => {
      const pattern = { source, repetition };
      spy.patterns.push(pattern);
      return pattern;
    },
  };
  spy.ctx = ctx as unknown as Ctx2D;
  return spy;
};

export const makeRect = (x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } => ({
  x,
  y,
  w,
  h,
});

export const VIEWPORT = { width: 390, height: 844 } as const;
