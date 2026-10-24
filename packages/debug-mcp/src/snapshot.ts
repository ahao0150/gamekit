/**
 * MCP 快照：把「布局树 + 绘制记录 + canvas 信息」存成**跨会话可读**的 JSON。
 *
 * 为什么落盘而不是只在内存：回归对比要拿「昨天/另一个进程存的基线」做 diff。
 * 文件放在 `out/mcp-snapshots/<name>.json`，格式带 `version`，字段只增不改。
 *
 * 布局树来自游戏侧 `attach({ layout })`，形状因游戏而异（kuaidi 是 Rect 字段 +
 * cards 数组，ui-demo 是扁平 Rect）。这里做**归一化**：递归成 `path → Rect`，
 * 数组元素用 `cards[0]` 这种路径。非矩形字段（如 cell 数字）直接跳过。
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Rect } from '../../runtime/src/core/ui/contract';
import type { DebugClient } from './ws-server';

export const SNAPSHOT_VERSION = 1;
/** 快照名只允许字母数字与 `._-`：它直接当文件名，必须挡住 `../`。 */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const assertSnapshotName = (name: string): string => {
  if (!NAME_RE.test(name)) {
    throw new Error(`快照名只允许字母、数字、点、下划线、连字符（1-64 字符），收到「${name}」`);
  }
  return name;
};

/** 游戏侧 `tree()` 返回的绘制调用（只保留快照需要的字段）。 */
export interface SnapshotDraw {
  readonly z: number;
  readonly kind: string;
  readonly rect?: Rect;
  readonly asset?: string;
  readonly text?: string;
  readonly color?: string;
}

export interface SnapshotFrame {
  readonly frame: number;
  readonly at: number;
  readonly ms: number;
  readonly count: number;
}

export interface SnapshotCanvas {
  readonly screen?: { readonly width: number; readonly height: number; readonly dpr: number };
  readonly fps?: number;
  readonly drawsPerFrame?: number;
  readonly frameMs?: number;
  readonly retained?: number;
  readonly recording?: boolean;
}

export interface McpSnapshot {
  readonly version: number;
  readonly name: string;
  /** ISO 时间戳（跨进程读时用来判断新旧） */
  readonly at: string;
  readonly game: { readonly platform: string; readonly screen: SnapshotCanvas['screen'] };
  readonly canvas: SnapshotCanvas;
  /** 归一化后的布局树：`path → Rect`（如 `primary` / `cards[0]` / `grid`） */
  readonly layout: Readonly<Record<string, Rect>>;
  readonly draws: readonly SnapshotDraw[];
  readonly frame: SnapshotFrame | null;
  readonly state: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const asRect = (value: unknown): Rect | null => {
  if (!isRecord(value)) return null;
  const x = finite(value['x']);
  const y = finite(value['y']);
  const w = finite(value['w']);
  const h = finite(value['h']);
  if (x === null || y === null || w === null || h === null) return null;
  return { x, y, w, h };
};

const round = (v: number): number => Math.round(v * 100) / 100;

/** 归一化布局树：递归收集所有 `{x,y,w,h}` 叶子；非矩形字段跳过。 */
export const normalizeLayout = (raw: unknown): Record<string, Rect> => {
  const out: Record<string, Rect> = {};
  const visit = (value: unknown, path: string): void => {
    const rect = asRect(value);
    if (rect !== null) {
      if (path.length > 0) out[path] = { x: round(rect.x), y: round(rect.y), w: round(rect.w), h: round(rect.h) };
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, path.length === 0 ? `[${index}]` : `${path}[${index}]`));
      return;
    }
    if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, path.length === 0 ? key : `${path}.${key}`);
    }
  };
  visit(raw, '');
  return out;
};

/** 游戏侧 `tree()` 的返回形状（与 runtime/debug 契约一致）。 */
interface TreeResult {
  readonly frames?: readonly {
    readonly frame: number;
    readonly at: number;
    readonly ms: number;
    readonly calls: readonly Record<string, unknown>[];
  }[];
  readonly latest?: {
    readonly frame: number;
    readonly at: number;
    readonly ms: number;
    readonly calls: readonly Record<string, unknown>[];
  } | null;
  readonly layout?: unknown;
}

interface FrameLike {
  readonly frame: number;
  readonly at: number;
  readonly ms: number;
  readonly calls: readonly Record<string, unknown>[];
}

/**
 * 取「最近一个**完整**帧」。
 *
 * `recorder.recent()` 会把**正在写入的当前帧**一起返回（最后一条），
 * 在帧中间抓快照会拿到半帧（实测：只有文字和按钮、丢了背景与面板），
 * 快照 diff / checkRender 会因此误报。倒数第二条是最近一个已 flush 的完整帧。
 */
const completeFrameOf = (frames: readonly FrameLike[]): FrameLike | null => {
  if (frames.length === 0) return null;
  if (frames.length >= 2) return frames[frames.length - 2] ?? null;
  return frames[0] ?? null;
};

