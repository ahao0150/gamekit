/**
 * 离屏层缓存（T30）：把「每帧重画的静态 UI 层」变成「一次 drawImage」。
 *
 * 为什么值得单独一个模块（数据来自 T26 基准，`docs/perf-bench.md`）：
 * 6× CPU 降频（≈低端机）下，200 个 UI 元素每帧重画要 **5.50ms**，
 * 缓存成一张位图后每帧只 `drawImage` 一次 **0.20ms（省 96%）**。
 * 这是目前最大的单点性能收益，所以做成通用能力而不是某个游戏自己手搓。
 *
 * 三条容易踩的坑（实现里都处理了）：
 * 1. **dpr**：离屏画布 backing 必须是 `width × dpr`，且绘制前 `setTransform(dpr,...)`。
 *    少了这一步，高 dpr 屏上缓存层只占左上角 1/dpr² —— 和主画布那个屏幕适配 bug 同源。
 * 2. **drawImage 的源**：web 的 `GameCanvas` 是包装对象，不能直接当 `CanvasImageSource`；
 *    必须用 `native`（web 下是 HTMLCanvasElement，wx/tt 下是平台 canvas 对象）。
 * 3. **没有离屏能力时不能崩**：`createCanvas` 在契约里是可选成员。拿不到离屏层就
 *    退化成每帧直画（内容不丢，只是没省下时间）。
 *
 * 不碰 `OffscreenCanvas`：iOS Safari 16.4 才有、小游戏端支持不全；普通 canvas 三端都稳。
 */

import type { Ctx2D, GameCanvas, PlatformAdapter } from '../../platform/contract';

/** 一层可缓存的绘制结果。 */
export interface LayerCache {
  /**
   * 画这一层：dirty 时先调 `drawFn` 把内容重画到离屏画布，然后把整层 `drawImage` 到主画布。
   *
   * `drawFn` 收到的是**离屏上下文**（已建立 dpr 变换）；它只应该画这一层的内容，
   * 不要在里面画别的层。
   */
  draw(ctx: Ctx2D, drawFn: (cacheCtx: Ctx2D) => void): void;
  /** 标记脏：下一次 draw 会重画。内容变了（文字/数值/状态）必须调它。 */
  invalidate(): void;
  /** 逻辑尺寸（不是 backing 尺寸）。 */
  readonly size: { readonly width: number; readonly height: number };
  /** 释放离屏画布（宽高置 0）；之后 draw 退化成每帧直画，不崩。 */
  dispose(): void;
}

export interface LayerCacheOptions {
  /** 平台创建离屏画布的能力（来自 `PlatformAdapter.createCanvas`）。 */
  readonly createCanvas: (width: number, height: number) => GameCanvas;
  /** 逻辑宽度（与主画布的绘制坐标系一致） */
  readonly width: number;
  /** 逻辑高度 */
  readonly height: number;
  /** 设备像素比，离屏 backing = 逻辑 × dpr */
  readonly dpr: number;
}

/** 归一化：非法 / 0 / 负数 → 1（尺寸 0 会让后续绘制静默消失）。 */
const dim = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.round(value) : 1;

const safeDpr = (dpr: number): number => (Number.isFinite(dpr) && dpr > 0 ? dpr : 1);

/** 创建一层缓存。首次 draw 必重画，之后 dirty 才重画。 */
export const createLayerCache = (opts: LayerCacheOptions): LayerCache => {
  const dpr = safeDpr(opts.dpr);
  const width = dim(opts.width);
  const height = dim(opts.height);

  const canvas = opts.createCanvas(dim(width * dpr), dim(height * dpr));
  let cacheCtx: Ctx2D | null = canvas.getContext('2d');
  let dirty = true;
  let disposed = false;

  const blit = (ctx: Ctx2D): void => {
    // native 才是平台真正的可绘制对象（web 下 HTMLCanvasElement，wx/tt 下平台 canvas）
    ctx.drawImage(canvas.native as CanvasImageSource, 0, 0, width, height);
  };

  return {
    draw(ctx: Ctx2D, drawFn: (cacheCtx: Ctx2D) => void): void {
      // 没有离屏层（平台没实现 / 已 dispose / getContext 失败）→ 直画，不崩不丢内容
      if (disposed || cacheCtx === null) {
        drawFn(ctx);
        return;
      }
      if (dirty) {
        // 每次重画都要重建 dpr 变换：离屏画布可能被外部 resize 清过状态
        cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cacheCtx.clearRect(0, 0, width, height);
        drawFn(cacheCtx);
        dirty = false;
      }
      blit(ctx);
    },

    invalidate(): void {
      dirty = true;
    },

    get size(): { readonly width: number; readonly height: number } {
      return { width, height };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      cacheCtx = null;
      // GameCanvas 的 width 是只读契约，只能从 native 上置 0 才真的释放显存
      const target = canvas.native;
      if (typeof target === 'object' && target !== null) {
        const sized = target as { width?: number; height?: number };
        if ('width' in sized) sized.width = 0;
        if ('height' in sized) sized.height = 0;
      }
    },
  };
};

/**
 * 从平台适配器建缓存；适配器没有离屏能力时返回 `null`（调用方据此走直画）。
 *
 * 业务用法：
 * ```ts
 * const layer = createLayerCacheFor(platform, { width: 390, height: 844, dpr: platform.screen.dpr });
 * if (layer) layer.draw(render.ctx, (c) => drawStaticUi(c));
 * else drawStaticUi(render.ctx);
 * ```
 */
export const createLayerCacheFor = (
  adapter: Pick<PlatformAdapter, 'createCanvas'>,
  opts: { readonly width: number; readonly height: number; readonly dpr: number },
): LayerCache | null => {
  const createCanvas = adapter.createCanvas;
  if (createCanvas === undefined) return null;
  return createLayerCache({ createCanvas, width: opts.width, height: opts.height, dpr: opts.dpr });
};
