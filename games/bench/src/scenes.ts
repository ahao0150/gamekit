/**
 * 合成负载场景（T30 起含离屏缓存对照）。
 *
 * 一条硬约束：**坐标全部预计算**。`draw` 里只允许出现绘制调用 ——
 * 如果每帧现算随机位置，测出来的就是「随机数 + 取模 + 绘制」，不是绘制成本。
 * 位置用互质步长（97 / 131）平铺，确定性、铺满、允许重叠（真实密集场景就是重叠的）。
 */
import type { Atlas } from './atlas';
import { drawWithGlow } from '../../../packages/runtime/src/core/fx/glow';
import { createLayerCache } from '../../../packages/runtime/src/core/render/cache';

/**
 * 全部负载类型。
 *
 * 三个 `ui-*` 是同一份静态 UI 层的三种画法，用于回答「离屏缓存值不值得做」：
 * - `ui-direct`：每帧全部重画（基线）
 * - `ui-cached`：基准自己手搓的离屏 canvas（T26 的对照）
 * - `ui-layer-cache`：**引擎真实现** `core/render/cache.ts`（T30 落地的那份）
 */
export const SCENE_KINDS = [
  'sprite',
  'text',
  'rect',
  'glow',
  'ui-direct',
  'ui-cached',
  'ui-layer-cache',
] as const;

/** 负载类型。 */
export type SceneKind = (typeof SCENE_KINDS)[number];

/** 报告里用的中文名。 */
export const SCENE_LABELS: Record<SceneKind, string> = {
  sprite: '精灵 drawImage 64×64',
  text: '文字 fillText 14px 中英',
  rect: 'UI 块 fillRect 64×32 半透明',
  glow: '发光 drawWithGlow（3 层径向）',
  'ui-direct': '静态 UI 层 · 每帧全部重画',
  'ui-cached': '静态 UI 层 · 手写离屏 canvas',
  'ui-layer-cache': '静态 UI 层 · createLayerCache（引擎实现）',
};

/** 场景依赖的环境（固定尺寸、预先建好的图集）。 */
export interface SceneEnv {
  readonly width: number;
  readonly height: number;
  /** 逻辑尺寸 → 物理像素的倍率：离屏缓存层要用它建 backing */
  readonly dpr: number;
  readonly atlas: Atlas;
}

/** 一个可重复执行的负载。 */
export interface Scene {
  readonly kind: SceneKind;
  readonly n: number;
  readonly draw: (ctx: CanvasRenderingContext2D) => void;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** 中英混排样本：14px 下宽度差异大，接近真实 HUD 文字。 */
const TEXT_SAMPLES = [
  '得分 1280 分',
  'Score +42',
  '包裹已送达 · +12 积分',
  'Level 3 开始',
  'Combo ×12 连击',
] as const;

/** 确定性散布：互质步长遍历，不产生同一位置的重复热点。 */
const scatter = (n: number, width: number, height: number, boxW: number, boxH: number): Point[] => {
  const spanX = Math.max(1, width - boxW);
  const spanY = Math.max(1, height - boxH);
  const out: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ x: (i * 97) % spanX, y: (i * 131) % spanY });
  }
  return out;
};

/**
 * 静态 UI 层：每个元素 = 面板底 + 图标 + 文字（3 次绘制调用）。
 * `ui-direct` 每帧调它 n 次；两个缓存方案只在建层时调一次。
 */
const paintUiLayer = (ctx: CanvasRenderingContext2D, positions: readonly Point[], env: SceneEnv): void => {
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const cells = env.atlas.cells;
  for (let i = 0; i < positions.length; i += 1) {
    const point = positions[i];
    if (point === undefined) continue;
    const cell = cells[i % cells.length] ?? { sx: 0, sy: 0 };
    ctx.fillStyle = i % 2 === 0 ? '#232b3b' : '#2a3346';
    ctx.fillRect(point.x, point.y, 96, 48);
    ctx.drawImage(env.atlas.canvas, cell.sx, cell.sy, env.atlas.cell, env.atlas.cell, point.x + 6, point.y + 6, 36, 36);
    ctx.fillStyle = '#cfd6e4';
    ctx.fillText(TEXT_SAMPLES[i % TEXT_SAMPLES.length] ?? '', point.x + 48, point.y + 28);
  }
};

