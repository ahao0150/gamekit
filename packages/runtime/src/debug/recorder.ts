/**
 * draw recorder：包一层 `CanvasRenderingContext2D`，记录每次绘制。
 *
 * 为什么包 ctx 而不是包渲染服务：游戏里的绘制是**直接调 ctx** 的
 * （`render()` 里 `ctx.drawImage(bg.native, ...)`、`fill()` 工具函数里 `fillRect`），
 * 渲染服务那层根本没有被用到。包在 ctx 上才能一条不漏地看见「实际画了什么」。
 *
 * 三个实现要点：
 * 1. **坐标要乘当前变换矩阵**。游戏画九宫格、按钮时会先 translate/scale，
 *    drawImage 的参数是局部坐标；直接记局部坐标会得到一堆「0,0」,
 *    和布局树永远对不上。这里统一用 `getTransform()` 换算成屏幕逻辑坐标。
 * 2. **帧边界按时间戳切**。游戏的每帧绘制入口没有任何帧开始标记，也不能为了
 *    调试去改玩法代码，所以用「两次调用间隔 > frameGapMs」判定新的一帧。
 * 3. **记录器自身不能拖慢游戏**。每次调用两次取时间，dev 模式可接受；
 *    关掉开关后所有拦截器直接透传。
 */

import type {
  Ctx2D,
  DrawCall,
  DrawKind,
  DrawRect,
  FrameSnapshot,
  Recorder,
  RecorderOptions,
  RecorderStats,
  WrapRecorder,
} from './contract';
import { assetNameOf, colorOf, matrixOf, numAt, project, round } from './geometry';

const DEFAULT_CAPACITY = 180;
const DEFAULT_FRAME_GAP_MS = 4;

/** 单调时钟。`performance` 三端都有，缺失时退回 Date.now（精度差些但不会崩）。 */
const clock = (): number => {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  if (perf !== undefined && typeof perf.now === 'function') return perf.now();
  return Date.now();
};

/** 记录器内部「正在写入的帧」。 */
interface MutableFrame {
  frame: number;
  at: number;
  calls: DrawCall[];
}

/** 一帧的绘制耗时 = 各次调用耗时之和。 */
const sumMs = (calls: readonly DrawCall[]): number => {
  let total = 0;
  for (const call of calls) total += call.ms;
  return total;
};

