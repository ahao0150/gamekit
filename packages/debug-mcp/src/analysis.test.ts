/**
 * T4（MCP 8b）测试：快照 diff / 布局 vs 绘制对照 / watch 推送 / 工具端到端。
 *
 * 全部用 fake DebugClient + 临时目录，不启动游戏、不需要浏览器。
 * 「布局有、绘制没有」用一份故意删掉按钮绘制的快照断言 —— 它对应
 * 《万历求生录》结算面板那一类 bug。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAnalysisTools } from './analysis-tools';
import { NOT_CONNECTED } from './client-picker';
import { checkRender } from './check-render';
import type { McpSnapshot, SnapshotDraw } from './snapshot';
import { SNAPSHOT_VERSION } from './snapshot';
import { diffSnapshots } from './snapshot-diff';
import { createWatchRegistry } from './watch';
import type { WatchEvent } from './watch';
import type { DebugClient } from './ws-server';

// ---------------------------------------------------------------------------
// 测试数据：一个 390×844 的首页（布局与绘制基本对齐，故意留可注入的缺口）
// ---------------------------------------------------------------------------

const LAYOUT = {
  safe: { x: 0, y: 0, w: 390, h: 844 },
  title: { x: 19.5, y: 21.1, w: 351, h: 42.2 },
  info: { x: 19.5, y: 76, w: 351, h: 109.7 },
  hint: { x: 19.5, y: 768, w: 351, h: 54.9 },
  grid: { x: 50, y: 211, w: 290, h: 270 },
  cards: [
    { x: 19.5, y: 515, w: 167.6, h: 67.5 },
    { x: 202.9, y: 515, w: 167.6, h: 67.5 },
  ],
  primary: { x: 19.5, y: 684, w: 167.6, h: 63.3 },
};

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
const image = (z: number, rect: Rect, asset: string): SnapshotDraw => ({ z, kind: 'image', rect, asset });
const text = (z: number, x: number, y: number, content: string): SnapshotDraw => ({
  z,
  kind: 'text',
  rect: { x, y, w: 1, h: 1 },
  text: content,
});
const fill = (z: number, rect: Rect, color: string): SnapshotDraw => ({ z, kind: 'rect', rect, color });

/** 正常绘制：背景 + 信息面板 + 标题文字 + 2×2 格子 + 卡片 + 主按钮 + 提示文字。 */
const callsOf = (): SnapshotDraw[] => [
  fill(0, { x: 0, y: 0, w: 390, h: 844 }, '#132a32'),
  image(1, { x: 19.5, y: 76, w: 351, h: 109.7 }, 'panel-info.png'),
  text(2, 195, 40, '示例标题'),
  text(3, 195, 110, '选择 → 旋转 → 点格子装箱'),
  image(4, { x: 50, y: 211, w: 145, h: 135 }, 'grid-cell.png'),
  image(5, { x: 195, y: 211, w: 145, h: 135 }, 'grid-cell.png'),
  image(6, { x: 50, y: 346, w: 145, h: 135 }, 'grid-cell.png'),
  image(7, { x: 195, y: 346, w: 145, h: 135 }, 'grid-cell.png'),
  image(8, { x: 19.5, y: 515, w: 167.6, h: 67.5 }, 'card.png'),
  image(9, { x: 202.9, y: 515, w: 167.6, h: 67.5 }, 'card.png'),
  image(10, { x: 19.5, y: 684, w: 167.6, h: 63.3 }, 'btn.png'),
  text(11, 195, 795, '选择 → 旋转 → 点格子装箱'),
];

const makeSnapshot = (name: string, calls: readonly SnapshotDraw[], layout: unknown = LAYOUT): McpSnapshot => ({
  version: SNAPSHOT_VERSION,
  name,
  at: '2026-10-20T14:00:00.000Z',
  game: { platform: 'web', screen: { width: 390, height: 844, dpr: 2 } },
  canvas: { screen: { width: 390, height: 844, dpr: 2 }, fps: 60, drawsPerFrame: calls.length },
  layout: layout as McpSnapshot['layout'],
  draws: calls,
  frame: { frame: 12, at: 999, ms: 2, count: calls.length },
  state: { phase: 'home' },
});

/** 归一化由 captureSnapshot 做；测试里直接给已归一化布局对象。 */
const normalized = (raw: typeof LAYOUT): McpSnapshot['layout'] => {
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) value.forEach((rect, index) => (out[`${key}[${index}]`] = rect));
    else out[key] = value;
  }
  return out;
};

