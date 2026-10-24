/** `@mg/vite` 公开类型。资源清单结构对齐 runtime/core/assets 的 AssetManifest。 */
export type MgTarget = 'web' | 'wx' | 'tt';
/**
 * 适配策略，透传给 PlatformBootOptions.fit。
 *
 * - `contain`（默认）：按设计分辨率等比缩放到视口内、完整可见，比例不同侧会留边
 * - `height` / `width`：贴住视口某一维
 * - `fill`：**画布铺满视口**，逻辑尺寸 = 视口尺寸，没有留边
 *
 * 为什么加 `fill`：`contain` 只要设计比例与设备比例不一致就必然留边，而且
 * **留边方向随设备变** —— 设备比设计宽（iPhone SE 1.779 vs 设计 2.164）时左右留，
 * 设备比设计长（安卓 2.222）时上下留。锁死一个比例，就永远有设备难看。
 * 有了布局引擎（region 百分比 + fill + 组件 measure）之后，正确做法是画布铺满、
 * 内容自适应；`design` 降级成「固定像素的参考基准」，不再决定画布大小。
 */
export type MgFit = 'height' | 'width' | 'contain' | 'fill';
/** key → 产物内候选路径（按尝试顺序）。 */
export type MgManifest = Readonly<Record<string, readonly string[]>>;
export interface MgDesign { readonly width: number; readonly height: number }
/** 分包：分包名 → 资源相对路径前缀列表（前缀命中即进该分包）。 */
export interface MgSubpackages { readonly [name: string]: readonly string[] }
/** 图集配置（写进 `game.config.json` 的 `atlas` 字段）。 */
export interface MgAtlasOptions {
  readonly enabled?: boolean;
  /** 单页最大边长，默认 2048 */
  readonly maxTextureSize?: number;
  /** 单边超过它的图不进图集，默认 512 */
  readonly maxFrameSize?: number;
  /** 帧间距 / 页边距，默认 2 */
  readonly padding?: number;
  /** 压缩策略：auto = 有工具就用，没有就记一行日志继续；none = 不压缩 */
  readonly compress?: 'auto' | 'none';
}
/** 补齐默认值后的图集配置。 */
export interface ResolvedAtlas {
  readonly maxTextureSize: number;
  readonly maxFrameSize: number;
  readonly padding: number;
  readonly compress: 'auto' | 'none';
}
/** 插件选项。路径均可相对 root，缺省值见 options.ts。 */
export interface MgPluginOptions {
  readonly target: MgTarget; readonly design: MgDesign;
  readonly root?: string; readonly fit?: MgFit; readonly entry?: string;
  readonly assetsDir?: string; readonly packDir?: string;
  readonly subpackages?: MgSubpackages; readonly outDir?: string;
  readonly title?: string; readonly projectName?: string;
  readonly atlas?: MgAtlasOptions;
  /** 相对 root：含 levels/production/prices 的 .tsv/.csv，buildStart 时编译为同目录 JSON */
  readonly economyDir?: string;
}
/** 补齐默认值后：路径全为绝对路径。 */
export interface ResolvedOptions {
  readonly target: MgTarget; readonly root: string; readonly design: MgDesign;
  readonly fit: MgFit; readonly entry: string; readonly assetsDir: string;
  readonly packDir: string; readonly subpackages: MgSubpackages;
  readonly outDir: string; readonly title: string; readonly projectName: string;
  /** null = 图集未启用（保持接入图集前的行为） */
  readonly atlas: ResolvedAtlas | null;
  readonly economyDir: string | null;
}
/** 确定进包的资源；key 是相对资源目录、去扩展名的稳定标识。 */
export interface AssetFile {
  readonly key: string; readonly rel: string; readonly from: string;
  readonly bytes: number; readonly pkg: string | null;
}
export interface SubpackageSize { readonly name: string; readonly bytes: number }
/** 包体统计。main 不含 subpackages/ 目录。 */
export interface BundleReport {
  readonly main: number; readonly subpackages: readonly SubpackageSize[];
  readonly total: number; readonly files: number;
  readonly limitBytes: number; readonly ok: boolean;
}
/** 4MB 是微信/抖音平台硬限；3MB 团队保守线在 mg check 里。 */
export const MAIN_LIMIT_BYTES = 4 * 1024 * 1024;
