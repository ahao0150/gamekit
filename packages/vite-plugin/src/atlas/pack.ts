/**
 * 图集打包核心：**dev 与 build 共用的唯一入口**。
 *
 * 为什么必须只有一个：图集的风险不在 API 形状，在「切图对不对」。
 * 如果 dev 走另一条路径，这些错误就永远只在打包上线时暴露。
 * 所以 dev 中间件与 build 产物都只调 `pack()`。
 */

import { packLayout } from './layout';
import { encodePng, encodePng8 } from './png';
import { isQualityOk, quantize } from './quantize';
import type {
  AtlasBuild,
  AtlasFrameOut,
  ExcludedImage,
  PackInput,
  PackOptions,
} from './types';

/** 把一张图的像素拷到页缓冲里（页缓冲是 RGBA8888、行优先）。 */
const blit = (target: Uint8Array, targetWidth: number, image: PackInput, x: number, y: number): void => {
  for (let row = 0; row < image.height; row += 1) {
    const srcStart = row * image.width * 4;
    const dstStart = ((y + row) * targetWidth + x) * 4;
    target.set(image.rgba.subarray(srcStart, srcStart + image.width * 4), dstStart);
  }
};

/**
 * 打包：单边超过 `maxFrameSize` 的图不进图集（退回单图直连），
 * 其余按 shelf 排布、拼像素、编码 PNG，返回清单与排除清单。
 */
export const pack = (images: readonly PackInput[], opts: PackOptions): AtlasBuild => {
  const eligible: PackInput[] = [];
  const excluded: ExcludedImage[] = [];
  for (const image of images) {
    if (image.width > opts.maxFrameSize || image.height > opts.maxFrameSize) {
      excluded.push({ key: image.key, reason: 'too-large' });
      continue;
    }
    eligible.push(image);
  }

  const layout = packLayout(
    eligible.map(({ key, width, height }) => ({ key, width, height })),
    opts,
  );
  const byKey = new Map(eligible.map((image) => [image.key, image] as const));

  const pages: AtlasBuild['pages'][number][] = [];
  const frames: Record<string, AtlasFrameOut> = {};
  const atlases: Record<string, { readonly w: number; readonly h: number }> = {};

  for (const page of layout) {
    const buffer = new Uint8Array(page.width * page.height * 4);
    for (const rect of page.rects) {
      const image = byKey.get(rect.key);
      if (image === undefined) continue;
      blit(buffer, page.width, image, rect.x, rect.y);
      frames[rect.key] = { atlas: page.name, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    }
    // 量化到 ≤256 色（PNG8）；质量不达标就退回无损 RGBA —— 体积换画质的取舍要可测
    const quantized = opts.compress === 'none' ? null : quantize(buffer, page.width, page.height, 256);
    const usePalette = quantized !== null && isQualityOk(quantized.quality);
    pages.push({
      name: page.name,
      width: page.width,
      height: page.height,
      png: usePalette && quantized !== null
        ? encodePng8(page.width, page.height, quantized.palette, quantized.indices)
        : encodePng(page.width, page.height, buffer),
      mode: usePalette ? 'png8' : 'rgba',
      // 跑过量化就带上质量报告：mode=rgba 且这里有时，说明是「量化过但降级了」
      ...(quantized !== null ? { quality: quantized.quality } : {}),
    });
    atlases[page.name] = { w: page.width, h: page.height };
  }

  // 排布阶段没排进去的（尺寸合法但整页都放不下，理论不可达）也如实报出来，
  // 不要静默丢图 —— 静默丢图在运行时的表现是「这个 key 永远加载失败」。
  const packedKeys = new Set(Object.keys(frames));
  for (const image of eligible) {
    if (!packedKeys.has(image.key)) excluded.push({ key: image.key, reason: 'no-fit' });
  }

  return { pages, atlas: { version: 1, atlases, frames }, excluded };
};
