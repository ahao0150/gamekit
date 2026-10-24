/**
 * 资源加载契约。
 *
 * 为什么需要清单：小游戏没有 `fetch`，也不能靠 Vite 的 asset 依赖图
 * （没有 `new URL(url, import.meta.url)`）。所以「有哪些图可用」必须在构建时
 * 算好、编译进包里——这就是 `AssetManifest`。运行时只按 key 查，查不到就是
 * 构建漏了，不是运行时报错。
 *
 * 为什么一个 key 对应多个候选路径：老框架的规则是「同名 png/webp 只打较小的
 * 那份」，但客户端要能兜底。清单里给候选数组，运行时按顺序试，第一个加载成功
 * 的缓存下来。
 *
 * 为什么失败要能回落：美术分批到货是常态。缺图不能让整局崩，必须回落到
 * 纯色占位，且状态可查（测试要断言「缺图时降级发生过」）。
 */

// ---------------------------------------------------------------------------
// 清单（构建注入）
// ---------------------------------------------------------------------------

/**
 * 资源清单：资源 key → 候选相对路径数组（按优先级）。
 *
 * 由 `@mg/vite` 在构建时扫描 `assets/` 生成，编译进包。键名是业务用的稳定 key
 * （如 `'ui.btn'`），不是文件路径——文件改名不影响业务代码。
 */
export type AssetManifest = Readonly<Record<string, readonly string[]>>;

// ---------------------------------------------------------------------------
// 资源对象
// ---------------------------------------------------------------------------

/** 已加载的图片。`native` 是平台底层对象，业务代码不该碰它。 */
export interface ImageAsset {
  readonly key: string;
  /**
   * **帧的逻辑尺寸**，不是整张图集尺寸。
   *
   * 这是「接入图集后业务代码零改动」的关键：渲染层一直用
   * `img.width / img.height` 当绘制尺寸，只要这里给的是帧尺寸，
   * 单图与图集帧的语义就完全一致。
   */
  readonly width: number;
  readonly height: number;
  /** 实际命中的候选路径（图集帧时是图集图的路径；调试用） */
  readonly src: string;
  readonly native: unknown;
  /** 图集帧在 `native` 里的源矩形（单图时 0 / 0 / width / height） */
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

// ---------------------------------------------------------------------------
// 图集（atlas）
// ---------------------------------------------------------------------------

/**
 * 图集里的一帧。坐标是**图集原图像素**、左上角原点。
 *
 * 为什么单独一个类型：帧矩形是图集清单里的核心数据，
 * 切割、调试面板、验收断言都要读它。
 */
export interface AtlasFrame {
  /** 图集文件名，如 `atlas-0.png`（对应 `AtlasManifest.atlases` 的 key） */
  readonly atlas: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 图集清单。
 *
 * **构建产物与 dev 动态生成格式完全一致**：`dev` 不是另一条路径，
 * 它只是把同一个打包核心的结果通过中间件吐出来。否则「切图对不对」
 * 这类问题永远只在打包上线时暴露。
 *
 * `frames` 的 key = **相对 `assets/` 的路径去掉扩展名**（如 `icons/coin`）。
 */
export interface AtlasManifest {
  readonly version: number;
  /** 图集文件名 → 图集图片尺寸 */
  readonly atlases: Readonly<Record<string, { readonly w: number; readonly h: number }>>;
  /** 帧 key → 帧矩形 */
  readonly frames: Readonly<Record<string, AtlasFrame>>;
}

/** 单个资源的加载状态。 */
export type AssetStatus = 'idle' | 'loading' | 'ready' | 'failed';

// ---------------------------------------------------------------------------
// 加载配置
// ---------------------------------------------------------------------------

export interface AssetLoadOptions {
  /** 并发上限，默认 4。小游戏同时解码太多图会卡。 */
  readonly concurrency?: number;
  /** 单张超时（ms），默认 10000；超时按失败处理并尝试下一个候选 */
  readonly timeoutMs?: number;
  /** 进度回调；`total` 是本批次要加载的数量 */
  readonly onProgress?: (loaded: number, total: number, key: string) => void;
}

/** 一批资源的加载结果，不抛错——失败项在 `failed` 里。 */
export interface AssetLoadResult {
  readonly loaded: number;
  readonly total: number;
  /** key → 失败原因（中文，可直接进日志） */
  readonly failed: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export interface AssetService {
  /** 构建注入的清单，只读 */
  readonly manifest: AssetManifest;

  /** 加载单个资源。已加载则直接返回缓存；失败返回 null（不抛错）。 */
  load(key: string, opts?: AssetLoadOptions): Promise<ImageAsset | null>;

  /** 批量加载。单个失败不影响其余，结果里汇总。 */
  loadAll(keys: readonly string[], opts?: AssetLoadOptions): Promise<AssetLoadResult>;

  /** 同步读取已加载的资源；没加载好返回 null。渲染层用这个，不 await。 */
  get(key: string): ImageAsset | null;

  /** 查询单个 key 的状态。测试与 doctor 用。 */
  status(key: string): AssetStatus;

  /** 清单里是否有这个 key（构建是否登记过）。 */
  has(key: string): boolean;

  /** 释放一个资源的引用（小游戏内存紧张时用）。 */
  release(key: string): void;

  /** 清空全部缓存（切场景时用）。 */
  clear(): void;
}

export type CreateAssets = (opts: {
  /** 由 platform 提供：加载一张图，失败返回 null */
  readonly loadImage: (src: string) => Promise<{ width: number; height: number; native: unknown } | null>;
  readonly manifest: AssetManifest;
  /**
   * 图集清单（可选）。命中 `frames[key]` 时加载整张图集、复用同一份 `native`；
   * 未命中走原来的候选路径逻辑。不传 = 完全保持接入图集前的行为。
   */
  readonly atlas?: AtlasManifest;
}) => AssetService;
