/**
 * 一条连上来的游戏连接（T24 从 `ws-server.ts` 拆出来）。
 *
 * 职责：帧收发 + 分片重组 + 「命令 → 回包」关联 + 断开清理。
 * **不负责多客户端管理**（集合在 `ws-server.ts`），这里只关心自己这一条连接。
 *
 * id 是稳定字符串 `c1` / `c2`…（进程内自增，断开也不复用）：AI 要能用
 * `client: 'c2'` 精确指定目标，复用 id 会让「打给 c1」变成打给新连上的人。
 */

import type { Socket } from 'node:net';
import { decodeFrames, encodeFrame, OP_CLOSE, OP_CONT, OP_PING, OP_PONG, OP_TEXT } from './frame';
import type { Frame } from './frame';
import type { CommandMessage, HelloMessage, ResultMessage } from './contract';

/** 诊断开关：`MG_DEBUG_WS=1` 时把帧收发打到 stderr（协议调试用，默认关）。 */
const VERBOSE = process.env['MG_DEBUG_WS'] === '1';
const trace = (line: string): void => {
  if (VERBOSE) process.stderr.write(`[ws] ${line}\n`);
};

/** 一个连上来的游戏实例。 */
export interface DebugClient {
  /** 稳定连接 id：`c1` / `c2`…（断开后不复用） */
  readonly id: string;
  /** 连上时间（ms 时间戳） */
  readonly connectedAt: number;
  /** 游戏上报的环境信息；还没收到 hello 时为 null。 */
  readonly hello: HelloMessage['hello'] | null;
  readonly connected: boolean;
  /** 发一条命令并等回包；超时抛中文错误。 */
  request(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  close(): void;
}

/** 单个连接：帧收发 + 分片重组 + 请求/响应关联。 */
export class ClientConnection implements DebugClient {
  readonly id: string;
  readonly connectedAt: number;
  hello: HelloMessage['hello'] | null = null;
  connected = true;
  private readonly socket: Socket;
  private buffer: Buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  /** 分片重组状态：一条消息可能由 opcode=TEXT + 若干 opcode=CONT 组成。 */
  private fragmentOpcode = -1;
  private readonly fragments: Buffer[] = [];
  private readonly onHello: (client: ClientConnection) => void;
  private readonly onGone: (client: ClientConnection) => void;

  constructor(
    socket: Socket,
    id: string,
    onHello: (client: ClientConnection) => void,
    onGone: (client: ClientConnection) => void,
    connectedAt = Date.now(),
  ) {
    this.socket = socket;
    this.id = id;
    this.connectedAt = connectedAt;
    this.onHello = onHello;
    this.onGone = onGone;
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    // 'end' 必须处理：HTTP upgrade 之后的 socket **不会**因为对端 FIN 自动 'close'，
    // 只监听 'close' 会让「页面刷新 / 正常关闭」的连接一直留在多客户端集合里
    // （T24 实测：客户端 end() 后 500ms 仍在集合中）。'close' 兜住 RST / 强杀。
    socket.on('end', () => this.teardown('对端关闭连接'));
    socket.on('close', () => this.teardown('连接已断开'));
    socket.on('error', () => this.teardown('连接出错'));
  }

  private onData(chunk: Buffer): void {
    trace(`收到 ${chunk.length}B（累计 ${this.buffer.length + chunk.length}B）`);
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let decoded: { frames: Frame[]; rest: Buffer };
    try {
      decoded = decodeFrames(this.buffer);
    } catch (error) {
      this.teardown(error instanceof Error ? error.message : String(error));
      return;
    }
    this.buffer = decoded.rest;
    for (const frame of decoded.frames) this.onFrame(frame);
  }

  private onFrame(frame: Frame): void {
    if (frame.opcode === OP_PING) {
      this.writeFrame(OP_PONG | 0x80, Buffer.alloc(0));
      return;
    }
    if (frame.opcode === OP_CLOSE) {
      this.teardown('客户端关闭连接');
      return;
    }
    // 续帧：拼到当前消息上；没有起始帧的孤立续帧直接丢
    if (frame.opcode === OP_CONT) {
      if (this.fragmentOpcode < 0) return;
      this.fragments.push(frame.payload);
      if (frame.fin) this.completeMessage();
      return;
    }
    if (!frame.fin) {
      this.fragmentOpcode = frame.opcode;
      this.fragments.length = 0;
      this.fragments.push(frame.payload);
      return;
    }
    this.handleMessage(frame.opcode, frame.payload);
  }

  /** 分片收齐：拼回整条消息。 */
  private completeMessage(): void {
    const opcode = this.fragmentOpcode;
    const payload = Buffer.concat(this.fragments);
    this.fragmentOpcode = -1;
    this.fragments.length = 0;
    trace(`分片重组完成：opcode=${opcode} ${payload.length}B`);
    this.handleMessage(opcode, payload);
  }

  private handleMessage(opcode: number, payload: Buffer): void {
    if (opcode !== OP_TEXT) return;
    let message: HelloMessage | ResultMessage;
    try {
      message = JSON.parse(payload.toString('utf8')) as HelloMessage | ResultMessage;
    } catch {
      trace('收到不是 JSON 的文本帧，忽略');
      return;
    }
    if ('type' in message && message.type === 'hello') {
      this.hello = message.hello;
      // 服务端分配的稳定 id 回给游戏侧（游戏侧不用也不影响，hello 已生效）
      this.sendText(JSON.stringify({ type: 'assigned', clientId: this.id }));
      this.onHello(this);
      return;
    }
    if ('id' in message && typeof message.id === 'number') {
      const waiter = this.pending.get(message.id);
      if (waiter === undefined) return;
      clearTimeout(waiter.timer);
      this.pending.delete(message.id);
      if (message.ok) waiter.resolve(message.result);
      else waiter.reject(new Error(message.error ?? '游戏侧执行失败（没有给原因）'));
    }
  }

  private writeFrame(firstByte: number, payload: Buffer): void {
    if (this.socket.destroyed) return;
    this.socket.write(encodeFrame(firstByte, payload));
  }

  sendText(text: string): void {
    trace(`发送 ${text.length} 字符`);
    this.writeFrame(OP_TEXT | 0x80, Buffer.from(text, 'utf8'));
  }

  request(method: string, params?: Record<string, unknown>, timeoutMs = 5000): Promise<unknown> {
    if (!this.connected) return Promise.reject(new Error(`游戏客户端 ${this.id} 已断开连接`));
    const id = this.nextId;
    this.nextId += 1;
    const message: CommandMessage = params === undefined ? { id, method } : { id, method, params };
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`等待游戏响应超时（${timeoutMs}ms，客户端 ${this.id}）：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.sendText(JSON.stringify(message));
    });
  }

  close(): void {
    this.teardown('主动关闭');
  }

  private teardown(reason: string): void {
    if (!this.connected) return;
    this.connected = false;
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`连接断开（客户端 ${this.id}：${reason}）`));
    }
    this.pending.clear();
    if (!this.socket.destroyed) {
      this.writeFrame(OP_CLOSE | 0x80, Buffer.alloc(0));
      this.socket.destroy();
    }
    this.onGone(this);
  }
}
