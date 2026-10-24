/**
 * 五个离线 UI 工具的实现：`ui.check / ui.layout / ui.preview / ui.grammar / ui.pattern`。
 *
 * 为什么不连 WebSocket：`parse()` / `bindComponents()` / `layout()` 都是纯函数，
 * MCP server 在 Node 里直接算就能出结果——AI 写完 `.ui` 不需要启动游戏、不需要
 * 浏览器、不需要截图。离线工具与 vite 共用 `createDefaultUiRegistry()`（31 个组件）。
 *
 * 命名：MCP 工具名用 `ui.check`（与既有 canvas/tree 的裸名风格一致）；
 * 文档里的 `mg.ui.check` 是同一个工具，调用时两种写法都接受。
 */

import { bindComponents } from '../../runtime/src/core/ui/bind';
import { createDefaultUiRegistry } from '../../runtime/src/core/ui/default-registry';
import { describeGrammar } from '../../runtime/src/core/ui/grammar';
import type { UiGrammar } from '../../runtime/src/core/ui/grammar';
import { layout } from '../../runtime/src/core/ui/layout';
import type { LayoutResult, LayoutViewport } from '../../runtime/src/core/ui/layout';
import { parse } from '../../runtime/src/core/ui/parse';
import type { ParsedUi } from '../../runtime/src/core/ui/parse';
import type { ToolResult, ToolSpec } from './contract';
import { collectIssues } from './ui-issues';
import { PATTERN_NAMES, getPattern } from './ui-patterns';
import { formatNumber, renderPreview } from './ui-preview';
import { UI_TOOL_SPECS } from './ui-specs';

/** 离线工具名（canonical）。分发时把文档里的 `mg.` 前缀剥掉。 */
export const UI_TOOL_NAMES = ['ui.check', 'ui.layout', 'ui.preview', 'ui.grammar', 'ui.pattern'] as const;

const DEFAULT_VIEWPORT: LayoutViewport = { width: 390, height: 844 };

/** 与 vite / 模板同一份完整注册表（31 个组件），离线 check 才能校验组件名并跑 measure。 */
const defaultRegistry = createDefaultUiRegistry();
const parseOptsFromRegistry = () => ({
  knownComponents: defaultRegistry.names(),
  componentProps: defaultRegistry.propKeys(),
});

const ok = (text: string): ToolResult => ({ text });
const fail = (text: string): ToolResult => ({ text, isError: true });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const VIEWPORT_TEXT = /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/;

const parseViewportText = (text: string): LayoutViewport | null => {
  const match = VIEWPORT_TEXT.exec(text.trim());
  if (match === null) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
};

const toViewport = (raw: unknown, what: string): LayoutViewport => {
  if (typeof raw === 'string') {
    const parsed = parseViewportText(raw);
    if (parsed !== null) return parsed;
    throw new Error(`${what} 需要「宽x高」写法（如 '390x844'），收到 '${raw}'`);
  }
  if (isRecord(raw)) {
    const width = raw['width'];
    const height = raw['height'];
    if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
      return { width, height };
    }
  }
  throw new Error(`${what} 需要 {width,height} 或 '390x844'，收到 ${JSON.stringify(raw)}`);
};

const viewportText = (viewport: LayoutViewport): string =>
  `${formatNumber(viewport.width)}×${formatNumber(viewport.height)}`;

/** `viewports`（数组）优先，其次单个 `viewport`，都没有就用 390×844。 */
const resolveViewports = (params: Record<string, unknown>): LayoutViewport[] => {
  const many = params['viewports'];
  if (many !== undefined) {
    if (!Array.isArray(many) || many.length === 0) {
      throw new Error('viewports 需要非空数组，如 ["390x844","320x568"]');
    }
    return many.map((item, index) => toViewport(item, `viewports[${index}]`));
  }
  const single = params['viewport'];
  return [single === undefined ? DEFAULT_VIEWPORT : toViewport(single, 'viewport')];
};

const parseSource = (params: Record<string, unknown>): ParsedUi => {
  const source = params['source'];
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new Error('source 必须是非空的 .ui 源码字符串（不是文件路径）');
  }
  const fileName = typeof params['fileName'] === 'string' && params['fileName'].length > 0 ? params['fileName'] : 'ui.ui';
  return parse(source, { fileName, ...parseOptsFromRegistry() });
};

/** 解析成功后绑定 measure，再交给 layout（与运行时 bindComponents 同口径）。 */
const bindAndLayout = (parsed: ParsedUi, viewport: LayoutViewport): { boundErrors: readonly string[]; result: LayoutResult } => {
  const bound = bindComponents(parsed.spec, { registry: defaultRegistry, env: { viewport, data: {} } });
  return { boundErrors: bound.errors, result: layout(bound.spec, viewport) };
};


/** L2 断言（越界 / 同 region 重叠 / 0×0）在 `ui-issues.ts`；这里只把文案取出来。 */
const issuesOf = (parsed: ParsedUi, result: LayoutResult, viewport: LayoutViewport): string[] =>
  collectIssues(parsed, result, viewport).map((issue) => issue.message);

