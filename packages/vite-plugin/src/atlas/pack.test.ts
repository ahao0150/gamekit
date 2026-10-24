import { describe, expect, it } from 'vitest';
import { pack } from './pack';
import { decodePng, encodePng } from './png';
import type { PackInput, PackOptions } from './types';

const OPTS: PackOptions = { maxTextureSize: 128, padding: 2, maxFrameSize: 512 };

/** 造一张纯色图（合成图，不用真素材）。 */
const makeImage = (key: string, width: number, height: number, color: readonly [number, number, number, number]): PackInput => {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = color[3];
  }
  return { key, width, height, rgba };
};

const pixelAt = (rgba: Uint8Array, width: number, x: number, y: number): number[] => {
  const at = (y * width + x) * 4;
  return [rgba[at]!, rgba[at + 1]!, rgba[at + 2]!, rgba[at + 3]!];
};

const RED: readonly [number, number, number, number] = [255, 0, 0, 255];
const BLUE: readonly [number, number, number, number] = [0, 0, 255, 255];

describe('PNG 编解码（自实现，无第三方依赖）', () => {
  it('编码 → 解码回来像素完全一致（含多行、非 2 幂尺寸）', () => {
    const width = 5;
    const height = 3;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      rgba[i * 4] = (i * 7) % 256;
      rgba[i * 4 + 1] = (i * 13) % 256;
      rgba[i * 4 + 2] = (i * 29) % 256;
      rgba[i * 4 + 3] = i % 2 === 0 ? 255 : 128;
    }
    const png = encodePng(width, height, rgba);
    const decoded = decodePng(png);
    expect(decoded).not.toBeNull();
    expect(decoded!.width).toBe(width);
    expect(decoded!.height).toBe(height);
    expect([...decoded!.rgba]).toEqual([...rgba]);
  });

  it('不是 PNG 的数据返回 null（不抛错）', () => {
    expect(decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });
});

describe('pack：切图、间距、分页、排除', () => {
  it('单页：帧矩形写进清单，页上对应位置就是那张图的像素', () => {
    const build = pack([makeImage('icons/red', 4, 4, RED), makeImage('icons/blue', 8, 8, BLUE)], OPTS);
    expect(build.pages.length).toBe(1);
    expect(build.excluded).toEqual([]);

    const page = build.pages[0]!;
    expect(page.name).toBe('atlas-0.png');
    const decoded = decodePng(page.png)!;
    expect(decoded.width).toBe(page.width);
    expect(decoded.height).toBe(page.height);

    const blueFrame = build.atlas.frames['icons/blue']!;
    const redFrame = build.atlas.frames['icons/red']!;
    expect(blueFrame).toMatchObject({ atlas: 'atlas-0.png', w: 8, h: 8 });
    expect(redFrame).toMatchObject({ atlas: 'atlas-0.png', w: 4, h: 4 });
    // 帧矩形就是页上的真实位置：解出来的像素必须是那张图的颜色
    expect(pixelAt(decoded.rgba, decoded.width, blueFrame.x, blueFrame.y)).toEqual([...BLUE]);
    expect(pixelAt(decoded.rgba, decoded.width, redFrame.x, redFrame.y)).toEqual([...RED]);
    // 帧内最后一个像素也在（防止宽高算错）
    expect(pixelAt(decoded.rgba, decoded.width, redFrame.x + 3, redFrame.y + 3)).toEqual([...RED]);
  });

  it('padding 生效：两帧之间是透明像素（不会串色）', () => {
    const build = pack([makeImage('a', 4, 4, RED), makeImage('b', 8, 8, BLUE)], { ...OPTS, padding: 3 });
    const page = build.pages[0]!;
    const decoded = decodePng(page.png)!;
    const a = build.atlas.frames['a']!;
    const b = build.atlas.frames['b']!;
    // 找出左右相邻的那一对，检查中间的空隙是透明的
    const left = a.x < b.x ? a : b;
    const right = a.x < b.x ? b : a;
    const gap = right.x - (left.x + left.w);
    expect(gap).toBeGreaterThanOrEqual(3);
    for (let x = left.x + left.w; x < right.x; x += 1) {
      expect(pixelAt(decoded.rgba, decoded.width, x, left.y)[3]).toBe(0);
    }
  });

  it('超过 maxTextureSize 自动开新页，清单指向对应页', () => {
    const build = pack(
      [makeImage('a', 40, 40, RED), makeImage('b', 40, 40, BLUE), makeImage('c', 40, 40, RED)],
      { maxTextureSize: 64, padding: 2, maxFrameSize: 512 },
    );
    expect(build.pages.map((page) => page.name)).toEqual(['atlas-0.png', 'atlas-1.png', 'atlas-2.png']);
    expect(build.atlas.frames['a']!.atlas).toBe('atlas-0.png');
    expect(build.atlas.frames['b']!.atlas).toBe('atlas-1.png');
    expect(build.atlas.frames['c']!.atlas).toBe('atlas-2.png');
    expect(Object.keys(build.atlas.atlases).sort()).toEqual(['atlas-0.png', 'atlas-1.png', 'atlas-2.png']);
    for (const page of build.pages) {
      expect(build.atlas.atlases[page.name]).toEqual({ w: page.width, h: page.height });
    }
  });

  it('单边超过 maxFrameSize 的图不进图集（退回单图直连并报原因）', () => {
    const build = pack(
      [makeImage('bg/big', 600, 400, RED), makeImage('icon/small', 16, 16, BLUE)],
      { ...OPTS, maxFrameSize: 512 },
    );
    expect(build.excluded).toEqual([{ key: 'bg/big', reason: 'too-large' }]);
    expect(build.atlas.frames['bg/big']).toBeUndefined();
    expect(build.atlas.frames['icon/small']).toBeDefined();
  });

  it('空输入：零页、空清单', () => {
    const build = pack([], OPTS);
    expect(build.pages).toEqual([]);
    expect(build.atlas).toEqual({ version: 1, atlases: {}, frames: {} });
    expect(build.excluded).toEqual([]);
  });

  it('清单里每帧的矩形都在页内（防越界）', () => {
    const build = pack(
      [
        makeImage('a', 30, 20, RED), makeImage('b', 50, 40, BLUE),
        makeImage('c', 20, 60, RED), makeImage('d', 60, 10, BLUE),
      ],
      OPTS,
    );
    for (const frame of Object.values(build.atlas.frames)) {
      const size = build.atlas.atlases[frame.atlas]!;
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.w).toBeLessThanOrEqual(size.w);
      expect(frame.y + frame.h).toBeLessThanOrEqual(size.h);
    }
  });
});