/** bench 页面是 web，离屏层直接用 DOM canvas（引擎的 web 实现也是这么做的）。 */
const createOffscreenCanvas = (width: number, height: number): {
  readonly width: number;
  readonly height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
  readonly native: HTMLCanvasElement;
} => {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  return {
    get width(): number {
      return el.width;
    },
    get height(): number {
      return el.height;
    },
    getContext: (type: '2d') => el.getContext(type),
    native: el,
  };
};

/** 建一个场景：所有位置、离屏层在这里算好，`draw` 里只剩绘制。 */
export const createScene = (kind: SceneKind, n: number, env: SceneEnv): Scene => {
  const count = Math.max(0, Math.floor(n));

  if (kind === 'sprite') {
    const points = scatter(count, env.width, env.height, 64, 64);
    const cells = env.atlas.cells;
    const cellSize = env.atlas.cell;
    return {
      kind,
      n: count,
      draw: (ctx) => {
        for (let i = 0; i < points.length; i += 1) {
          const point = points[i];
          if (point === undefined) continue;
          const cell = cells[i % cells.length] ?? { sx: 0, sy: 0 };
          ctx.drawImage(env.atlas.canvas, cell.sx, cell.sy, cellSize, cellSize, point.x, point.y, cellSize, cellSize);
        }
      },
    };
  }

  if (kind === 'text') {
    const points = scatter(count, env.width, env.height, 120, 18);
    return {
      kind,
      n: count,
      draw: (ctx) => {
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#e8e8e8';
        for (let i = 0; i < points.length; i += 1) {
          const point = points[i];
          if (point === undefined) continue;
          ctx.fillText(TEXT_SAMPLES[i % TEXT_SAMPLES.length] ?? '', point.x, point.y);
        }
      },
    };
  }

  if (kind === 'rect') {
    const points = scatter(count, env.width, env.height, 64, 32);
    return {
      kind,
      n: count,
      draw: (ctx) => {
        ctx.fillStyle = 'rgba(120, 180, 255, 0.35)';
        for (const point of points) {
          ctx.fillRect(point.x, point.y, 64, 32);
        }
      },
    };
  }

  if (kind === 'glow') {
    const points = scatter(count, env.width, env.height, 64, 64);
    const opts = { color: '#ffcc00', layers: 3 } as const;
    return {
      kind,
      n: count,
      draw: (ctx) => {
        ctx.fillStyle = '#ffcc00';
        for (const point of points) {
          drawWithGlow(ctx, { x: point.x, y: point.y, w: 64, h: 64 }, opts, () => {
            ctx.fillRect(point.x, point.y, 64, 64);
          });
        }
      },
    };
  }

  // 三个 ui-* 负载：同一份静态 UI 层的三种画法
  const points = scatter(count, env.width, env.height, 96, 48);
  if (kind === 'ui-direct') {
    return {
      kind,
      n: count,
      draw: (ctx) => paintUiLayer(ctx, points, env),
    };
  }

  if (kind === 'ui-layer-cache') {
    // 引擎真实现：首次 draw 重画一次，之后每帧只 drawImage 一次
    const cache = createLayerCache({
      createCanvas: createOffscreenCanvas,
      width: env.width,
      height: env.height,
      dpr: env.dpr,
    });
    return {
      kind,
      n: count,
      draw: (ctx) => {
        cache.draw(ctx, (cacheCtx) => paintUiLayer(cacheCtx, points, env));
      },
    };
  }

  // ui-cached：手写离屏对照（建时画一次，每帧一次 drawImage）
  const layer = document.createElement('canvas');
  layer.width = env.width * env.dpr;
  layer.height = env.height * env.dpr;
  const layerCtx = layer.getContext('2d');
  if (layerCtx === null) throw new Error('无法创建离屏画布：ui-cached 失败');
  layerCtx.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
  paintUiLayer(layerCtx, points, env);
  return {
    kind,
    n: count,
    draw: (ctx) => {
      ctx.drawImage(layer, 0, 0, env.width, env.height);
    },
  };
};
