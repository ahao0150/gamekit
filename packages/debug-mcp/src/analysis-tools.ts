/**
 * 分析型运行时工具（T4 / MCP 8b）：`snapshot / snapshotList / diff / checkRender / watch`。
 *
 * 与 `tools.ts` 的五个基础工具分开的原因：这些工具做的是**跨快照分析**，
 * 有磁盘状态（快照目录）和定时器（watch），把两者塞一个文件会过 300 行。
 *
 * 全部需要游戏连上 WebSocket；纯离线能力在 `ui-tools.ts`。
 */

import { captureSnapshot, listSnapshots, readSnapshot, saveSnapshot, assertSnapshotName } from './snapshot';
import type { McpSnapshot } from './snapshot';
import { diffSnapshots } from './snapshot-diff';
import { checkRender } from './check-render';
import type { WatchEvent, WatchRegistry } from './watch';
import { createWatchRegistry } from './watch';
import type { ToolResult, ToolSpec } from './contract';
import type { DebugClient } from './ws-server';

/** 分析工具的运行环境。 */
export interface AnalysisContext {
  /** 选目标客户端（`params.client` 指定，否则最新连上的）；没连上抛中文错误。 */
  readonly resolve: (params: Record<string, unknown>) => DebugClient;
  /** 最新连上的客户端；没有返回 null（watch 轮询用）。 */
  readonly latest: () => DebugClient | null;
  /** 快照目录（绝对路径，通常是 `<cwd>/out/mcp-snapshots`）。 */
  readonly snapshotDir: () => string;
  /** 把 watch 变化推给 MCP 客户端（包装成 notifications/message）。 */
  readonly notify: (event: WatchEvent) => void;
}

export const ANALYSIS_TOOL_NAMES = ['snapshot', 'snapshotList', 'diff', 'checkRender', 'watch'] as const;

const ok = (text: string): ToolResult => ({ text });
const fail = (text: string): ToolResult => ({ text, isError: true });
const json = (data: unknown): ToolResult => ok(JSON.stringify(data, null, 2));

/** 多客户端时的目标连接（所有运行时工具共用同一条说明）。 */
const CLIENT_PROP = {
  type: 'string',
  description: '多客户端时指定连接 id（先调 clients 看在线列表；省略 = 最新连上的那个）',
} as const;

const nameOf = (params: Record<string, unknown>, fallback: string): string => {
  const raw = params['name'];
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || raw.length === 0) throw new Error('name 必须是非空字符串');
  return assertSnapshotName(raw);
};

