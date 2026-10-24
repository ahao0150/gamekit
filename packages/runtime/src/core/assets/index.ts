/**
 * 资源加载实现：清单 → 候选路径 → 并发限流 → 单张超时 → 缓存。
 *
 * 所有状态都在闭包里（每个 createAssets 一份），没有模块级可变状态。
 * 失败一律不抛错：单张返回 null，批量在结果里汇总，方便业务侧回落到纯色占位。
 *
 * 并发：候选路径按清单顺序逐个试，第一个成功即缓存并返回；
 * 同一 key 的并发 load 复用同一个 Promise，只真正加载一次。
 */

import type {
  AssetLoadOptions,
  AssetLoadResult,
  AssetManifest,
  AssetStatus,
  AtlasManifest,
  CreateAssets,
  ImageAsset,
} from './contract';
import type { LoadedImage } from './load-image';
import { withTimeout } from './load-image';
import { createAtlasLoader, ATLAS_KEY_PREFIX } from './atlas';
import type { AtlasLoader } from './atlas';

/** 默认并发上限：4（契约默认值；小游戏同时解码太多图会卡） */
export const DEFAULT_CONCURRENCY = 4;
/** 默认单张超时：10 秒 */
export const DEFAULT_TIMEOUT_MS = 10000;

const MIN_CONCURRENCY = 1;

const resolveConcurrency = (value?: number): number => {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_CONCURRENCY;
  return Math.max(MIN_CONCURRENCY, Math.floor(value));
};

/** 超时 <= 0 表示显式关闭超时（测试或本地调试用）。 */
const resolveTimeout = (value?: number): number => {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return value > 0 ? value : 0;
};

