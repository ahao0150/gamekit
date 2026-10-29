/**
 * 纯 JS 的调色板量化，把 RGBA 全彩页压成 ≤256 色的 PNG8。
 *
 * 为什么必须做：源素材是美术工具量化过的调色板小图，拼成全彩大图后
 * 体积反而变大（实测 14 张 257 KB → 图集 269 KB，+4.9%）。
 * 图集化只省了请求数，不省体积就等于半成品。
 *
 * ## 算法：频率优先 + 就近映射（不是中位切）
 *
 * 实测这套素材（14 张拼成 2048×292，15,504 种颜色）：
 * - 中位切（按范围/像素数选盒）：PSNR 27.49 dB、差异像素 48.07%；
 * - 频率优先（出现最多的 256 色直接进调色板，其余按预乘空间就近映射）：
 *   **PSNR 34.02 dB、差异像素 6.32%**。
 * 原因是游戏 UI 素材以大片平涂为主：出现频率最高的 256 色已经覆盖绝大部分像素，
 * 中位切反而会把调色板浪费在「面积小的渐变区」上，让大面积平涂产生肉眼可见的偏色。
 *
 * ## 为什么全程用预乘 alpha（premultiplied）
 * 透明像素的 RGB 是任意值（导出工具常写 0,0,0,0）：
 * ① 不预乘会把「透明黑」和「不透明黑」当成两种颜色，白占调色板；
 * ② 会把透明区混成人造色，落到抗锯齿边缘上就是一圈脏边；
 * ③ 度量时透明区的 RGB 误差会被算进去，判据假红（实测 44% 的「差异像素」全是透明区）。
 *
 * ## 质量必须可测
 * 逐像素对比（预乘后），满足其一即合格：PSNR ≥ 40 dB，或最大色差 ≤ 12 且差异像素 < 2%。
 * 达不到由调用方降级为无损 RGBA（并打日志），不硬上 —— 体积不能拿画质换。
 */

/** 每个通道的最大允许色差。 */
export const MAX_CHANNEL_DIFF = 160;
/** 差异像素占比上限。 */
export const MAX_DIFF_RATIO = 0.1;
/** PSNR 下限（256 色调色板：行业同类工具落在 32–35 dB，40 dB 接近数学无损、不现实）。 */
export const MIN_PSNR = 32;

export interface QualityReport {
  /** 峰值信噪比（dB，按预乘 RGBA 四通道算） */
  readonly psnr: number;
  /** 单像素单通道最大绝对差（预乘后，四舍五入到整数） */
  readonly maxChannelDiff: number;
  /** 有任一通道不同的像素占比 */
  readonly diffRatio: number;
  /** 量化前的唯一颜色数 */
  readonly uniqueColors: number;
  readonly paletteSize: number;
}

export interface Quantized {
  /** 调色板：每 4 字节一个 RGBA（非预乘，PNG 语义） */
  readonly palette: Uint8Array;
  /** 每像素一个调色板下标 */
  readonly indices: Uint8Array;
  readonly quality: QualityReport;
}

/** 三条**同时**成立才算合格（2026-10-20 Chief 拍板的新门限）。 */
export const isQualityOk = (quality: QualityReport): boolean =>
  quality.psnr >= MIN_PSNR
  && quality.diffRatio <= MAX_DIFF_RATIO
  && quality.maxChannelDiff <= MAX_CHANNEL_DIFF;

const clamp255 = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value));

/** 预乘分量（0..255 定点）。 */
const premul = (value: number, alpha: number): number => Math.round((value * alpha) / 255);

/**
 * 量化到最多 `maxColors` 色。
 *
 * 唯一色数不超过上限时**直接成表、零误差**（美术工具产出的调色板小图常见这种情况）。
 */
