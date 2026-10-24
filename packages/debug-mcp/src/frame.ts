/**
 * WebSocket 帧编解码（RFC 6455 子集）。
 *
 * 拆成独立文件的两个原因：
 * 1. 帧格式是纯字节处理，可以完全单测（不需要真 socket）；
 * 2. `ws-server.ts` 要留出空间做连接管理与**分片重组**，否则超 300 行。
 *
 * 支持的子集：文本帧、续帧（opcode 0）、ping/pong/close；
 * 不支持扩展协商、压缩、Rsv 位。
 *
 * **分片必读**：浏览器发大消息（实测 >131KB，如 tree() 的 JSON）时会把一条消息
 * 拆成 `opcode=1, FIN=0` + 若干 `opcode=0, FIN=0` + 最后一个 `FIN=1`。
 * 只按「一帧一条消息」处理会永远等不到完整消息 —— 这是第一版踩过的坑。
 */

export const OP_CONT = 0x0;
export const OP_TEXT = 0x1;
export const OP_CLOSE = 0x8;
export const OP_PING = 0x9;
export const OP_PONG = 0xa;

/** 一帧解析结果。 */
export interface Frame {
  /** 是否为消息的最后一帧（FIN 位） */
  readonly fin: boolean;
  readonly opcode: number;
  readonly payload: Buffer;
}

/** 把一段字节编成一个完整的帧（服务端帧不加 mask）。 */
export function encodeFrame(firstByte: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([firstByte, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = firstByte;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = firstByte;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** 文本帧（opcode 0x1 + FIN）。 */
export function encodeTextFrame(text: string): Buffer {
  return encodeFrame(0x81, Buffer.from(text, 'utf8'));
}

/**
 * 从缓冲区里尽量多地解出帧，返回解出的帧与剩下的字节。
 *
 * 不完整时把残留返回，调用方追加新数据后再试一次。
 */
export function decodeFrames(buffer: Buffer): { frames: Frame[]; rest: Buffer } {
  const frames: Frame[] = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b0 = buffer.readUInt8(offset);
    const b1 = buffer.readUInt8(offset + 1);
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let cursor = offset + 2;
    if (len === 126) {
      if (cursor + 2 > buffer.length) break;
      len = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (len === 127) {
      if (cursor + 8 > buffer.length) break;
      const big = buffer.readBigUInt64BE(cursor);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('帧太大：超过 JS 安全整数');
      len = Number(big);
      cursor += 8;
    }
    const maskAt = cursor;
    if (masked) cursor += 4;
    if (cursor + len > buffer.length) break;
    let payload = buffer.subarray(cursor, cursor + len);
    if (masked) {
      const mask = buffer.subarray(maskAt, maskAt + 4);
      const copy = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i += 1) {
        copy[i] = (payload.readUInt8(i) ^ (mask.readUInt8(i % 4) ?? 0)) & 0xff;
      }
      payload = copy;
    }
    frames.push({ fin, opcode, payload });
    offset = cursor + len;
  }
  return { frames, rest: buffer.subarray(offset) };
}