const fakeClient = (data: { canvas?: unknown; tree?: unknown; state?: unknown }): DebugClient => ({
  id: 'c1',
  connectedAt: 0,
  hello: { platform: 'web', screen: { width: 390, height: 844, dpr: 2 }, tools: ['tree'] },
  connected: true,
  request: async (method: string): Promise<unknown> => {
    if (method === 'canvas') return data.canvas ?? { screen: { width: 390, height: 844, dpr: 2 }, fps: 60 };
    if (method === 'tree') return data.tree;
    if (method === 'state') return { ok: true, state: data.state ?? { phase: 'home' } };
    throw new Error(`fake client 不支持 ${method}`);
  },
  close: (): void => undefined,
});

/**
 * 模拟游戏侧 `tree()`：frames 最后一条是**正在写入的半帧**（只有前两条绘制），
 * 快照必须取倒数第二条完整帧 —— 否则背景与面板会丢，checkRender 会误报。
 */
const treeOf = (calls: readonly SnapshotDraw[]): unknown => ({
  frames: [
    { frame: 11, at: 990, ms: 2, calls },
    { frame: 12, at: 999, ms: 1, calls: calls.slice(0, 2) },
  ],
  latest: { frame: 12, at: 999, ms: 1, calls: calls.slice(0, 2) },
  layout: LAYOUT,
});

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'mg-analysis-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe('checkRender：布局树 vs 绘制记录', () => {
  it('对齐时 ok=true；文本元素只进 warnings，不算错', () => {
    const result = checkRender(makeSnapshot('ok', callsOf(), normalized(LAYOUT)));
    expect(result.ok).toBe(true);
    expect(result.layoutOnly).toEqual([]);
    expect(result.drawOnly).toEqual([]);
    expect(result.offset).toEqual([]);
    expect(result.warnings.map((item) => item.path)).toEqual(expect.arrayContaining(['title', 'hint']));
    // 容器 safe 不参与检查：8 个矩形里有 7 个是元素
    expect(result.checked).toBe(7);
  });

  it('布局有、绘制没有：被注释掉的元素进 layoutOnly（drawn=false 形态）', () => {
    const withoutPrimary = callsOf().filter((call) => call['asset'] !== 'btn.png');
    const result = checkRender(makeSnapshot('missing', withoutPrimary, normalized(LAYOUT)));
    expect(result.ok).toBe(false);
    expect(result.layoutOnly.map((item) => item.path)).toContain('primary');
    expect(result.layoutOnly[0]?.coverage).toBe(0);
    expect(result.summary).toContain('1 个布局有但没画');
  });

  it('面板区域只剩文字、没有底板：进 warnings 并提示「可能是漏画面板」', () => {
    const withoutPanel = callsOf().filter((call) => call['asset'] !== 'panel-info.png');
    const result = checkRender(makeSnapshot('content-only', withoutPanel, normalized(LAYOUT)));
    const warning = result.warnings.find((item) => item.path === 'info');
    expect(warning?.reason).toContain('可能是漏画面板');
  });

  it('位置偏差 > 2px 进 offset，带 delta', () => {
    const shifted = callsOf().map((call) =>
      call['asset'] === 'btn.png' ? { ...call, rect: { x: 24.5, y: 684, w: 167.6, h: 63.3 } } : call,
    );
    const result = checkRender(makeSnapshot('shifted', shifted, normalized(LAYOUT)));
    expect(result.ok).toBe(false);
    const issue = result.offset.find((item) => item.path === 'primary');
    expect(issue?.delta.dx).toBe(5);
  });

  it('画了但布局里没有：布局外的绘制进 drawOnly', () => {
    const extra = callsOf().concat([fill(11, { x: 380, y: 830, w: 60, h: 40 }, '#f00')]);
    const result = checkRender(makeSnapshot('extra', extra, normalized(LAYOUT)));
    expect(result.drawOnly.some((item) => item.rect.x === 380)).toBe(true);
  });
});

describe('diff：两次快照的新增 / 消失 / 位移', () => {
  it('布局按 path 对账，绘制按位置就近匹配', () => {
    const base = makeSnapshot('baseline', callsOf(), normalized(LAYOUT));
    const next = makeSnapshot(
      'current',
      // 主按钮右移 10px（moved）、新增一条 icon（appeared）、少了一张卡片绘制（disappeared）
      callsOf()
        .filter((call) => !(call['asset'] === 'card.png' && call['z'] === 8))
        .map((call) =>
          call['asset'] === 'btn.png' ? { ...call, rect: { x: 29.5, y: 684, w: 167.6, h: 63.3 } } : call,
        )
        .concat([image(99, { x: 300, y: 600, w: 40, h: 40 }, 'icon.png')]),
      {
        ...LAYOUT,
        primary: { x: 19.5, y: 700, w: 167.6, h: 63.3 },
        extra: { x: 5, y: 5, w: 10, h: 10 },
      },
    );
    const diff = diffSnapshots(base, next);
    expect(diff.layout.appeared.map((item) => item.path)).toContain('extra');
    expect(diff.layout.moved.find((item) => item.path === 'primary')?.delta.dy).toBe(16);
    expect(diff.draws.appeared.some((item) => item.asset === 'icon.png')).toBe(true);
    expect(diff.draws.disappeared.length).toBeGreaterThan(0);
    expect(diff.summary).toContain('布局：');
  });
});

