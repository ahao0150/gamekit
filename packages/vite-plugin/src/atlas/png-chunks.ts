/**
 * PNG 的公共块工具：文件签名、CRC32、chunk 封装。
 *
 * 单独一个文件是为了让「读 PNG」与「写 PNG8」两个模块共用，
 * 又不互相 import（两个方向互引会形成环）。
 */

/** PNG 文件签名。 */
export const SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (parts: readonly Uint8Array[]): number => {
  let c = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

/** 组装一个 PNG chunk：长度 + 类型 + 内容 + CRC。 */
export const chunk = (type: string, body: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + body.length);
  out[0] = (body.length >>> 24) & 0xff;
  out[1] = (body.length >>> 16) & 0xff;
  out[2] = (body.length >>> 8) & 0xff;
  out[3] = body.length & 0xff;
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  const crc = crc32([out.subarray(4, 8), body]);
  out[8 + body.length] = (crc >>> 24) & 0xff;
  out[9 + body.length] = (crc >>> 16) & 0xff;
  out[10 + body.length] = (crc >>> 8) & 0xff;
  out[11 + body.length] = crc & 0xff;
  return out;
};
