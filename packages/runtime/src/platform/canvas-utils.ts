/**
 * 画布工具（T30）：小游戏端（wx / tt）的画布包装 + 尺寸钳制。
 *
 * 为什么抽一份共用：
 * 1. wx 和 tt 的 canvas 形状完全一样（`width` / `height` / `getContext('2d')`），
 *    离屏画布的创建流程也一致。各写一份必然出现「一端钳了尺寸、另一端没钳」的漂移。
 * 2. 「尺寸钳制」只有一份口径：canvas 的 width/height 设成 0 或 NaN 会让后续绘制
 *    **静默失效**（画了但什么都没有），这是最难查的一类 bug。
 *
 * 这个文件只被平台实现使用，不属于契约、不进 core。
 */

import type { Ctx2D, GameCanvas } from './contract';

/** 小游戏平台画布的最小形状（wx / tt 一致）。 */
export interface MiniCanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): Ctx2D | null;
}

/** 尺寸归一化：非法值 / 0 / 负数 → 1（canvas 尺寸为 0 会导致绘制静默消失）。 */
export const safeCanvasDimension = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.round(value) : 1;

/** 把平台 canvas 包成契约画布（尺寸用平台对象的 width/height）。 */
export const wrapMiniCanvas = (canvas: MiniCanvasLike): GameCanvas => ({
  get width(): number {
    return canvas.width;
  },
  get height(): number {
    return canvas.height;
  },
  getContext: (type: '2d') => canvas.getContext(type),
  native: canvas,
});

/**
 * 造一张离屏画布：调平台 `createCanvas()` 并按物理像素设置尺寸。
 *
 * 注意 wx/tt 的 `createCanvas()` **第一次调用返回上屏 canvas**，之后才是离屏——
 * 所以适配器必须先建好上屏 canvas，再把它作为本函数的 `create` 暴露出去。
 */
export const createMiniOffscreenCanvas = (
  create: () => MiniCanvasLike,
  width: number,
  height: number,
): GameCanvas => {
  const canvas = create();
  canvas.width = safeCanvasDimension(width);
  canvas.height = safeCanvasDimension(height);
  return wrapMiniCanvas(canvas);
};

/**
 * 绑定平台的 `createCanvas()`，得到适配器契约要的 `createCanvas(width, height)`。
 *
 * 两端（wx / tt）只差「调哪个全局对象」，用工厂是为了让适配器里只剩一行声明，
 * 也顺手把单文件行数守在 300 以内。
 */
export const miniOffscreenFactory = (
  create: () => MiniCanvasLike,
): ((width: number, height: number) => GameCanvas) => {
  return (width: number, height: number) => createMiniOffscreenCanvas(create, width, height);
};
