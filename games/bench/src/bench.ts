/**
 * 帧循环与采样（T26）。
 *
 * 测量口径（重要，文档里也写了）：
 * - `draw` = `clearRect` + 场景绘制的 `performance.now()` 差值。**不含浏览器合成**，
 *   也不含 `requestAnimationFrame` 等待——测的是「JS 把这一帧提交给 canvas 要多久」。
 * - `interval` = 相邻两次 `rAF` 回调的时间戳差。它是真实帧间隔：如果 GPU 光栅跟不上，
 *   浏览器会推迟下一帧，`interval` 就会涨到 16.7ms 以上。用它来验证 `draw` 没测到的成本。
 * - `flush: true` 时每帧末尾读回 1 个像素，强制浏览器把这帧真正栅格化完再计时——
 *   用于单独验证「提交之外的光栅成本」，不进主表。
 */
import type { FrameSummary } from './stats';
import { summarize } from './stats';
import type { Scene, SceneKind } from './scenes';

/** 设计分辨率（逻辑像素），和 ui-demo 一致，方便横向对比。 */
export const LOGICAL_WIDTH = 390;
export const LOGICAL_HEIGHT = 844;

/** 测量画布：CSS 尺寸固定逻辑值，物理像素按 dpr 放大。 */
export interface Stage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly dpr: number;
}

/** 一次测量的参数。 */
export interface RunOptions {
  /** 采样帧数（不含预热） */
  readonly frames: number;
  /** 预热帧数：让 JIT / 图集纹理就位，这些帧的耗时丢弃 */
  readonly warmup: number;
  /** 每帧末尾强制读回 1 像素，把光栅成本计入 `draw` */
  readonly flush: boolean;
  /** 返回 true 时提前结束（页面上的「停止」） */
  readonly shouldStop?: () => boolean;
}

/** 一次测量的结果。 */
export interface RunResult {
  readonly kind: SceneKind;
  readonly n: number;
  readonly frames: number;
  /** clear + draw 耗时（毫秒） */
  readonly draw: FrameSummary;
  /** rAF 帧间隔（毫秒）：> 16.7 说明掉帧 */
  readonly interval: FrameSummary;
  /** 画完之后画布上真的有非透明像素（防止「测了个空场景」） */
  readonly painted: boolean;
}

/** 按 dpr 配置画布：物理像素 = 逻辑 × dpr，绘制坐标仍是逻辑像素。 */
export const configureStage = (canvas: HTMLCanvasElement, dpr: number): Stage => {
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  canvas.width = Math.round(LOGICAL_WIDTH * scale);
  canvas.height = Math.round(LOGICAL_HEIGHT * scale);
  canvas.style.width = `${LOGICAL_WIDTH}px`;
  canvas.style.height = `${LOGICAL_HEIGHT}px`;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('无法获取 2D 上下文：测量画布初始化失败');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { canvas, ctx, dpr: scale };
};

const nextFrame = (): Promise<number> =>
  new Promise((resolve) => {
    requestAnimationFrame((ts) => resolve(ts));
  });

/** 画完好坏检查：读第一行与中间行，任何非透明像素即认为「真的画了东西」。 */
const checkPainted = (stage: Stage): boolean => {
  const { ctx, canvas } = stage;
  const rowY = Math.min(canvas.height - 1, Math.floor(canvas.height / 2));
  for (const y of [0, rowY]) {
    const row = ctx.getImageData(0, y, canvas.width, 1).data;
    for (let i = 3; i < row.length; i += 4) {
      if ((row[i] ?? 0) > 0) return true;
    }
  }
  return false;
};

/** 跑一个场景：预热后采样，返回中位数 / p95 / 帧间隔。 */
export const runScene = async (stage: Stage, scene: Scene, options: RunOptions): Promise<RunResult> => {
  const frames = Math.max(1, Math.floor(options.frames));
  const warmup = Math.max(0, Math.floor(options.warmup));
  const total = warmup + frames;
  const drawTimes: number[] = [];
  const intervals: number[] = [];
  const shouldStop = options.shouldStop ?? (() => false);
  let prevTs = 0;
  let stopped = false;

  for (let i = 0; i < total; i += 1) {
    if (shouldStop()) {
      stopped = true;
      break;
    }
    const ts = await nextFrame();
    const t0 = performance.now();
    stage.ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    scene.draw(stage.ctx);
    const t1 = performance.now();
    if (options.flush) stage.ctx.getImageData(0, 0, 1, 1);
    if (i >= warmup) {
      drawTimes.push(t1 - t0);
      if (prevTs > 0) intervals.push(ts - prevTs);
    }
    prevTs = ts;
  }

  return {
    kind: scene.kind,
    n: scene.n,
    frames: stopped ? drawTimes.length : frames,
    draw: summarize(drawTimes),
    interval: summarize(intervals),
    painted: checkPainted(stage),
  };
};