const toDraw = (raw: Record<string, unknown>): SnapshotDraw => {
  const draw: { z: number; kind: string; rect?: Rect; asset?: string; text?: string; color?: string } = {
    z: finite(raw['z']) ?? 0,
    kind: typeof raw['kind'] === 'string' ? raw['kind'] : 'unknown',
  };
  const rect = asRect(raw['rect']);
  if (rect !== null) draw.rect = rect;
  if (typeof raw['asset'] === 'string') draw.asset = raw['asset'];
  if (typeof raw['text'] === 'string') draw.text = raw['text'];
  if (typeof raw['color'] === 'string') draw.color = raw['color'];
  return draw;
};

/** 从游戏侧拉一份快照（需要游戏已连上）。 */
export const captureSnapshot = async (
  client: DebugClient,
  name: string,
  options: { readonly settleMs?: number } = {},
): Promise<McpSnapshot> => {
  // 先等几帧再抓：页面刚启动时首次渲染可能被 recorder 的 4ms 帧间隔切成两截
  // （实测首帧只录到 bg+面板，第二帧才是其余组件），抓早了会拿到残缺帧。
  const settleMs = options.settleMs ?? 120;
  const canvas = (await client.request('canvas')) as SnapshotCanvas & { screen?: { width: number; height: number; dpr: number; orientation?: string } };
  if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
  const tree = (await client.request('tree', { limit: 3 })) as TreeResult;
  let state: unknown = null;
  try {
    const snapshot = (await client.request('state')) as { ok?: boolean; state?: unknown };
    if (snapshot.ok === true) state = snapshot.state ?? null;
  } catch {
    // 游戏没注册 state 快照是正常情况：快照里留 null，不阻断
    state = null;
  }
  const frames: readonly FrameLike[] =
    tree.frames !== undefined && tree.frames.length > 0
      ? tree.frames
      : tree.latest === null || tree.latest === undefined
        ? []
        : [tree.latest];
  const latest = completeFrameOf(frames);
  const calls = latest?.calls ?? [];
  return {
    version: SNAPSHOT_VERSION,
    name,
    at: new Date().toISOString(),
    game: { platform: typeof client.hello?.platform === 'string' ? client.hello.platform : 'unknown', screen: canvas.screen },
    canvas,
    layout: normalizeLayout(tree.layout),
    draws: calls.map(toDraw),
    frame: latest === null ? null : { frame: latest.frame, at: latest.at, ms: latest.ms, count: calls.length },
    state,
  };
};

export const snapshotPath = (dir: string, name: string): string => join(dir, `${assertSnapshotName(name)}.json`);

/** 存快照，返回写入路径。 */
export const saveSnapshot = (dir: string, snapshot: McpSnapshot): string => {
  mkdirSync(dir, { recursive: true });
  const file = snapshotPath(dir, snapshot.name);
  writeFileSync(file, JSON.stringify(snapshot, null, 2), 'utf8');
  return file;
};

const isRect = (value: unknown): value is Rect => asRect(value) !== null;

/** 读快照；格式不对就抛中文错误（不静默给空对象）。 */
export const readSnapshot = (dir: string, name: string): McpSnapshot => {
  const file = snapshotPath(dir, name);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`快照读不出来：${file}（${reason}）。先调 snapshot 存一份基线。`);
  }
  if (!isRecord(raw)) throw new Error(`快照格式不对（不是对象）：${file}`);
  const version = raw['version'];
  if (version !== SNAPSHOT_VERSION) {
    throw new Error(`快照版本不匹配：文件是 v${String(version)}，当前工具是 v${SNAPSHOT_VERSION}（重新 snapshot）`);
  }
  const layout = raw['layout'];
  if (!isRecord(layout) || !Object.values(layout).every((value) => isRect(value))) {
    throw new Error(`快照的 layout 字段不合法：${file}`);
  }
  const draws = raw['draws'];
  if (!Array.isArray(draws)) throw new Error(`快照的 draws 字段不合法：${file}`);
  return {
    version: SNAPSHOT_VERSION,
    name: typeof raw['name'] === 'string' ? raw['name'] : name,
    at: typeof raw['at'] === 'string' ? raw['at'] : '',
    game: isRecord(raw['game']) ? (raw['game'] as McpSnapshot['game']) : { platform: 'unknown', screen: undefined },
    canvas: isRecord(raw['canvas']) ? (raw['canvas'] as SnapshotCanvas) : {},
    layout: layout as Record<string, Rect>,
    draws: draws as SnapshotDraw[],
    frame: isRecord(raw['frame']) ? (raw['frame'] as unknown as SnapshotFrame) : null,
    state: raw['state'],
  };
};

export interface SnapshotListItem {
  readonly name: string;
  readonly at: string;
  readonly file: string;
  readonly bytes: number;
  readonly layoutCount: number;
  readonly drawCount: number;
}

/** 列快照（按修改时间新 → 旧）。目录不存在返回空数组。 */
export const listSnapshots = (dir: string): SnapshotListItem[] => {
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith('.json'));
  } catch {
    return [];
  }
  const items: SnapshotListItem[] = [];
  for (const file of files) {
    const full = join(dir, file);
    const name = file.slice(0, -'.json'.length);
    try {
      const stat = statSync(full);
      const snapshot = readSnapshot(dir, name);
      items.push({
        name,
        at: snapshot.at,
        file: full,
        bytes: stat.size,
        layoutCount: Object.keys(snapshot.layout).length,
        drawCount: snapshot.draws.length,
      });
    } catch {
      // 坏文件不阻断列表，但会在 name 上体现：跳过
    }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
};
