/**
 * 纯 JS 的 PNG 编解码（只依赖 Node 内置 zlib）。
 *
 * 为什么不装 pngjs / sharp：这是构建工具，多一个原生依赖就多一类
 * 「在别人机器上装不上」的故障（sharp 还要预编译二进制）。图集只需要
 * 「读 RGBA → 拼页 → 写 RGBA」，PNG 的这部分子集自己实现完全够用。
 *
 * 支持范围（超出就返回 null，调用方把该图退回单图直连）：
 * - 位深 8、非隔行；
 * - 颜色类型 0（灰度）/ 2（RGB）/ 3（调色板）/ 4（灰度+alpha）/ 6（RGBA）。
 *
 * 编码统一输出颜色类型 6（RGBA），并按行自适应选滤波器（None/Sub/Up/Paeth），
 * 体积明显优于全用 None。
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { SIGNATURE, chunk } from './png-chunks';

/** 解码结果：RGBA8888，行优先。 */
export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

const u32 = (data: Uint8Array, at: number): number =>
  ((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0;

const readType = (data: Uint8Array, at: number): string =>
  String.fromCharCode(data[at]!, data[at + 1]!, data[at + 2]!, data[at + 3]!);

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

/**
 * 解码 PNG。不支持的形态返回 null（不抛错）：美术给的图可能是 16 位或隔行的，
 * 那就让它走单图直连，而不是让整个构建失败。
 */
export const decodePng = (data: Uint8Array): DecodedPng | null => {
  if (data.length < 8) return null;
  for (let i = 0; i < 8; i += 1) if (data[i] !== SIGNATURE[i]) return null;

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  let pos = 8;
  while (pos + 8 <= data.length) {
    const length = u32(data, pos);
    const bodyStart = pos + 8;
    const bodyEnd = bodyStart + length;
    if (bodyEnd + 4 > data.length) return null;
    const type = readType(data, pos + 4);
    const body = data.subarray(bodyStart, bodyEnd);
    if (type === 'IHDR') {
      width = u32(body, 0);
      height = u32(body, 4);
      bitDepth = body[8] ?? 0;
      colorType = body[9] ?? -1;
      interlace = body[12] ?? 0;
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos = bodyEnd + 4;
  }

  if (width <= 0 || height <= 0 || bitDepth !== 8 || interlace !== 0) return null;
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : colorType === 3 ? 1 : -1;
  if (channels < 0 || idat.length === 0) return null;
  if (colorType === 3 && palette === null) return null;

  let raw: Uint8Array;
  try {
    raw = new Uint8Array(inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk)))));
  } catch {
    return null;
  }

  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const lineStart = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i += 1) {
      const rawByte = raw[lineStart + i] ?? 0;
      const a = i >= channels ? cur[i - channels]! : 0;
      const b = prev[i]!;
      const c = i >= channels ? prev[i - channels]! : 0;
      let value: number;
      switch (filter) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + a; break;
        case 2: value = rawByte + b; break;
        case 3: value = rawByte + ((a + b) >> 1); break;
        case 4: value = rawByte + paeth(a, b, c); break;
        default: return null;
      }
      cur[i] = value & 0xff;
    }
    // 展开成 RGBA
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (colorType === 6) {
        out[o] = cur[x * 4]!;
        out[o + 1] = cur[x * 4 + 1]!;
        out[o + 2] = cur[x * 4 + 2]!;
        out[o + 3] = cur[x * 4 + 3]!;
      } else if (colorType === 2) {
        out[o] = cur[x * 3]!;
        out[o + 1] = cur[x * 3 + 1]!;
        out[o + 2] = cur[x * 3 + 2]!;
        out[o + 3] = 255;
      } else if (colorType === 3) {
        const index = cur[x]!;
        out[o] = palette![index * 3] ?? 0;
        out[o + 1] = palette![index * 3 + 1] ?? 0;
        out[o + 2] = palette![index * 3 + 2] ?? 0;
        out[o + 3] = trns !== null && trns[index] !== undefined ? trns[index]! : 255;
      } else if (colorType === 4) {
        const g = cur[x * 2]!;
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
        out[o + 3] = cur[x * 2 + 1]!;
      } else {
        const g = cur[x]!;
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
        out[o + 3] = 255;
      }
    }
    prev.set(cur);
  }
  return { width, height, rgba: out };
};

/** 把一行按滤波器 f 编码到 dst（dst 第一字节是滤波器类型）。 */
const filterRow = (
  type: number, cur: Uint8Array, prev: Uint8Array, stride: number, channels: number, dst: Uint8Array,
): void => {
  dst[0] = type;
  for (let i = 0; i < stride; i += 1) {
    const x = cur[i]!;
    const a = i >= channels ? cur[i - channels]! : 0;
    const b = prev[i]!;
    const c = i >= channels ? prev[i - channels]! : 0;
    let v: number;
    switch (type) {
      case 0: v = x; break;
      case 1: v = x - a; break;
      case 2: v = x - b; break;
      default: v = x - paeth(a, b, c); break;
    }
    dst[i + 1] = v & 0xff;
  }
};

const score = (row: Uint8Array): number => {
  let total = 0;
  for (let i = 1; i < row.length; i += 1) {
    const v = row[i]!;
    total += v < 128 ? v : 256 - v;
  }
  return total;
};

/** 编码 RGBA8888 → PNG（颜色类型 6，自适应滤波）。 */
export const encodePng = (width: number, height: number, rgba: Uint8Array): Uint8Array => {
  const channels = 4;
  const stride = width * channels;
  const rows = new Uint8Array((stride + 1) * height);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  const candidates = [0, 1, 2, 4].map((type) => new Uint8Array(stride + 1));

  for (let y = 0; y < height; y += 1) {
    cur.set(rgba.subarray(y * stride, (y + 1) * stride));
    let best = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const type of [0, 1, 2, 4]) {
      const target = candidates[[0, 1, 2, 4].indexOf(type)]!;
      filterRow(type, cur, prev, stride, channels, target);
      const value = score(target);
      if (value < bestScore) {
        bestScore = value;
        best = type;
      }
    }
    const chosen = candidates[[0, 1, 2, 4].indexOf(best)]!;
    rows.set(chosen, y * (stride + 1));
    prev.set(cur);
  }

  const ihdr = new Uint8Array(13);
  ihdr[0] = (width >>> 24) & 0xff;
  ihdr[1] = (width >>> 16) & 0xff;
  ihdr[2] = (width >>> 8) & 0xff;
  ihdr[3] = width & 0xff;
  ihdr[4] = (height >>> 24) & 0xff;
  ihdr[5] = (height >>> 16) & 0xff;
  ihdr[6] = (height >>> 8) & 0xff;
  ihdr[7] = height & 0xff;
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 颜色类型 RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = new Uint8Array(deflateSync(Buffer.from(rows), { level: 9 }));
  const signature = new Uint8Array(SIGNATURE);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from(signature),
      Buffer.from(chunk('IHDR', ihdr)),
      Buffer.from(chunk('IDAT', idat)),
      Buffer.from(chunk('IEND', new Uint8Array(0))),
    ]),
  );
};
export { encodePng8 } from './png8';