export const createAssets: CreateAssets = (opts) => {
  const manifest: AssetManifest = opts.manifest;
  const loadImage = opts.loadImage;
  const atlas: AtlasManifest | undefined = opts.atlas;
  /**
   * 图集加载器：只在给了 atlas 清单时创建。
   * 图集图与单图走同一套候选路径 + 超时逻辑，只是清单 key 带 `@atlas/` 前缀。
   */
  const atlasLoader: AtlasLoader | null = atlas === undefined
    ? null
    : createAtlasLoader({ manifest, atlas, loadImage, timeout: withTimeout });

  const cache = new Map<string, ImageAsset>();
  const statuses = new Map<string, AssetStatus>();
  const inflight = new Map<string, Promise<ImageAsset | null>>();
  const reasons = new Map<string, string>();
  /** 每次发起加载自增；release / clear 递增以作废尚未落地的结果 */
  const tokens = new Map<string, number>();

  const has = (key: string): boolean => {
    if (Object.prototype.hasOwnProperty.call(manifest, key)) return true;
    return atlasLoader !== null && atlasLoader.frameOf(key) !== null;
  };

  const status = (key: string): AssetStatus => {
    if (cache.has(key)) return 'ready';
    const recorded = statuses.get(key);
    if (recorded !== undefined) return recorded;
    return has(key) ? 'idle' : 'failed';
  };

  const attempt = async (
    key: string,
    candidates: readonly string[],
    timeoutMs: number,
    token: number,
  ): Promise<ImageAsset | null> => {
    try {
      for (const src of candidates) {
        let image: LoadedImage | null = null;
        try {
          const pending = loadImage(src);
          image = timeoutMs > 0 ? await withTimeout(pending, timeoutMs) : await pending;
        } catch {
          image = null; // 单张失败（超时 / 抛错 / 返回 null）继续试下一个候选
        }
        if (image === null) continue;

        const asset: ImageAsset = {
          key,
          width: image.width,
          height: image.height,
          src,
          native: image.native,
          // 单图：整张图就是帧，源矩形退化为全图 —— 渲染层用同一套字段就能工作
          sx: 0,
          sy: 0,
          sw: image.width,
          sh: image.height,
        };
        // release / clear 发生在加载途中：结果照样返回给这次调用，但不写回缓存
        if (tokens.get(key) !== token) return asset;
        cache.set(key, asset);
        statuses.set(key, 'ready');
        reasons.delete(key);
        return asset;
      }
      if (tokens.get(key) === token) {
        statuses.set(key, 'failed');
        reasons.set(key, `候选路径全部加载失败（${candidates.length} 个）`);
      }
      return null;
    } finally {
      if (tokens.get(key) === token) inflight.delete(key);
    }
  };

  /**
   * 图集帧加载：加载帧所属的图集图（同页共享），再按矩形切出这一帧。
   *
   * `width/height` 给**帧尺寸**，`sx/sy/sw/sh` 给源矩形 —— 这两件事必须分开，
   * 否则渲染层拿 `img.width` 当整张图集尺寸，画面会整块错位。
   */
  const attemptAtlas = async (
    key: string,
    frame: { readonly atlas: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number },
    timeoutMs: number,
    token: number,
  ): Promise<ImageAsset | null> => {
    try {
      const loader = atlasLoader;
      if (loader === null) return null;
      const image = await loader.imageOf(frame.atlas, timeoutMs);
      if (image === null) {
        if (tokens.get(key) === token) {
          statuses.set(key, 'failed');
          reasons.set(key, `图集 ${frame.atlas} 加载失败`);
        }
        return null;
      }
      const asset: ImageAsset = {
        key,
        width: frame.w,
        height: frame.h,
        src: `${ATLAS_KEY_PREFIX}${frame.atlas}`,
        native: image.native,
        sx: frame.x,
        sy: frame.y,
        sw: frame.w,
        sh: frame.h,
      };
      if (tokens.get(key) !== token) return asset;
      cache.set(key, asset);
      statuses.set(key, 'ready');
      reasons.delete(key);
      return asset;
    } finally {
      if (tokens.get(key) === token) inflight.delete(key);
    }
  };

  const load = (key: string, options?: AssetLoadOptions): Promise<ImageAsset | null> => {
    const cached = cache.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const running = inflight.get(key);
    if (running !== undefined) return running;

    // 先查图集帧：命中就只加载那一页图集，不再走单图候选路径
    const frame = atlasLoader === null ? null : atlasLoader.frameOf(key);
    const candidates = frame === null ? manifest[key] : undefined;
    if (frame === null && (candidates === undefined || candidates.length === 0)) {
      statuses.set(key, 'failed');
      reasons.set(key, '清单未登记该 key 或候选路径为空');
      return Promise.resolve(null);
    }

    const token = (tokens.get(key) ?? 0) + 1;
    tokens.set(key, token);
    statuses.set(key, 'loading');
    reasons.delete(key);
    const timeoutMs = resolveTimeout(options?.timeoutMs);
    const promise = frame === null
      ? attempt(key, candidates as readonly string[], timeoutMs, token)
      : attemptAtlas(key, frame, timeoutMs, token);
    inflight.set(key, promise);
    return promise;
  };

  const loadAll = async (
    keys: readonly string[],
    options?: AssetLoadOptions,
  ): Promise<AssetLoadResult> => {
    const unique = [...new Set(keys)];
    const total = unique.length;
    const failed: Record<string, string> = {};
    const concurrency = resolveConcurrency(options?.concurrency);
    let nextIndex = 0;
    let completed = 0;
    let loaded = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        const key = unique[index];
        if (key === undefined) return;

        const asset = await load(key, options);
        completed += 1;
        if (asset !== null) loaded += 1;
        else failed[key] = reasons.get(key) ?? '未知原因';
        // 进度回调的 loaded 是「已完成数（成功 + 失败）」，保证最终拍到 total
        try {
          options?.onProgress?.(completed, total, key);
        } catch {
          // 进度回调抛错不应中断加载
        }
      }
    };

    const workers: Promise<void>[] = [];
    const workerCount = Math.min(concurrency, total);
    for (let i = 0; i < workerCount; i += 1) workers.push(worker());
    await Promise.all(workers);
    return { loaded, total, failed };
  };

  const release = (key: string): void => {
    cache.delete(key);
    inflight.delete(key);
    tokens.set(key, (tokens.get(key) ?? 0) + 1);
    reasons.delete(key);
    statuses.delete(key);
  };

  const clear = (): void => {
    for (const key of inflight.keys()) tokens.set(key, (tokens.get(key) ?? 0) + 1);
    cache.clear();
    inflight.clear();
    statuses.clear();
    reasons.clear();
    atlasLoader?.clear();
  };

  return {
    manifest,
    load,
    loadAll,
    get(key: string): ImageAsset | null {
      return cache.get(key) ?? null;
    },
    status,
    has,
    release,
    clear,
  };
};
