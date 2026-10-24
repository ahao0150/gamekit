/**
 * 五个 MCP 工具的实现。
 *
 * 每个工具都做三件事：拿到「当前连上的游戏」→ 走 WebSocket 发一条命令 →
 * 把结果整理成**人能读、AI 也便宜**的文本（结构化数据用 JSON，状态用短句）。
 *
 * 错误一律中文并且带下一步动作：没连上时告诉 AI 该先跑什么，而不是抛一个
 * 「connection refused」让它去猜。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { DebugClient } from './ws-server';
import type { ClickParams, ScreenshotParams, ToolResult, ToolSpec, TreeParams } from './contract';

/** 工具运行环境：目标客户端选择 + 截图输出目录。 */
export interface ToolContext {
  /** 选目标客户端（`params.client` 指定，省略 = 最新连上的）；没连上抛中文错误。 */
  resolve: (params: Record<string, unknown>) => DebugClient;
  /** 截图默认输出目录（绝对路径）。 */
  outDir(): string;
}

/** 游戏侧 canvas() 的返回形状。 */
interface CanvasInfo {
  readonly screen: { readonly width: number; readonly height: number; readonly dpr: number; readonly orientation: string };
  readonly canvas: { readonly width: number; readonly height: number };
  readonly fps: number;
  readonly drawsPerFrame: number;
  readonly frameMs: number;
  readonly retained: number;
  readonly recording: boolean;
}

/** 游戏侧 screenshot() 的返回形状。 */
interface ScreenshotData {
  readonly width: number;
  readonly height: number;
  readonly format: string;
  readonly data: string;
}

const ok = (text: string): ToolResult => ({ text });
const fail = (text: string): ToolResult => ({ text, isError: true });

/** 多客户端时的目标连接（所有运行时工具共用同一条说明）。 */
const CLIENT_PROP = {
  type: 'string',
  description: '多客户端时指定连接 id（先调 clients 看在线列表；省略 = 最新连上的那个）',
} as const;

/** 数字参数收窄（JSON 过来的值都是 unknown）。 */
const num = (value: unknown, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} 必须是数字，收到「${String(value)}」`);
  return value;
};

/** 格式化 canvas 信息。 */
function formatCanvas(info: CanvasInfo): string {
  const lines = [
    `画面 ${info.screen.width}×${info.screen.height} 逻辑像素，dpr=${info.screen.dpr}（画布 backing ${info.canvas.width}×${info.canvas.height}），${info.screen.orientation}`,
    `帧率 ${info.fps} fps · 每帧 ${info.drawsPerFrame} 次绘制 · 绘制耗时 ${info.frameMs} ms · 已记录 ${info.retained} 帧${info.recording ? '' : '（记录已关闭）'}`,
  ];
  return lines.join('\n');
}

export const createTools = (ctx: ToolContext): { specs: readonly ToolSpec[]; call: (name: string, params: Record<string, unknown>) => Promise<ToolResult> } => {
  const specs: readonly ToolSpec[] = [
    {
      name: 'canvas',
      description: '画布信息：逻辑尺寸、dpr、帧率、每帧绘制次数、绘制耗时。用来确认游戏跑没跑起来、掉不掉帧。',
      inputSchema: { type: 'object', properties: { client: CLIENT_PROP } },
    },
    {
      name: 'tree',
      description:
        '绘制记录（纯 JSON，可存档可 diff）：最近每一帧里实际发起的绘制调用，含 z 序、类型（image/rect/text）、屏幕矩形、源矩形、资源名、文字内容。' +
        '它和游戏布局树放在同一份返回里，两者对比能定位「算了没画 / 画了不该画 / 画了但错位」。',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', description: '取最近几帧，默认 1' }, client: CLIENT_PROP },
      },
    },
    {
      name: 'state',
      description: '游戏状态快照（纯 JSON）：phase、关卡、计时、包裹与格子等。用来断言状态迁移，比如点击后 phase 从 home 变 goal。',
      inputSchema: { type: 'object', properties: { client: CLIENT_PROP } },
    },
    {
      name: 'screenshot',
      description: '把当前画布截成 PNG 落盘，返回文件绝对路径（可直接用 read_image 看）。文件名默认带时间戳。',
      inputSchema: {
        type: 'object',
        properties: {
          out: { type: 'string', description: '输出路径（相对仓库根或绝对路径）；不传写到 out/debug/' },
          name: { type: 'string', description: '文件名（会自动补 .png）' },
          client: CLIENT_PROP,
        },
      },
    },
    {
      name: 'click',
      description:
        '在逻辑坐标 (x, y) 注入一次**真实** pointerdown + pointerup（走浏览器的真实事件路径，不是直接调游戏函数），然后建议再调 state() 看状态变化。',
      inputSchema: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' }, client: CLIENT_PROP },
        required: ['x', 'y'],
      },
    },
  ];

  /** 截图落盘：返回绝对路径。 */
  const saveScreenshot = (data: ScreenshotData, params: ScreenshotParams): string => {
    const provided = typeof params.out === 'string' && params.out.trim().length > 0 ? params.out.trim() : undefined;
    const baseName = typeof params.name === 'string' && params.name.trim().length > 0 ? params.name.trim() : `screenshot-${Date.now()}`;
    const withExt = baseName.endsWith('.png') ? baseName : `${baseName}.png`;
    const target = provided !== undefined ? (isAbsolute(provided) ? provided : resolve(join(process.cwd(), provided))) : join(ctx.outDir(), withExt);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(data.data, 'base64'));
    return target;
  };

  const call = async (name: string, params: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const client = ctx.resolve(params);
      switch (name) {
        case 'canvas': {
          const info = (await client.request('canvas')) as CanvasInfo;
          return ok(formatCanvas(info));
        }
        case 'tree': {
          const limit = params.limit === undefined ? 1 : Math.max(1, Math.floor(num(params.limit, 'limit')));
          const tree = await client.request('tree', { limit });
          return ok(JSON.stringify(tree, null, 2));
        }
        case 'state': {
          const snapshot = (await client.request('state')) as { ok: boolean; state?: unknown; error?: string };
          if (!snapshot.ok) return fail(snapshot.error ?? '游戏没有注册状态快照');
          return ok(JSON.stringify(snapshot.state, null, 2));
        }
        case 'screenshot': {
          // 截图是唯一可能传 1MB+ 数据的工具（dpr=2 时 780×1688 PNG 约 1.5MB base64），
          // 给它更长的超时；其余工具都是几十字节的 JSON。
          const data = (await client.request('screenshot', undefined, 20000)) as ScreenshotData;
          const path = saveScreenshot(data, params as ScreenshotParams);
          return ok(`已截图：${path}\n尺寸 ${data.width}×${data.height}（画布 backing 像素，含 dpr）`);
        }
        case 'click': {
          const x = num(params.x, 'x');
          const y = num(params.y, 'y');
          await client.request('click', { x, y });
          return ok(`已在逻辑坐标 (${x}, ${y}) 注入真实 pointerdown + pointerup。下一步建议调 state() 或 tree() 看变化。`);
        }
        default:
          return fail(`未知工具：${name}（可用：${specs.map((s) => s.name).join(', ')}）`);
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };

  return { specs, call };
};
