/**
 * `watch`：轮询表达式，值变化时推 MCP 通知（`notifications/message`）。
 *
 * 为什么是轮询而不是游戏侧推送：调试 bridge 的契约是「请求 → 回包」，
 * 游戏侧没有主动推通道；为一个 watch 去改 bridge 契约（冻结）不划算。
 * 轮询间隔默认 800ms，只读 `state` / `layout` / `frame` 三处，开销很小。
 *
 * 表达式：
 * - `state.phase` / `state`（游戏注册了 state 快照才能用）
 * - `layout.primary` / `layout.primary.x`（矩形或单个分量）
 * - `frame.count` / `frame.frame` / `frame.ms`
 *
 * 同一表达式重复 watch 会覆盖（只保留一个定时器），避免 AI 反复调用攒一堆。
 */

import { normalizeLayout } from './snapshot';
import type { DebugClient } from './ws-server';

export interface WatchEvent {
  readonly expr: string;
  readonly at: string;
  readonly from: unknown;
  readonly to: unknown;
}

export interface WatchRegistry {
  /** 开始监听（已存在则更新基线），返回注册时的当前值。 */
  start(expr: string): Promise<{ expr: string; value: unknown; intervalMs: number }>;
  /** 停掉指定表达式；不传则停全部。返回被停掉的表达式。 */
  stop(expr?: string): string[];
  list(): { expr: string; value: unknown }[];
  stopAll(): void;
}

export interface WatchOptions {
  readonly client: () => DebugClient | null;
  readonly notify: (event: WatchEvent) => void;
  /** 轮询间隔（ms），默认 800 */
  readonly intervalMs?: number;
}

const DEFAULT_INTERVAL = 800;
const READABLE = /^(state|layout|frame)(\.[A-Za-z0-9_[\]-]+)*$/;

interface Entry {
  timer: ReturnType<typeof setInterval>;
  last: unknown;
  inFlight: boolean;
}

const drill = (value: unknown, path: readonly string[]): unknown => {
  let cursor: unknown = value;
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** 读一次表达式（只拉需要的数据源）。 */
const readValue = async (client: DebugClient, expr: string): Promise<unknown> => {
  const [head, ...rest] = expr.split('.');
  if (head === 'state') {
    const snapshot = (await client.request('state')) as { ok?: boolean; state?: unknown; error?: string };
    if (snapshot.ok !== true) throw new Error(snapshot.error ?? '游戏没有注册 state 快照');
    return rest.length === 0 ? snapshot.state : drill(snapshot.state, rest);
  }
  if (head === 'layout') {
    const tree = (await client.request('tree')) as { layout?: unknown };
    const layout = normalizeLayout(tree.layout);
    if (rest.length === 0) return layout;
    const byPath = layout[rest.join('.')];
    return byPath !== undefined ? byPath : drill(layout, rest);
  }
  if (head === 'frame') {
    // limit: 2 —— 最后一条可能是「正在写入的半帧」，取倒数第二条（最近完整帧）
    const tree = (await client.request('tree', { limit: 2 })) as {
      latest?: { frame: number; at: number; ms: number; calls: readonly unknown[] } | null;
      frames?: readonly { frame: number; at: number; ms: number; calls: readonly unknown[] }[];
    };
    const frames = tree.frames ?? [];
    const latest =
      frames.length >= 2
        ? (frames[frames.length - 2] ?? null)
        : (tree.latest ?? frames[frames.length - 1] ?? null);
    const frame = latest === null ? null : { frame: latest.frame, at: latest.at, ms: latest.ms, count: latest.calls.length };
    return rest.length === 0 ? frame : drill(frame, rest);
  }
  throw new Error(`watch 表达式只支持 state.* / layout.* / frame.*，收到「${expr}」`);
};

export const createWatchRegistry = (options: WatchOptions): WatchRegistry => {
  const intervalMs = Math.max(100, Math.floor(options.intervalMs ?? DEFAULT_INTERVAL));
  const entries = new Map<string, Entry>();

  const tick = async (expr: string): Promise<void> => {
    const entry = entries.get(expr);
    const client = options.client();
    if (entry === undefined || client === null || entry.inFlight) return;
    entry.inFlight = true;
    try {
      const value = await readValue(client, expr);
      if (!same(value, entry.last)) {
        const from = entry.last;
        entry.last = value;
        options.notify({ expr, at: new Date().toISOString(), from, to: value });
      }
    } catch {
      // 连接中断 / state 暂不可用：本次跳过，下一个 tick 再试
    } finally {
      entry.inFlight = false;
    }
  };

  return {
    async start(expr: string): Promise<{ expr: string; value: unknown; intervalMs: number }> {
      if (!READABLE.test(expr)) throw new Error(`watch 表达式写法不对：「${expr}」。支持 state.phase / layout.primary.x / frame.count`);
      const client = options.client();
      if (client === null) throw new Error('游戏没连上调试服务端：先 mg dev 并打开页面，watch 需要实时数据');
      const value = await readValue(client, expr);
      const existing = entries.get(expr);
      if (existing !== undefined) {
        existing.last = value;
        return { expr, value, intervalMs };
      }
      const entry: Entry = { timer: setInterval(() => void tick(expr), intervalMs), last: value, inFlight: false };
      entries.set(expr, entry);
      return { expr, value, intervalMs };
    },
    stop(expr?: string): string[] {
      if (expr === undefined) {
        const all = [...entries.keys()];
        for (const key of all) this.stop(key);
        return all;
      }
      const entry = entries.get(expr);
      if (entry === undefined) return [];
      clearInterval(entry.timer);
      entries.delete(expr);
      return [expr];
    },
    list(): { expr: string; value: unknown }[] {
      return [...entries.entries()].map(([expr, entry]) => ({ expr, value: entry.last }));
    },
    stopAll(): void {
      this.stop();
    },
  };
};
