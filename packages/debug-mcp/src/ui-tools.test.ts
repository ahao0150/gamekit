// @long-file 五类契约（解析错误 / 布局 / preview / barrel / registry 参数）必须并排看，才能确认「同一份注册表被解析、参数校验、measure 三处共用」
/**
 * T8 验收测试：离线 UI 工具（不启动游戏、不连 WebSocket）。
 *
 * 覆盖 Chief 的四条验收：
 * 1. 示例游戏的界面出两个视口 ASCII；
 * 2. 故意写错的 `.ui` → 5 条 `file:line: 中文` 错误；
 * 3. grammar 与文档对得上（在 ui-grammar.test.ts）；
 * 4. 不连 WebSocket 时通过 MCP 协议也能调用（内存流，无网络）。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RpcResponse } from './contract';
import { startMcpServer } from './mcp';
import { PATTERN_NAMES } from './ui-patterns';
import { UI_TOOL_NAMES, createUiTools } from './ui-tools';

const HOME_UI = readFileSync(new URL('./__fixtures__/home.ui', import.meta.url), 'utf8');

/** 6 行、恰好 5 条错误：重复 region / 非法边 / 缺高度 / 非法 size / style 缺等号。 */
const BAD_UI = [
  'region header top 48',
  'region header bottom 20',
  'region weird sideways 10',
  'region foot top',
  'put button size bigg',
  'put button size 12 style foo',
].join('\n');

const ui = createUiTools();
const callText = async (name: string, params: Record<string, unknown>): Promise<string> =>
  (await ui.call(name, params)).text;