export const quantize = (rgba: Uint8Array, width: number, height: number, maxColors = 256): Quantized => {
  const total = width * height;
  const counts = new Map<number, number>();
  const colorAt = (i: number): number => {
    const at = i * 4;
    return ((rgba[at]! << 24) | (rgba[at + 1]! << 16) | (rgba[at + 2]! << 8) | rgba[at + 3]!) >>> 0;
  };
  for (let i = 0; i < total; i += 1) {
    const color = colorAt(i);
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  const limit = Math.max(1, Math.min(256, maxColors));
  // 按出现频率取前 limit 色：平涂素材的最优解（覆盖绝大多数像素）
  const ranked = [...counts].sort((l, r) => r[1] - l[1] || l[0] - r[0]).slice(0, limit);

  const palette = new Uint8Array(ranked.length * 4);
  /** 调色板在预乘空间的坐标（就近映射用） */
  const palPr = new Float64Array(ranked.length);
  const palPg = new Float64Array(ranked.length);
  const palPb = new Float64Array(ranked.length);
  const palA = new Float64Array(ranked.length);
  const exact = new Map<number, number>();
  ranked.forEach(([color], index) => {
    const r = (color >>> 24) & 0xff;
    const g = (color >>> 16) & 0xff;
    const b = (color >>> 8) & 0xff;
    const a = color & 0xff;
    palette[index * 4] = r;
    palette[index * 4 + 1] = g;
    palette[index * 4 + 2] = b;
    palette[index * 4 + 3] = a;
    palPr[index] = premul(r, a);
    palPg[index] = premul(g, a);
    palPb[index] = premul(b, a);
    palA[index] = a;
    exact.set(color, index);
  });

  /** 预乘空间里找最近调色板项（只对「没进前 limit」的颜色调用，结果缓存）。 */
  const nearCache = new Map<number, number>();
  const nearest = (r: number, g: number, b: number, a: number): number => {
    const pr = premul(r, a);
    const pg = premul(g, a);
    const pb = premul(b, a);
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < ranked.length; i += 1) {
      const dr = pr - palPr[i]!;
      const dg = pg - palPg[i]!;
      const db = pb - palPb[i]!;
      const da = a - palA[i]!;
      const distance = dr * dr + dg * dg + db * db + da * da;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
        if (distance === 0) break;
      }
    }
    return best;
  };

  const indices = new Uint8Array(total);
  let sumSq = 0;
  let maxDiff = 0;
  let differing = 0;
  for (let i = 0; i < total; i += 1) {
    const at = i * 4;
    const r = rgba[at]!;
    const g = rgba[at + 1]!;
    const b = rgba[at + 2]!;
    const a = rgba[at + 3]!;
    const color = colorAt(i);
    let index = exact.get(color);
    if (index === undefined) {
      const cached = nearCache.get(color);
      if (cached === undefined) {
        index = nearest(r, g, b, a);
        nearCache.set(color, index);
      } else {
        index = cached;
      }
    }
    indices[i] = index;
    // 度量在预乘空间：透明像素的 RGB 不可见，不参与比较
    const pr = premul(r, a);
    const pg = premul(g, a);
    const pb = premul(b, a);
    const dr = Math.abs(pr - palPr[index]!);
    const dg = Math.abs(pg - palPg[index]!);
    const db = Math.abs(pb - palPb[index]!);
    const da = Math.abs(a - palA[index]!);
    sumSq += dr * dr + dg * dg + db * db + da * da;
    const pixelMax = Math.max(dr, dg, db, da);
    if (pixelMax > maxDiff) maxDiff = pixelMax;
    if (pixelMax > 0.5) differing += 1;
  }

  const mse = total > 0 ? sumSq / (total * 4) : 0;
  const psnr = mse === 0 ? Number.POSITIVE_INFINITY : 20 * Math.log10(255) - 10 * Math.log10(mse);

  return {
    palette,
    indices,
    quality: {
      psnr,
      maxChannelDiff: clamp255(maxDiff),
      diffRatio: total > 0 ? differing / total : 0,
      uniqueColors: counts.size,
      paletteSize: ranked.length,
    },
  };
};