const stamp = (): string => {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `auto-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const summaryOf = (snapshot: McpSnapshot): Record<string, unknown> => ({
  name: snapshot.name,
  at: snapshot.at,
  screen: snapshot.canvas.screen ?? snapshot.game.screen ?? null,
  layoutCount: Object.keys(snapshot.layout).length,
  drawCount: snapshot.draws.length,
  frame: snapshot.frame,
});

/** 现场抓一份（不落盘）。 */
const captureLive = async (ctx: AnalysisContext, params: Record<string, unknown>, name: string): Promise<McpSnapshot> =>
  captureSnapshot(ctx.resolve(params), name);

export interface AnalysisTools {
  readonly specs: readonly ToolSpec[];
  readonly call: (name: string, params: Record<string, unknown>) => Promise<ToolResult>;
  readonly handles: (name: string) => boolean;
  /** stdin 关闭 / 进程退出时停掉 watch 定时器。 */
  readonly dispose: () => void;
}

export const createAnalysisTools = (ctx: AnalysisContext): AnalysisTools => {
  const watchers: WatchRegistry = createWatchRegistry({
    client: () => ctx.latest(),
    notify: ctx.notify,
  });

  const specs: readonly ToolSpec[] = [
    {
      name: 'snapshot',
      description:
        '把当前「布局树 + 绘制记录 + canvas 信息 + state」存成磁盘快照（默认 out/mcp-snapshots/<name>.json），供跨会话 diff。' +
        'name 默认 auto-<时间戳>；同名会覆盖。快照是纯 JSON，另一个进程也能读。',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: '快照名（字母数字 ._-，默认自动时间戳）' }, client: CLIENT_PROP },
      },
    },
    {
      name: 'snapshotList',
      description: '列出磁盘上已存的快照：名字、时间、文件路径、布局/绘制条数。用来找回昨天存的基线。',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'diff',
      description:
        '对比两次快照，返回三类差异：appeared（新增）/ disappeared（消失）/ moved（位移，带 delta）。' +
        '分别对布局树（按元素路径）和绘制记录（同种绘制按位置就近匹配）各算一份。' +
        '`to` 省略时现场抓一份当前状态（不落盘）做对比。',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '基线快照名（必填）' },
          to: { type: 'string', description: '目标快照名；省略则抓当前帧' },
          client: CLIENT_PROP,
        },
        required: ['from'],
      },
    },
    {
      name: 'checkRender',
      description:
        '对照「布局树」与「本帧绘制记录」，报三类问题：layoutOnly（布局有、没画）、drawOnly（画了但布局里没有）、' +
        'offset（有同形状绘制但偏差 > 2px）。warnings 是「只有文字/图标、没有底板」的提示（面板漏画会落在这里）。' +
        '不传 snapshot 时检查当前帧。',
      inputSchema: {
        type: 'object',
        properties: {
          snapshot: { type: 'string', description: '用已存快照检查；省略则抓当前帧' },
          client: CLIENT_PROP,
        },
      },
    },
    {
      name: 'watch',
      description:
        '监听表达式变化，变化时推 MCP 通知（notifications/message，logger=mg.watch）。' +
        '表达式示例：state.phase / layout.primary / layout.primary.x / frame.count。' +
        '`stop: true` 停掉（带 expr 只停该条，不带则全停）。同一表达式重复 watch 会覆盖。',
      inputSchema: {
        type: 'object',
        properties: {
          expr: { type: 'string', description: 'state.* / layout.* / frame.* 表达式' },
          stop: { type: 'boolean', description: 'true = 停止监听' },
        },
      },
    },
  ];

  const canonical = (name: string): string => (name.startsWith('mg.') ? name.slice(3) : name);
  const handles = (name: string): boolean => (ANALYSIS_TOOL_NAMES as readonly string[]).includes(canonical(name));

  const call = async (name: string, params: Record<string, unknown>): Promise<ToolResult> => {
    try {
      switch (canonical(name)) {
        case 'snapshot': {
          const snapshot = await captureSnapshot(ctx.resolve(params), nameOf(params, stamp()));
          const file = saveSnapshot(ctx.snapshotDir(), snapshot);
          return json({ saved: file, ...summaryOf(snapshot) });
        }
        case 'snapshotList': {
          const items = listSnapshots(ctx.snapshotDir());
          return json({ dir: ctx.snapshotDir(), count: items.length, snapshots: items });
        }
        case 'diff': {
          const fromName = params['from'];
          if (typeof fromName !== 'string' || fromName.length === 0) throw new Error('diff 需要 from（基线快照名）');
          const from = readSnapshot(ctx.snapshotDir(), fromName);
          const toRaw = params['to'];
          const to =
            typeof toRaw === 'string' && toRaw.length > 0
              ? readSnapshot(ctx.snapshotDir(), toRaw)
              : await captureLive(ctx, params, 'current');
          return json(diffSnapshots(from, to));
        }
        case 'checkRender': {
          const nameRaw = params['snapshot'];
          const snapshot =
            typeof nameRaw === 'string' && nameRaw.length > 0
              ? readSnapshot(ctx.snapshotDir(), nameRaw)
              : await captureLive(ctx, params, 'current');
          return json(checkRender(snapshot));
        }
        case 'watch': {
          if (params['stop'] === true) {
            const expr = typeof params['expr'] === 'string' ? params['expr'] : undefined;
            const stopped = watchers.stop(expr);
            return json({ stopped, watching: watchers.list().map((item) => item.expr) });
          }
          const expr = params['expr'];
          if (typeof expr !== 'string' || expr.length === 0) {
            throw new Error('watch 需要 expr（如 state.phase / layout.primary.x），或用 { stop: true } 全停');
          }
          const started = await watchers.start(expr);
          return json({
            ...started,
            watching: watchers.list().map((item) => item.expr),
            note: '值变化时服务端会推 notifications/message（logger=mg.watch），内容含 expr / from / to / at。',
          });
        }
        default:
          return fail(`未知分析工具：${name}（可用：${ANALYSIS_TOOL_NAMES.join(' / ')}）`);
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };

  return { specs, call, handles, dispose: () => watchers.stopAll() };
};
