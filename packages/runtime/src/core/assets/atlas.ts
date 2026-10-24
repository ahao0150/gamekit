/**
 * 图集加载器：帧清单 → 「加载哪张图集、切哪个矩形」。
 *
 * 两个必须成立的性质：
 * 1. **同图集只加载一次**：一页图集上有几十个帧，逐帧加载会把网络和解码打爆；
 *    这里按图集名缓存 Promise，多帧共享同一个 `native`。
 * 2. **帧尺寸与矩形是两回事**：`ImageAsset.width/height` 必须是**帧**尺寸，
 *    源矩形单独放 `sx/sy/sw/sh` —— 否则渲染层 `drawImage(native, 0, 0, w, h, ...)`
 *    会把整张图集当成一张小图缩放，画面全错。
 *
 * 图集图在资源清单里的 key 约定是 `@atlas/<图集文件名>`（见 `ATLAS_KEY_PREFIX`）：
 * 这样图集图走的是**同一套候选路径 + webp 降级 + 超时**逻辑，不需要 runtime
 * 知道 URL 怎么拼（dev 中间件与 build 产物都只需往清单里登记这个 key）。
 */

import type { AssetManifest, AtlasFrame, AtlasManifest } from './contract';
import type { LoadedImage } from './load-image';

/**
 * 图集图在 `AssetManifest` 里的 key 前缀。
 *
 * 为什么加前缀而不是直接用文件名：业务 key 是 `icons/coin` 这种路径形式，
 * 图集是构建产物，用一个独立命名空间才不会撞（也便于 doctor 一眼认出来）。
 * `@mg/vite` 打包核心必须用同一个前缀登记。
 */
export const ATLAS_KEY_PREFIX = '@atlas/';

export interface AtlasLoader {
  /** 该 key 是否是图集帧；不是返回 null（走单图路径）。 */
  frameOf(key: string): AtlasFrame | null;
  /**
   * 加载帧所属的图集图。同图集复用同一个 Promise，**只真正加载一次**。
   * 失败返回 null（不抛错）。
   */
  imageOf(atlasName: string, timeoutMs: number): Promise<LoadedImage | null>;
  /** 已缓存的图集图数量（测试断言「只加载一次」用）。 */
  readonly atlasImageCount: number;
  /** 清空图集图缓存（切场景 / 清空资源时调）。 */
  clear(): void;
}

export const createAtlasLoader = (opts: {
  readonly manifest: AssetManifest;
  readonly atlas: AtlasManifest;
  /** 平台加载单张图；失败返回 null 或抛错，两者都算失败 */
  readonly loadImage: (src: string) => Promise<LoadedImage | null>;
  /** 超时包装（<=0 表示不超时），由调用方注入以免这里依赖计时策略 */
  readonly timeout: <T>(task: Promise<T>, ms: number) => Promise<T>;
}): AtlasLoader => {
  const { manifest, atlas, loadImage, timeout } = opts;
  const images = new Map<string, Promise<LoadedImage | null>>();

  const frameOf = (key: string): AtlasFrame | null => {
    const frame = atlas.frames[key];
    return frame === undefined ? null : frame;
  };

  /** 按候选路径顺序试一张图，全失败返回 null。 */
  const loadOne = async (atlasName: string, timeoutMs: number): Promise<LoadedImage | null> => {
    const candidates = manifest[ATLAS_KEY_PREFIX + atlasName];
    if (candidates === undefined || candidates.length === 0) return null;
    for (const src of candidates) {
      try {
        const pending = loadImage(src);
        const image = timeoutMs > 0 ? await timeout(pending, timeoutMs) : await pending;
        if (image !== null) return image;
      } catch {
        // 这一张失败（超时 / 抛错 / null）→ 试下一个候选（webp → png 降级）
      }
    }
    return null;
  };

  const imageOf = (atlasName: string, timeoutMs: number): Promise<LoadedImage | null> => {
    const cached = images.get(atlasName);
    if (cached !== undefined) return cached;
    const promise = loadOne(atlasName, timeoutMs);
    images.set(atlasName, promise);
    // 失败的 Promise 不留在缓存里：下次调用应能重试（网络抖动不该永久失败）
    promise.then(
      (image) => {
        if (image === null) images.delete(atlasName);
      },
      () => {
        images.delete(atlasName);
      },
    );
    return promise;
  };

  return {
    frameOf,
    imageOf,
    get atlasImageCount(): number {
      return images.size;
    },
    clear(): void {
      images.clear();
    },
  };
};