describe('ui.check：解析 + 布局 + 全部断言', () => {
  it('故意写错的 .ui 返回 5 条 file:line 中文错误', async () => {
    const payload = JSON.parse(
      await callText('ui.check', { source: BAD_UI, viewport: '390x844', fileName: 'bad.ui' }),
    ) as { ok: boolean; errors: string[]; rects: Record<string, unknown> };
    expect(payload.ok).toBe(false);
    expect(payload.errors).toHaveLength(5);
    for (const error of payload.errors) expect(error).toMatch(/^bad\.ui:\d+: .+/);
    expect(payload.rects).toEqual({});
  });

  it('内置组件夹具home.ui 在 390×844 通过，返回矩形表', async () => {
    const payload = JSON.parse(
      await callText('ui.check', { source: HOME_UI, viewport: '390x844', fileName: 'home.ui' }),
    ) as { ok: boolean; errors: string[]; rects: Record<string, { w: number; h: number }> };
    expect(payload.errors).toEqual([]);
    expect(payload.ok).toBe(true);
    expect(Object.keys(payload.rects).length).toBeGreaterThan(5);
  });

  it('多视口：results 数组，错误带视口前缀', async () => {
    const payload = JSON.parse(
      await callText('ui.check', { source: HOME_UI, viewports: ['390x844', '320x568'] }),
    ) as { ok: boolean; errors: string[]; results: Array<{ viewport: string; ok: boolean }> };
    expect(payload.results.map((item) => item.viewport)).toEqual(['390×844', '320×568']);
    expect(payload.ok).toBe(true);
    expect(payload.errors).toEqual([]);
  });

  it('文档写法 mg.ui.check 与 ui.check 等价', async () => {
    const viaAlias = await callText('mg.ui.check', { source: BAD_UI, fileName: 'bad.ui' });
    const canonical = await callText('ui.check', { source: BAD_UI, fileName: 'bad.ui' });
    expect(viaAlias).toBe(canonical);
  });

  it('缺 source 时给中文错误（isError）', async () => {
    const result = await ui.call('ui.check', {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain('source');
  });
});

describe('ui.layout：纯 JSON 矩形表', () => {
  it('home.ui 390×844：regions / rects / errors 都是数据', async () => {
    const payload = JSON.parse(await callText('ui.layout', { source: HOME_UI, viewport: '390x844' })) as {
      ok: boolean;
      viewport: string;
      regions: Record<string, { w: number; h: number }>;
      rects: Record<string, unknown>;
      errors: string[];
    };
    expect(payload.ok).toBe(true);
    expect(payload.viewport).toBe('390×844');
    expect(payload.regions['footerBand']?.h).toBeCloseTo(63.3, 1);
    expect(payload.rects['primaryButton']).toBeDefined();
    expect(payload.errors).toEqual([]);
  });
});

describe('ui.preview：ASCII 可视化', () => {
  it('内置组件夹具home.ui 两个视口：上下两段，元素带实际宽高', async () => {
    const text = await callText('ui.preview', { source: HOME_UI, viewports: ['390x844', '320x568'] });
    expect(text).toContain('┌─ 390×844');
    expect(text).toContain('┌─ 320×568');
    expect(text).toContain('footerBand');
    expect(text).toContain('[primaryButton 171.6×63.3');
    expect(text).toContain('└');
  });

  it('解析失败时不画框，只列错误', async () => {
    const text = await callText('ui.preview', { source: 'dance', fileName: 'bad.ui' });
    expect(text).toContain('✗ 解析失败');
    expect(text).toContain('bad.ui:1:');
    expect(text).not.toContain('┌─');
  });
});

describe('ui.preview：问题就地高亮 + 汇总行', () => {
  /** 未注册组件：离线 check 与构建同一注册表，解析期直接报未知组件。 */
  const UNKNOWN_UI = ['region body fill row align center', 'put parcel size fill cross auto'].join('\n');
  /** 已注册但用 cross auto + 无内容时仍可能 0 高：用 divider 演示 preview 的 ⚠。 */
  const ZERO_HEIGHT_UI = ['region body fill row align center', 'put divider size fill cross auto'].join('\n');

  it('未知组件在 preview 里以解析失败列出', async () => {
    const text = await callText('ui.preview', { source: UNKNOWN_UI, viewport: '390x844', fileName: 'bad.ui' });
    expect(text).toContain('解析失败');
    expect(text).toMatch(/未知组件 'parcel'/);
  });

  it('内置组件夹具home.ui：接上注册表后 parcelGrid 有真实高度（不再 0 高）', async () => {
    const text = await callText('ui.preview', { source: HOME_UI, viewport: '390x844' });
    expect(text).toContain('共 8 块');
    expect(text).toMatch(/\[parcelGrid [^\]]+×[^0][^\]]* auto\]/);
    expect(text).not.toMatch(/parcelGrid[^\n]*⚠ 高度 0/);
  });

  it('无归属错误（整屏 region 溢出）标在框顶总览行', async () => {
    const source = ['region a top 60%', 'region b bottom 60%'].join('\n');
    const text = await callText('ui.preview', { source, viewport: '390x844' });
    const header = text.split('\n')[0] ?? '';
    expect(header).toContain('⚠ 视口溢出');
    expect(header).toMatch(/^┌─ 390×844 /);
    expect(text).toContain('共 2 块 / 0 个元素 / 1 处问题（1 溢出）');
  });

  it('框内每一行显示宽度一致（⚠ 按两列算，不破坏边框）', async () => {
    const text = await callText('ui.preview', { source: ZERO_HEIGHT_UI, viewport: '390x844' });
    const frameLines = text.split('\n').filter((line) => line.startsWith('│'));
    expect(frameLines.length).toBeGreaterThan(0);
    const width = (line: string): number =>
      [...line].reduce((sum, char) => sum + (char === '⚠' ? 2 : 1), 0);
    for (const line of frameLines) expect(width(line)).toBe(width(frameLines[0] ?? ''));
  });

  it('check：未知组件直接失败（与构建同一注册表）', async () => {
    const payload = JSON.parse(
      await callText('ui.check', { source: UNKNOWN_UI, fileName: 'bad.ui' }),
    ) as { ok: boolean; errors: string[] };
    expect(payload.ok).toBe(false);
    expect(payload.errors.some((e) => e.includes("未知组件 'parcel'"))).toBe(true);
  });

  it('check 严格口径：已注册组件单维为 0 不判错（只有 0×0 才是错）', async () => {
    const payload = JSON.parse(await callText('ui.check', { source: ZERO_HEIGHT_UI })) as {
      ok: boolean;
      errors: string[];
    };
    // divider 有 measure 时可能非 0；若仍单维为 0，严格口径也不该因此失败
    expect(payload.errors.filter((e) => e.includes('尺寸 0×0'))).toEqual([]);
    const onlyZeroHeight = payload.errors.every(
      (e) => e.includes('高度 0') || e.includes('宽度 0') || e.includes('未知组件'),
    );
    if (payload.errors.length > 0 && onlyZeroHeight) {
      expect(payload.ok).toBe(true);
    }
  });
});

