/**
 * 图集打包的类型。
 *
 * `atlas.json` 的形状由 runtime 的 `AtlasManifest` 定死（`packages/runtime/src/core/assets/contract.ts`），
 * 这里给一份同形的本地声明：插件包不 import runtime（构建工具不该依赖运行时），
 * 所以两份形状必须**手工保持一致** —— 改任何一边都要同步另一边。
 */

import type { QualityReport } from './quantize';

/** 图集里的一帧：图集原图像素、左上角原点。 */
export interface AtlasFrameOut {
  readonly atlas: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 写进 `atlas.json` 的完整清单。 */
export interface AtlasManifestOut {
  readonly version: number;
  readonly atlases: Readonly<Record<string, { readonly w: number; readonly h: number }>>;
  readonly frames: Readonly<Record<string, AtlasFrameOut>>;
}

/** 进图集的一张图（像素已经解码成 RGBA8888）。 */
export interface PackInput {
  /** 清单 key：相对 assets/ 的路径去掉扩展名 */
  readonly key: string;
  readonly width: number;
  readonly height: number;
  /** 长度必须是 width × height × 4 */
  readonly rgba: Uint8Array;
}

/** 排布参数。 */
export interface PackOptions {
  /** 单页最大边长（像素）。超过就开新页 */
  readonly maxTextureSize: number;
  /** 帧之间的间距，以及帧与页边的间距（像素） */
  readonly padding: number;
  /** 单边超过它的图不进图集（继续单图直连） */
  readonly maxFrameSize: number;
  /** 压缩策略：auto = 量化到 PNG8（质量不达标则降级为无损）；none = 直接无损 */
  readonly compress?: 'auto' | 'none';
}

/** 排布结果里的一个位置。 */
export interface PackedRect {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 一页图集的排布（还没有像素）。 */
export interface PageLayout {
  /** 页文件名，如 atlas-0.png */
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** 实际用到的最大 y（含 padding），用于把页裁短 */
  readonly usedHeight: number;
  readonly rects: readonly PackedRect[];
}

/** 打包完成的一页：排布 + 编码好的 PNG。 */
export interface AtlasPageOut {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly png: Uint8Array;
  /** png8 = 已量化到 ≤256 色调色板；rgba = 无损全彩（未启用压缩或质量降级） */
  readonly mode: 'png8' | 'rgba';
  /**
   * 量化质量报告。有它表示**跑过量化**：mode=png8 代表通过判据，
   * mode=rgba 代表量化过但质量不达标、已降级为无损。
   */
  readonly quality?: QualityReport;
}

/** 没进图集的图（原因给日志和测试用）。 */
export interface ExcludedImage {
  readonly key: string;
  readonly reason: 'too-large' | 'no-fit';
}

/** `pack()` 的返回值：dev 与 build 都从这里拿东西。 */
export interface AtlasBuild {
  readonly pages: readonly AtlasPageOut[];
  readonly atlas: AtlasManifestOut;
  readonly excluded: readonly ExcludedImage[];
}