describe('分析工具端到端（fake client + 临时目录）', () => {
  it('snapshot 落盘 → snapshotList 能看到 → diff 读回两份文件', async () => {
    const dir = tempDir();
    const events: WatchEvent[] = [];
    const tools = createAnalysisTools({
      resolve: () => fakeClient({ tree: treeOf(callsOf()) }),
      latest: () => fakeClient({ tree: treeOf(callsOf()) }),
      snapshotDir: () => dir,
      notify: (event) => events.push(event),
    });

    const saved = JSON.parse((await tools.call('snapshot', { name: 'baseline' })).text) as {
      saved: string;
      layoutCount: number;
      drawCount: number;
    };
    expect(saved.saved).toBe(join(dir, 'baseline.json'));
    expect(saved.layoutCount).toBe(8);
    expect(saved.drawCount).toBe(callsOf().length);

    const list = JSON.parse((await tools.call('snapshotList', {})).text) as { count: number };
    expect(list.count).toBe(1);

    // 现场抓一份 current 与 baseline 对比（fake 每次返回同样的数据 → 全为 0）
    const diff = JSON.parse((await tools.call('diff', { from: 'baseline' })).text) as {
      from: string;
      to: string;
      layout: { appeared: unknown[]; moved: unknown[] };
    };    expect(diff.from).toBe('baseline');
    expect(diff.to).toBe('current');
    expect(diff.layout.appeared).toEqual([]);
    expect(diff.layout.moved).toEqual([]);
  });

  it('checkRender 缺省检查当前帧；snapshot 名非法给中文错误', async () => {
    const tools = createAnalysisTools({
      resolve: () => fakeClient({ tree: treeOf(callsOf()) }),
      latest: () => fakeClient({ tree: treeOf(callsOf()) }),
      snapshotDir: () => tempDir(),
      notify: () => undefined,
    });
    const result = JSON.parse((await tools.call('checkRender', {})).text) as { ok: boolean; checked: number };
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(7);
    const bad = await tools.call('diff', { from: '../escape' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('快照名只允许');
  });

  it('没连上游戏时给「先 mg dev」提示，而不是连接错误', async () => {
    const tools = createAnalysisTools({
      resolve: () => {
        throw new Error(NOT_CONNECTED);
      },
      latest: () => null,
      snapshotDir: () => tempDir(),
      notify: () => undefined,
    });
    const result = await tools.call('snapshot', { name: 'x' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('mg.mjs dev');
  });
});

describe('watch：轮询并推送变化', () => {
  it('state.phase 变化时 notify 收到事件；stop 后不再推', async () => {
    const data: { state: { phase: string } } = { state: { phase: 'home' } };
    const client = fakeClient({
      get state(): unknown {
        return data.state;
      },
    });
    const events: WatchEvent[] = [];
    const registry = createWatchRegistry({ client: () => client, notify: (event) => events.push(event), intervalMs: 100 });
    const started = await registry.start('state.phase');
    expect(started.value).toBe('home');

    // fake client 的 state 引用是同一个对象：改它就能模拟游戏状态变化
    data.state = { phase: 'goal' };
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.expr).toBe('state.phase');
    expect(events[0]?.to).toBe('goal');

    const stopped = registry.stop('state.phase');
    expect(stopped).toEqual(['state.phase']);
    data.state = { phase: 'load' };
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(events.every((event) => event.to !== 'load')).toBe(true);
  });

  it('layout.primary.x 能读到矩形分量；非法表达式被拒绝', async () => {
    const client = fakeClient({ tree: treeOf(callsOf()) });
    const registry = createWatchRegistry({ client: () => client, notify: () => undefined, intervalMs: 200 });
    const started = await registry.start('layout.primary.x');
    expect(started.value).toBe(19.5);
    registry.stopAll();
    // 非法表达式（不涉及平台 API）：必须被拒绝
    await expect(registry.start('foo.bar')).rejects.toThrow(/表达式写法不对/);
  });
});