export const wrapRecorder: WrapRecorder = (ctx: Ctx2D, options: RecorderOptions = {}): Recorder => {
  const capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_CAPACITY));
  const frameGap = options.frameGapMs ?? DEFAULT_FRAME_GAP_MS;
  // 平台层用 setTransform(dpr,...) 建立了物理像素坐标系；绘制记录要回到**逻辑像素**
  // 才能和布局树直接对比（布局是逻辑像素算的）。所以投影结果统一除以 dpr。
  const dpr = typeof options.dpr === 'number' && Number.isFinite(options.dpr) && options.dpr > 0 ? options.dpr : 1;
  const inverseDpr = 1 / dpr;
  const projectLogical = (x: number, y: number, w: number, h: number): DrawRect => {
    const r = project(matrixOf(ctx), x, y, w, h);
    if (inverseDpr === 1) return r;
    return {
      x: round(r.x * inverseDpr),
      y: round(r.y * inverseDpr),
      w: round(r.w * inverseDpr),
      h: round(r.h * inverseDpr),
    };
  };
  const frames: FrameSnapshot[] = [];
  let current: MutableFrame | null = null;
  let frameNo = 0;
  let lastCallAt = Number.NEGATIVE_INFINITY;
  let enabled = true;

  const snapshot = (f: MutableFrame): FrameSnapshot => ({
    frame: f.frame,
    at: round(f.at),
    calls: f.calls.slice(),
    ms: round(sumMs(f.calls)),
  });

  /** 收尾当前帧（快照进环形缓冲）。 */
  function flush(): void {
    if (current === null) return;
    frames.push(snapshot(current));
    while (frames.length > capacity) frames.shift();
    current = null;
  }

  /** 记一笔。`at` 形参是这次调用的开始时间（用于切帧）。 */
  function note(kind: DrawKind, at: number, cost: number, extra: Partial<DrawCall>): void {
    if (!enabled) return;
    if (current === null || at - lastCallAt > frameGap) {
      flush();
      frameNo += 1;
      current = { frame: frameNo, at, calls: [] };
    }
    lastCallAt = Math.max(lastCallAt, at);
    current.calls.push({ z: current.calls.length, kind, ms: round(cost), ...extra });
  }

  /**
   * 执行原调用并记录：`collect` 在调用**结束后**求值（取当前矩阵与色值），
   * 因为 image 的 save/restore 会把变换恢复回调用前的状态，两者等价；
   * 而放在 finally 里能保证「原方法抛错时，已发生的绘制也不会丢」。
   */
  function tap<T>(kind: DrawKind, collect: () => Partial<DrawCall>, run: () => T): T {
    if (!enabled) return run();
    const at = clock();
    const t0 = clock();
    try {
      return run();
    } finally {
      const cost = clock() - t0;
      note(kind, at, cost, collect());
    }
  }

  // -------------------------------------------------------------------------
  // 拦截器（每个都是「解析参数 → tap → 记一笔」）
  // -------------------------------------------------------------------------

  const onDrawImage = (args: unknown[]): void => {
    const image = args[0];
    const nine = args.length >= 9;
    const sx = nine ? numAt(args, 1) : 0;
    const sy = nine ? numAt(args, 2) : 0;
    const dx = nine ? numAt(args, 5) : numAt(args, 1);
    const dy = nine ? numAt(args, 6) : numAt(args, 2);
    const dw = nine ? numAt(args, 7) : numAt(args, 3);
    const dh = nine ? numAt(args, 8) : numAt(args, 4);
    const imgSize = image as { width?: number; height?: number };
    const sw = nine ? numAt(args, 3) : (imgSize.width ?? 0);
    const sh = nine ? numAt(args, 4) : (imgSize.height ?? 0);
    tap('image', () => ({ rect: projectLogical(dx, dy, dw, dh), source: { x: round(sx), y: round(sy), w: round(sw), h: round(sh) }, asset: assetNameOf(image) }), () => {
      ctx.drawImage(...(args as [CanvasImageSource, number, number, number, number]));
    });
  };

  const rectDraw = (kind: 'rect', stroke: boolean) => (args: unknown[]): void => {
    const x = numAt(args, 0);
    const y = numAt(args, 1);
    const w = numAt(args, 2);
    const h = numAt(args, 3);
    tap(kind, () => ({ rect: projectLogical(x, y, w, h), color: colorOf(stroke ? ctx.strokeStyle : ctx.fillStyle) }), () => {
      if (stroke) ctx.strokeRect(x, y, w, h);
      else ctx.fillRect(x, y, w, h);
    });
  };

  const textDraw = (stroke: boolean) => (args: unknown[]): void => {
    const text = typeof args[0] === 'string' ? args[0] : String(args[0]);
    const x = numAt(args, 1);
    const y = numAt(args, 2);
    tap('text', () => ({
      // 文字没有宽高：给 1×1 的锚点矩形，diff 时按坐标比对。
      rect: projectLogical(x, y, 1, 1),
      text,
      color: colorOf(stroke ? ctx.strokeStyle : ctx.fillStyle),
    }), () => {
      if (stroke) ctx.strokeText(text, x, y);
      else ctx.fillText(text, x, y);
    });
  };

  const pathDraw = (kind: 'fill' | 'stroke') => (): void => {
    tap(kind, () => ({ color: colorOf(kind === 'fill' ? ctx.fillStyle : ctx.strokeStyle) }), () => {
      if (kind === 'fill') ctx.fill();
      else ctx.stroke();
    });
  };

  const clearDraw = (args: unknown[]): void => {
    tap('clear', () => ({}), () => {
      ctx.clearRect(numAt(args, 0), numAt(args, 1), numAt(args, 2), numAt(args, 3));
    });
  };

  const handlers: Record<string, (args: unknown[]) => void> = {
    drawImage: onDrawImage,
    fillRect: rectDraw('rect', false),
    strokeRect: rectDraw('rect', true),
    fillText: textDraw(false),
    strokeText: textDraw(true),
    fill: pathDraw('fill'),
    stroke: pathDraw('stroke'),
    clearRect: clearDraw,
  };

  const bound: Record<string, (...args: unknown[]) => void> = {};
  for (const [name, handler] of Object.entries(handlers)) {
    bound[name] = (...args: unknown[]): void => handler(args);
  }

  const proxy = new Proxy(ctx, {
    get(target, prop, _receiver) {
      if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(bound, prop)) return bound[prop];
      const value = Reflect.get(target, prop, target);
      // 方法必须绑回原 ctx：微信/抖音的 ctx 是带内部槽的对象，this 错了会直接抛
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });

  const recorder: Recorder = {
    ctx: proxy,
    latest(): FrameSnapshot | null {
      if (current !== null) return snapshot(current);
      return frames[frames.length - 1] ?? null;
    },
    recent(limit?: number): readonly FrameSnapshot[] {
      const n = Math.min(capacity, Math.max(1, Math.floor(limit ?? 10)));
      const all = current === null ? frames.slice() : frames.concat([snapshot(current)]);
      return all.slice(Math.max(0, all.length - n));
    },
    stats(): RecorderStats {
      const last = current ?? frames[frames.length - 1] ?? null;
      const tail = frames.slice(-30);
      let fps = 0;
      if (tail.length >= 2) {
        const firstAt = tail[0]?.at ?? 0;
        const lastAt = tail[tail.length - 1]?.at ?? 0;
        const span = lastAt - firstAt;
        if (span > 0) fps = round(((tail.length - 1) * 1000) / span);
      }
      return {
        fps,
        drawsPerFrame: last === null ? 0 : last.calls.length,
        frameMs: last === null ? 0 : round(sumMs(last.calls)),
        retained: Math.min(capacity, frames.length + (current === null ? 0 : 1)),
        enabled,
        capacity,
      };
    },
    setEnabled(on: boolean): void {
      enabled = on;
      if (!on) {
        flush();
        lastCallAt = Number.NEGATIVE_INFINITY;
      }
    },
    reset(): void {
      frames.length = 0;
      current = null;
      frameNo = 0;
      lastCallAt = Number.NEGATIVE_INFINITY;
    },
    get capacity(): number {
      return capacity;
    },
  };

  return recorder;
};