describe('ui.grammar / ui.pattern', () => {
  it('grammar 来自解析器表：关键字一个不少', async () => {
    const text = await callText('ui.grammar', {});
    for (const word of ['region', 'put', 'style', 'pad-x', 'pad-y', 'stretch', 'fill', 'auto', 'fixed', 'ratio']) {
      expect(text).toContain(word);
    }
    expect(text).toContain('v0.5');
  });

  it('每个内置样例在 390×844 / 320×568 都能通过 check', async () => {
    expect(PATTERN_NAMES).toEqual(['hud', 'list', 'modal', 'result']);
    for (const name of PATTERN_NAMES) {
      const source = await callText('ui.pattern', { name });
      expect(source).toContain('region');
      for (const viewport of ['390x844', '320x568']) {
        const payload = JSON.parse(await callText('ui.check', { source, viewport })) as {
          ok: boolean;
          errors: string[];
        };
        expect(payload.ok, `${name} @ ${viewport}：${payload.errors.join('；')}`).toBe(true);
      }
    }
  });

  it('未知样例给出可用列表（isError）', async () => {
    const result = await ui.call('ui.pattern', { name: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('hud');
  });
});

describe('工具面与离线可用性', () => {
  it('工具清单含 5 个 ui.* 工具，且不接管运行时工具', () => {
    expect(ui.specs.map((spec) => spec.name)).toEqual([...UI_TOOL_NAMES]);
    expect(ui.handles('canvas')).toBe(false);
    expect(ui.handles('mg.ui.layout')).toBe(true);
  });

  it('MCP 协议层：不连 WebSocket 也能调 ui.preview（内存流）', async () => {
    const output = new PassThrough();
    const lines: string[] = [];
    output.on('data', (chunk: Buffer) => {
      for (const raw of chunk.toString('utf8').split('\n')) {
        if (raw.trim().length > 0) lines.push(raw);
      }
    });
    const server = startMcpServer({
      specs: ui.specs,
      call: ui.call,
      input: new PassThrough(),
      output,
      log: () => undefined,
    });
    await server.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'ui.preview', arguments: { source: HOME_UI, viewport: '390x844' } },
      }),
    );
    const reply = JSON.parse(lines[0] ?? '{}') as RpcResponse & {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
    };
    expect(reply.result?.isError).toBeUndefined();
    expect(reply.result?.content?.[0]?.text).toContain('┌─ 390×844');
    server.close();
  });
});

/**
 * `registry` 参数：把「注册表写死内置那份」解开。
 *
 * 现实痛点：`games/player-ui-lab` 有 9 个自写组件，离线 `ui.check` 一律报「未知组件」，
 * 只能等 `mg build`（慢且拿不到 rects）。这不是 `.ui` 写错，是工具缺参数。
 */