const runCheck = (params: Record<string, unknown>): ToolResult => {
  const parsed = parseSource(params);
  if (parsed.errors.length > 0) {
    return ok(JSON.stringify({ ok: false, errors: parsed.errors, rects: {} }, null, 2));
  }
  const viewports = resolveViewports(params);
  if (viewports.length === 1) {
    const viewport = viewports[0] ?? DEFAULT_VIEWPORT;
    const { boundErrors, result } = bindAndLayout(parsed, viewport);
    const errors = [...boundErrors, ...issuesOf(parsed, result, viewport)];
    return ok(JSON.stringify({ ok: errors.length === 0, errors, rects: result.rects }, null, 2));
  }
  const results = viewports.map((viewport) => {
    const { boundErrors, result } = bindAndLayout(parsed, viewport);
    const errors = [...boundErrors, ...issuesOf(parsed, result, viewport)].map(
      (error) => `[${viewportText(viewport)}] ${error}`,
    );
    return { viewport: viewportText(viewport), ok: errors.length === 0, errors, rects: result.rects };
  });
  const errors = results.flatMap((item) => item.errors);
  return ok(JSON.stringify({ ok: errors.length === 0, errors, results }, null, 2));
};

const runLayout = (params: Record<string, unknown>): ToolResult => {
  const parsed = parseSource(params);
  if (parsed.errors.length > 0) {
    return ok(JSON.stringify({ ok: false, errors: parsed.errors, regions: {}, rects: {} }, null, 2));
  }
  const viewport = toViewport(params['viewport'] ?? DEFAULT_VIEWPORT, 'viewport');
  const { boundErrors, result } = bindAndLayout(parsed, viewport);
  const errors = [...boundErrors, ...result.errors];
  return ok(
    JSON.stringify(
      {
        ok: errors.length === 0,
        viewport: viewportText(viewport),
        regions: result.regions,
        rects: result.rects,
        paintOrder: result.paintOrder,
        meta: result.meta,
        errors,
      },
      null,
      2,
    ),
  );
};

const runPreview = (params: Record<string, unknown>): ToolResult => {
  const parsed = parseSource(params);
  if (parsed.errors.length > 0) {
    return ok(`✗ 解析失败，无法布局（${parsed.errors.length} 条）：\n${parsed.errors.map((error) => `✗ ${error}`).join('\n')}`);
  }
  const blocks = resolveViewports(params).map((viewport) => {
    const { boundErrors, result } = bindAndLayout(parsed, viewport);
    // preview 用宽松口径：任一维为 0 也标 ⚠；绑定错误追加进 issues 文案
    const issues = collectIssues(parsed, result, viewport, { anyZeroDimension: true });
    const boundIssues = boundErrors.map((message) => ({
      kind: 'zero' as const,
      message,
      targets: [] as string[],
      short: '绑定',
    }));
    return renderPreview(parsed, result, viewport, [...boundIssues, ...issues]);
  });
  return ok(blocks.join('\n\n'));
};

/** 从 grammar.ts 的表生成说明文本，不手写任何关键字清单。 */
const grammarText = (): string => {
  const grammar: UiGrammar = describeGrammar();
  return [
    `.ui 语法 ${grammar.version}（由解析器 grammar.ts 动态生成，不是手写手册；冲突时以此为准）`,
    '',
    `语句动词：${grammar.verbs.join(' / ')}（style 是 put 的内联修饰词，不是独立行）`,
    `region 边：${grammar.region.edges.join(' / ')}`,
    `region 方向：${grammar.region.directions.join(' / ')}`,
    `region 修饰词：${grammar.region.modifiers.join(' / ')}`,
    `align 取值：${grammar.region.alignValues.join(' / ')}`,
    `justify 取值：${grammar.region.justifyValues.join(' / ')}（主轴对齐；fill 子元素先吃剩余空间，剩下的才按 justify 分配）`,
    `put 修饰词：${grammar.put.modifiers.join(' / ')}`,
    `层（v0.5 分段行）：${grammar.layers.join(' / ')}（overlay 独立整屏坐标系，恒在 base 之上；不写默认 base）`,
    `hit 取值：${grammar.put.hits.join(' / ')}（默认 self；block 吃掉点击无动作，none 穿透）`,
    `尺寸写法：${grammar.put.sizes.join(' / ')}`,
    `长度写法：${grammar.lengths.join(' / ')}`,
    `style 值类型：${grammar.put.styleValues.join(' / ')}`,
    '',
    '百分比基数规则：',
    ...grammar.percentBasis.map((item) => `- ${item.where}：${item.basis}`),
    '',
    `错误格式：${grammar.errorFormat}`,
  ].join('\n');
};

const runPattern = (params: Record<string, unknown>): ToolResult => {
  const name = params['name'];
  if (typeof name !== 'string' || name.length === 0) {
    return fail(`pattern 需要 name，可用：${PATTERN_NAMES.join(' / ')}`);
  }
  const source = getPattern(name);
  if (source === undefined) {
    return fail(`未知样例 '${name}'，可用：${PATTERN_NAMES.join(' / ')}`);
  }
  return ok(source);
};

export interface UiTools {
  readonly specs: readonly ToolSpec[];
  readonly call: (name: string, params: Record<string, unknown>) => Promise<ToolResult>;
  /** 这个工具名是否属于离线工具（含 `mg.` 前缀写法）。 */
  readonly handles: (name: string) => boolean;
}

export const createUiTools = (): UiTools => {
  const canonical = (name: string): string => (name.startsWith('mg.') ? name.slice(3) : name);
  const handles = (name: string): boolean => (UI_TOOL_NAMES as readonly string[]).includes(canonical(name));

  const call = async (name: string, params: Record<string, unknown>): Promise<ToolResult> => {
    try {
      switch (canonical(name)) {
        case 'ui.check':
          return runCheck(params);
        case 'ui.layout':
          return runLayout(params);
        case 'ui.preview':
          return runPreview(params);
        case 'ui.grammar':
          return ok(grammarText());
        case 'ui.pattern':
          return runPattern(params);
        default:
          return fail(`未知离线工具：${name}（可用：${UI_TOOL_NAMES.join(' / ')}）`);
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };

  return { specs: UI_TOOL_SPECS, call, handles };
};
