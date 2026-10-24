/**
 * WebSocket 帧编解码测试。
 *
 * 这里测的是**协议字节级**行为：服务端发出的帧客户端能解、客户端遮罩帧服务端能解、
 * 粘包与半包不会丢数据。真实连接走的是同一套函数，所以这层绿了才有意义。
 */

import { describe, expect, it } from 'vitest';
import { decodeFrames, encodeTextFrame } from './frame';

/** 造一个客户端帧（规范要求客户端必须 mask）。 */
const clientFrame = (text: string): Buffer => {
  const payload = Buffer.from(text, 'utf8');
  const mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    masked[i] = (payload.readUInt8(i) ^ (mask.readUInt8(i % 4) ?? 0)) & 0xff;
  }
  const len = payload.length;
  const header = len < 126 ? Buffer.from([0x81, 0x80 | len]) : Buffer.from([0x81, 0x80 | 126, 0, 0]);
  if (len >= 126) header.writeUInt16BE(len, 2);
  return Buffer.concat([header, mask, masked]);
};

describe('WebSocket 帧编解码', () => {
  it('服务端文本帧可以被解回原文（无遮罩）', () => {
    const frame = encodeTextFrame('{"hello":1}');
    const { frames, rest } = decodeFrames(frame);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.opcode).toBe(0x1);
    expect(frames[0]?.payload.toString('utf8')).toBe('{"hello":1}');
    expect(rest.length).toBe(0);
  });

  it('中文与长帧（>125 字节走 16 位长度）', () => {
    const text = `画布信息：${'帧'.repeat(80)}`;
    expect(Buffer.byteLength(text, 'utf8')).toBeGreaterThan(125);
    const frame = encodeTextFrame(text);
    const { frames } = decodeFrames(frame);
    expect(frames[0]?.payload.toString('utf8')).toBe(text);
  });

  it('客户端遮罩帧可以解出原文', () => {
    const frame = clientFrame('{"id":1,"method":"canvas"}');
    const { frames } = decodeFrames(frame);
    expect(frames[0]?.payload.toString('utf8')).toBe('{"id":1,"method":"canvas"}');
  });

  it('粘包：两帧拼在一起一次解出两个', () => {
    const buf = Buffer.concat([clientFrame('a'), clientFrame('b')]);
    const { frames, rest } = decodeFrames(buf);
    expect(frames.map((f) => f.payload.toString('utf8'))).toEqual(['a', 'b']);
    expect(rest.length).toBe(0);
  });

  it('半包：不完整的帧留在 rest 里，不会误解析', () => {
    const full = clientFrame('{"id":9,"method":"state"}');
    const half = full.subarray(0, 5);
    const first = decodeFrames(half);
    expect(first.frames).toHaveLength(0);
    expect(first.rest.length).toBe(5);
    // 补齐后能解出来
    const second = decodeFrames(Buffer.concat([first.rest, full.subarray(5)]));
    expect(second.frames).toHaveLength(1);
  });
});