describe('registry 参数：接外部注册表', () => {
  const PLAYER_REGISTRY = 'games/player-ui-lab/src/app/ui-registry.ts';
  const PLAYER_UI = readFileSync(new URL('../../../games/player-ui-lab/ui/player.ui', import.meta.url), 'utf8');
  const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
  const PLAYER_NAMES = [
    'albumCover',
    'artistName',
    'backBtn',
    'headerTitle',
    'moreBtn',
    'primaryControls',
    'progressBar',
    'secondaryRow',
    'songTitle',
  ];

  it('不传 registry：rects 与接外部注册表之前逐项相等（内置那条路零漂移）', async () => {
    const payload = JSON.parse(
      await callText('ui.check', { source: HOME_UI, viewport: '390x844', fileName: 'home.ui' }),
    ) as { ok: boolean; rects: Record<string, unknown> };
    expect(payload.ok).toBe(true);
    // 夹具的约束布局有固定期望值，避免依赖业务游戏的自定义组件或变动
    expect(payload.rects).toEqual({
      infoPanel: { x: 19.5, y: 75.96, w: 351, h: 109.72 },
      parcelGrid: { x: 31.2, y: 211, w: 327.6, h: 218.4 },
      primaryButton: { x: 19.5, y: 683.64, w: 171.6, h: 63.3 },
      secondaryButton: { x: 198.9, y: 683.64, w: 171.6, h: 63.3 },
      card0: { x: 19.5, y: 514.84, w: 171.6, h: 67.52 },
      card1: { x: 198.9, y: 514.84, w: 171.6, h: 67.52 },
    });
  });

  it('传 player-ui-lab 注册表：9 个自写组件不再报未知，rects 全出', async () => {
    // 前置：不传 registry 时确实报错（否则下面的「通过」证明不了是参数起的作用）
    const before = JSON.parse(await callText('ui.check', { source: PLAYER_UI, fileName: 'player.ui' })) as {
      ok: boolean;
      errors: string[];
    };
    expect(before.ok).toBe(false);
    expect(before.errors.some((error) => error.includes("未知组件 'backBtn'"))).toBe(true);

    const after = JSON.parse(
      await callText('ui.check', {
        source: PLAYER_UI,
        viewport: '390x844',
        fileName: 'player.ui',
        registry: PLAYER_REGISTRY,
      }),
    ) as { ok: boolean; errors: string[]; rects: Record<string, { w: number; h: number }> };
    expect(after.errors).toEqual([]);
    expect(after.ok).toBe(true);
    expect(Object.keys(after.rects).sort()).toEqual(PLAYER_NAMES);
    for (const name of PLAYER_NAMES) expect(after.rects[name]?.h, `${name} 高度`).toBeGreaterThan(0);
  });

  it('auto 尺寸真的走外部组件的 measure（不是只放行组件名）', async () => {
    // row → size fill 吃满宽（390），cross auto 取 measure 的高；align center 让 cross 不被 stretch 拉伸
    const source = ['region body fill row align center', 'put secondaryRow size fill cross auto'].join('\n');
    const payload = JSON.parse(
      await callText('ui.check', { source, viewport: '390x844', registry: PLAYER_REGISTRY }),
    ) as { ok: boolean; errors: string[]; rects: Record<string, { w: number; h: number }> };
    expect(payload.errors).toEqual([]);
    // secondaryRow = fixedSize(334, 44)：measure 返回 h=44
    expect(payload.rects['secondaryRow']?.h).toBe(44);
    expect(payload.rects['secondaryRow']?.w).toBe(390);
  });

  it('路径不存在：isError，且打印解析后的绝对路径', async () => {
    const result = await ui.call('ui.check', { source: HOME_UI, registry: 'games/nope/ui-registry.ts' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('registry 路径不存在');
    expect(result.text).toContain(join(REPO_ROOT, 'games', 'nope', 'ui-registry.ts'));
    expect(result.text).toContain(REPO_ROOT.trim()); // 顺带把仓库根也报出来
  });

  it('反例：模块里没有注册表 → 报错并列出该模块导出名，绝不回退内置注册表', async () => {
    // 不用 tools/lint.mjs：它顶层就有 process.exit()，import 即执行会杀掉测试进程。
    // ui-specs.ts 是纯导出（UI_TOOL_SPECS 数组），无副作用，且确定不含注册表。
    const result = await ui.call('ui.check', { source: HOME_UI, registry: 'packages/debug-mcp/src/ui-specs.ts' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('找不到注册表');
    expect(result.text).toContain('该模块导出：UI_TOOL_SPECS');
    expect(result.text).not.toContain('"ok": true'); // 静默回退会让这里出现一份「成功」结果
  });
});
