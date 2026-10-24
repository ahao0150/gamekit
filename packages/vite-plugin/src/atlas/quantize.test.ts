import { describe, expect, it } from 'vitest';
import { decodePng, encodePng8 } from './png';
import {
  MAX_CHANNEL_DIFF, MAX_DIFF_RATIO, MIN_PSNR, isQualityOk, quantize,
} from './quantize';

/** 造一张 RGBA 图。`paint(x, y)` 返回颜色。 */
const makeImage = (
  width: number,
  height: number,
  paint: (x: number, y: number) => readonly [number, number, number, number],
): Uint8Array => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y);
      const at = (y * width + x) * 4;
      rgba[at] = r;
      rgba[at + 1] = g;
      rgba[at + 2] = b;
      rgba[at + 3] = a;
    }
  }
  return rgba;
};

describe('调色板量化（频率优先 + 就近映射）', () => {
  it('唯一色 ≤256 时零误差（调色板小图直接成表）', () => {
    // 16 色小方块：美术工具产出的图标常见形态
    const rgba = makeImage(64, 64, (x, y) => [(x % 4) * 60, (y % 4) * 60, 128, 255]);
    const q = quantize(rgba, 64, 64, 256);
    expect(q.quality.paletteSize).toBeLessThanOrEqual(16);
    expect(q.quality.uniqueColors).toBe(16);
    expect(q.quality.maxChannelDiff).toBe(0);
    expect(q.quality.diffRatio).toBe(0);
    expect(q.quality.psnr).toBe(Number.POSITIVE_INFINITY);
    expect(isQualityOk(q.quality)).toBe(true);
  });

  it('美术实际形态（少量色相 + 抗锯齿边缘）：质量判据通过', () => {
    // 模拟图标：6 个色相的主体 + 边缘 alpha 渐隐（按钮/图标的抗锯齿就是这样）
    const rgba = makeImage(128, 128, (x, y) => {
      const d = Math.hypot(x - 64, y - 64);
      const band = Math.floor((Math.atan2(y - 64, x - 64) + Math.PI) / (Math.PI / 3)) % 6;
      const hue: readonly (readonly [number, number, number])[] = [
        [200, 60, 60], [60, 160, 80], [40, 90, 200], [220, 180, 50], [150, 60, 190], [40, 170, 180],
      ];
      const [r, g, b] = hue[band]!;
      const a = d < 40 ? 255 : d > 46 ? 0 : Math.round(255 * (46 - d) / 6);
      return [r, g, b, a];
    });
    const q = quantize(rgba, 128, 128, 256);
    expect(q.quality.uniqueColors).toBeGreaterThan(256);
    expect(q.quality.paletteSize).toBeLessThanOrEqual(256);
    expect(isQualityOk(q.quality)).toBe(true);
  });

  it('全色域平滑渐变：频率优先算法做不好 → 判据拦下并降级（正确行为）', () => {
    // 这种图每个颜色只出现 1 次，频率优先等于随机取 256 色 —— 质量必然差。
    // 判据必须把它拦下来（降级为无损），而不是硬压出 143 KB 的糊图。
    const rgba = makeImage(256, 256, (x, y) => [x, y, Math.floor((x + y) / 2), 255]);
    const q = quantize(rgba, 256, 256, 256);
    expect(q.quality.uniqueColors).toBeGreaterThan(256);
    expect(q.quality.paletteSize).toBeLessThanOrEqual(256);
    expect(q.quality.psnr).toBeLessThan(MIN_PSNR);
    expect(isQualityOk(q.quality)).toBe(false);
  });

  it('半透明抗锯齿边缘：alpha 误差受控（不被量化成硬切）', () => {
    // 圆形边缘：alpha 连续变化，RGB 只有两种颜色 —— 这是按钮/图标抗锯齿的典型形态
    const rgba = makeImage(128, 128, (x, y) => {
      const d = Math.hypot(x - 64, y - 64);
      const a = d < 40 ? 255 : d > 44 ? 0 : Math.round(255 * (44 - d) / 4);
      return [30, 60, 90, a];
    });
    const q = quantize(rgba, 128, 128, 256);
    expect(q.quality.paletteSize).toBeLessThanOrEqual(256);
    // 关键：边缘的 alpha 不能被量化成 0/255 硬切 —— 最大色差与占比都要守住
    expect(q.quality.maxChannelDiff).toBeLessThanOrEqual(MAX_CHANNEL_DIFF);
    expect(q.quality.diffRatio).toBeLessThan(MAX_DIFF_RATIO);
  });

  it('关键色零误差：高频色必须原样进调色板（朱砂红 / 深墨 / 纸白）', () => {
    // 这三种色在游戏里是「语义色」：闪红的 #c2543f、深墨 #1B211F、纸白 #edf4ee。
    // 只要它们在图上高频出现，频率法就一定把它们精确放进调色板 —— 这条要守住。
    const keys: readonly (readonly [number, number, number, number])[] = [
      [0xc2, 0x54, 0x3f, 255], // #c2543f 朱砂红
      [0x1b, 0x21, 0x1f, 255], // #1B211F 深墨
      [0xed, 0xf4, 0xee, 255], // #edf4ee 纸白
    ];
    // 大面积铺这三种色 + 少量杂色（模拟真实图集：平涂为主）
    const rgba = makeImage(96, 96, (x, y) => {
      if (x < 32) return keys[0]!;
      if (x < 64) return keys[1]!;
      if (x < 90) return keys[2]!;
      return [(x * 3 + y) % 256, (y * 5) % 256, (x ^ y) % 256, 255];
    });
    const q = quantize(rgba, 96, 96, 256);
    for (const key of keys) {
      const [r, g, b, a] = key;
      // 每个像素：量化后的下标对应的调色板色必须与原文逐通道相等
      let pixels = 0;
      let exact = 0;
      for (let i = 0; i < 96 * 96; i += 1) {
        const at = i * 4;
        if (rgba[at] !== r || rgba[at + 1] !== g || rgba[at + 2] !== b || rgba[at + 3] !== a) continue;
        pixels += 1;
        const idx = q.indices[i]!;
        if (q.palette[idx * 4] === r && q.palette[idx * 4 + 1] === g
          && q.palette[idx * 4 + 2] === b && q.palette[idx * 4 + 3] === a) exact += 1;
      }
      expect(pixels).toBeGreaterThan(0);
      expect(exact).toBe(pixels);
    }
  });

  it('彩色噪点（量化做不到好的近似）会被判为不达标 → 调用方应降级', () => {
    let seed = 12345;
    // 取高位：低位线性同余的分布不够散，%256 只有不到百种颜色，测不出噪点场景
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed >>> 14) & 0xff;
    };
    const rgba = makeImage(96, 96, () => [next(), next(), next(), 255]);
    const q = quantize(rgba, 96, 96, 256);
    expect(q.quality.uniqueColors).toBeGreaterThan(256);
    expect(q.quality.paletteSize).toBeLessThanOrEqual(256);
    expect(isQualityOk(q.quality)).toBe(false);
  });

  it('空图 / 单色图不崩', () => {
    const single = makeImage(4, 4, () => [255, 255, 255, 255]);
    const q = quantize(single, 4, 4, 256);
    expect(q.quality.uniqueColors).toBe(1);
    expect(q.palette.length).toBe(4);
    expect(Array.from(q.indices)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('PNG8 编码', () => {
  it('索引色 PNG 能被自己的解码器读回，像素与调色板一致（含 tRNS 透明）', () => {
    const width = 4;
    const height = 2;
    const rgba = makeImage(width, height, (x, y) => (x === 0 && y === 0 ? [255, 0, 0, 128] : [10, 20, 30, 255]));
    const q = quantize(rgba, width, height, 256);
    const png = encodePng8(width, height, q.palette, q.indices);
    const decoded = decodePng(png);
    expect(decoded).not.toBeNull();
    expect(decoded!.width).toBe(width);
    expect(decoded!.height).toBe(height);
    // 量化是「索引色 → 调色板」，解回来应与量化结果一致（无损情况下等于原图）
    expect([...decoded!.rgba]).toEqual([...rgba]);
  });
});
