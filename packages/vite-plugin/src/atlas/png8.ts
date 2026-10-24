/**
 * PNG8（索引色）编码：调色板 + 下标 → PNG。
 *
 * 索引图不做行滤波：下标在空间上不连续（相邻像素的调色板下标互不相关），
 * 滤波只会让 zlib 更难压。这也让体积可预测。
 *
 * 调色板里有透明项时写 tRNS（每项一字节 alpha）—— 抗锯齿边缘靠它保住。
 */

import { deflateSync } from 'node:zlib';
import { SIGNATURE, chunk } from './png-chunks';

export const encodePng8 = (
  width: number,
  height: number,
  palette: Uint8Array,
  indices: Uint8Array,
): Uint8Array => {
  const count = Math.max(1, palette.length >> 2);
  const plte = new Uint8Array(count * 3);
  const trns = new Uint8Array(count);
  let hasAlpha = false;
  for (let i = 0; i < count; i += 1) {
    plte[i * 3] = palette[i * 4]!;
    plte[i * 3 + 1] = palette[i * 4 + 1]!;
    plte[i * 3 + 2] = palette[i * 4 + 2]!;
    trns[i] = palette[i * 4 + 3]!;
    if (trns[i] !== 255) hasAlpha = true;
  }

  const rows = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width + 1)] = 0;
    rows.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
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
  ihdr[9] = 3; // 颜色类型：索引色
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = new Uint8Array(deflateSync(Buffer.from(rows), { level: 9 }));
  const parts: Uint8Array[] = [
    new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), chunk('PLTE', plte),
  ];
  if (hasAlpha) parts.push(chunk('tRNS', trns));
  parts.push(chunk('IDAT', idat), chunk('IEND', new Uint8Array(0)));
  return new Uint8Array(Buffer.concat(parts.map((part) => Buffer.from(part))));
};
