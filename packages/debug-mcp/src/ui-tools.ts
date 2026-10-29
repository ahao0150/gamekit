// @long-file 五个离线工具共用「解析 → 绑定 measure → 布局」一条链；加 registry 加载后，拆开会让「这次到底用了哪份注册表」散落到多处，正是本文件要防的错
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

import { existsSync } from 'node:fs';
import { isAbsolute, normalize, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bindComponents } from '../../runtime/src/core/ui/bind';
import type { ComponentRegistry } from '../../runtime/src/core/ui/components';
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

/**
 * 与 vite / 模板同一份完整注册表（31 个组件）。
 *
 * **只有没传 `registry` 参数时才用它**；传了外部注册表就完全不碰它 ——
 * 更不会「外部解析失败就回退到这份」，那会让人以为验过了（见 `resolveRegistry`）。
 */
const defaultRegistry = createDefaultUiRegistry();

/** 解析器选项从**实际要用的**注册表取，否则外部组件在解析期就被判「未知组件」。 */
const parseOptsFromRegistry = (registry: ComponentRegistry) => ({
  knownComponents: registry.names(),
  componentProps: registry.propKeys(),
});

/** 仓库根：本文件在 `packages/debug-mcp/src/`，上溯三层（src → debug-mcp → packages → 仓库根）。 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const ok = (text: string): ToolResult => ({ text });
const fail = (text: string): ToolResult => ({ text, isError: true });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------------------
// 外部注册表（`registry` 参数）
//
// 为什么需要：`ui.check` 曾写死内置注册表，任何游戏自写的组件（如 player-ui-lab 的 9 个）
// 离线一律报「未知组件」，只能等 `mg build` 才报 —— 那不是 `.ui` 写错，是工具缺参数。
//
// 三条硬约束：
// 1. 不传 `registry` = 与改动前逐字节一致（仍用内置那份）；
// 2. 传了就**只认外部那份**，`knownComponents` / `componentProps` / `bindComponents`
//    三处全部换成它，`auto` 尺寸才会真的走外部组件的 `measure`；
// 3. 任何失败都抛错，**绝不静默回退内置注册表** —— 回退会让人以为验过了，
//    比直接报错危险得多。
// ---------------------------------------------------------------------------

/** 注册表形状：`ComponentRegistry` 的六个方法一个都不能少。 */
const isRegistryLike = (value: unknown): value is ComponentRegistry =>
  isRecord(value)
  && typeof value['register'] === 'function'
  && typeof value['get'] === 'function'
  && typeof value['has'] === 'function'
  && typeof value['names'] === 'function'
  && typeof value['propKeys'] === 'function'
  && typeof value['propDecls'] === 'function';

/**
 * 模块里的注册表候选：值是注册表实例，或名字以 `create` 开头、**无参调用**后返回注册表。
 *
 * 认不出（0 个）与认不清（多个）都交给 `pickRegistry` 报错，不猜。
 */
const registryCandidates = (
  mod: Record<string, unknown>,
): { readonly name: string; readonly registry: ComponentRegistry }[] => {
  const found: { name: string; registry: ComponentRegistry }[] = [];
  for (const [name, exported] of Object.entries(mod)) {
    if (isRegistryLike(exported)) {
      found.push({ name, registry: exported });
      continue;
    }
    if (typeof exported === 'function' && /^create/i.test(name)) {
      try {
        const made: unknown = (exported as () => unknown)();
        if (isRegistryLike(made)) found.push({ name: `${name}()`, registry: made });
      } catch {
        // 需要参数的工厂不是这里要的：跳过。真没有候选时会把该模块全部导出名列出来。
      }
    }
  }
  return found;
};

/** 出现多个候选时的优先命名；都不匹配就报错，绝不随便挑一个。 */
const PREFERRED_FACTORY_NAMES = ['createRegistry', 'createDefaultUiRegistry', 'createDemoRegistry'];

const pickRegistry = (mod: Record<string, unknown>, absPath: string): ComponentRegistry => {
  const candidates = registryCandidates(mod);
  const only = candidates[0];
  if (only !== undefined && candidates.length === 1) return only.registry;

  const exportsText = Object.keys(mod).join(' / ') || '（该模块没有任何导出）';
  if (candidates.length === 0) {
    throw new Error(
      `registry 模块里找不到注册表：${absPath}\n`
      + `该模块导出：${exportsText}\n`
      + '需要导出 ComponentRegistry 实例，或导出**无参** create* 工厂（如 createRegistry / createDefaultUiRegistry）',
    );
  }
  for (const preferred of PREFERRED_FACTORY_NAMES) {
    const hit = candidates.find((item) => item.name === `${preferred}()` || item.name === preferred);
    if (hit !== undefined) return hit.registry;
  }
  throw new Error(
    `registry 模块里有多个注册表候选，无法确定用哪个：${candidates.map((item) => item.name).join(' / ')}（${absPath}）\n`
    + `改为只导出一个，或用 ${PREFERRED_FACTORY_NAMES.join(' / ')} 命名`,
  );
};

/** `registry` 参数 → 外部注册表。相对路径按仓库根解析；所有失败都抛中文错并带绝对路径。 */
const importExternalRegistry = async (raw: string): Promise<ComponentRegistry> => {
  const trimmed = raw.trim();
  const absPath = isAbsolute(trimmed) ? normalize(trimmed) : resolvePath(REPO_ROOT, trimmed);
  if (!existsSync(absPath)) {
    throw new Error(`registry 路径不存在：${absPath}\n（收到 '${raw}'；相对路径按仓库根解析：${REPO_ROOT}）`);
  }
  let mod: Record<string, unknown>;
  try {
    // registry 参数指向用户工程里的模块，路径到运行期才知道，只能动态 import。
    mod = (await import(pathToFileURL(absPath).href)) as Record<string, unknown>; // @allow-dynamic-import 本包只跑在 Node（MCP 工具），不进小游戏包
  } catch (error) {
    throw new Error(
      `registry 模块 import 失败：${absPath}\n原因：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return pickRegistry(mod, absPath);
};

/** 不传 → 内置注册表（行为与改动前一致）；传了 → 只认外部那份，失败即抛错。 */
const resolveRegistry = async (params: Record<string, unknown>): Promise<ComponentRegistry> => {
  const raw = params['registry'];
  if (raw === undefined) return defaultRegistry;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`registry 必须是非空字符串（相对仓库根的路径或绝对路径），收到 ${JSON.stringify(raw)}`);
  }
  return importExternalRegistry(raw);
};

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

const parseSource = (params: Record<string, unknown>, registry: ComponentRegistry): ParsedUi => {
  const source = params['source'];
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new Error('source 必须是非空的 .ui 源码字符串（不是文件路径）');
  }
  const fileName = typeof params['fileName'] === 'string' && params['fileName'].length > 0 ? params['fileName'] : 'ui.ui';
  return parse(source, { fileName, ...parseOptsFromRegistry(registry) });
};

/** 解析成功后绑定 measure，再交给 layout（与运行时 bindComponents 同口径）。 */
const bindAndLayout = (
  parsed: ParsedUi,
  viewport: LayoutViewport,
  registry: ComponentRegistry,
): { boundErrors: readonly string[]; result: LayoutResult } => {
  // 用外部注册表时，`auto` 尺寸真的走这些组件的 measure，不是只放行组件名
  const bound = bindComponents(parsed.spec, { registry, env: { viewport, data: {} } });
  return { boundErrors: bound.errors, result: layout(bound.spec, viewport) };
};


/** L2 断言（越界 / 同 region 重叠 / 0×0）在 `ui-issues.ts`；这里只把文案取出来。 */
const issuesOf = (parsed: ParsedUi, result: LayoutResult, viewport: LayoutViewport): string[] =>
  collectIssues(parsed, result, viewport).map((issue) => issue.message);

const runCheck = (params: Record<string, unknown>, registry: ComponentRegistry): ToolResult => {
  const parsed = parseSource(params, registry);
  if (parsed.errors.length > 0) {
    return ok(JSON.stringify({ ok: false, errors: parsed.errors, rects: {} }, null, 2));
  }
  const viewports = resolveViewports(params);
  if (viewports.length === 1) {
    const viewport = viewports[0] ?? DEFAULT_VIEWPORT;
    const { boundErrors, result } = bindAndLayout(parsed, viewport, registry);
    const errors = [...boundErrors, ...issuesOf(parsed, result, viewport)];
    return ok(JSON.stringify({ ok: errors.length === 0, errors, rects: result.rects }, null, 2));
  }
  const results = viewports.map((viewport) => {
    const { boundErrors, result } = bindAndLayout(parsed, viewport, registry);
    const errors = [...boundErrors, ...issuesOf(parsed, result, viewport)].map(
      (error) => `[${viewportText(viewport)}] ${error}`,
    );
    return { viewport: viewportText(viewport), ok: errors.length === 0, errors, rects: result.rects };
  });
  const errors = results.flatMap((item) => item.errors);
  return ok(JSON.stringify({ ok: errors.length === 0, errors, results }, null, 2));
};

const runLayout = (params: Record<string, unknown>, registry: ComponentRegistry): ToolResult => {
  const parsed = parseSource(params, registry);
  if (parsed.errors.length > 0) {
    return ok(JSON.stringify({ ok: false, errors: parsed.errors, regions: {}, rects: {} }, null, 2));
  }
  const viewport = toViewport(params['viewport'] ?? DEFAULT_VIEWPORT, 'viewport');
  const { boundErrors, result } = bindAndLayout(parsed, viewport, registry);
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

const runPreview = (params: Record<string, unknown>, registry: ComponentRegistry): ToolResult => {
  const parsed = parseSource(params, registry);
  if (parsed.errors.length > 0) {
    return ok(`✗ 解析失败，无法布局（${parsed.errors.length} 条）：\n${parsed.errors.map((error) => `✗ ${error}`).join('\n')}`);
  }
  const blocks = resolveViewports(params).map((viewport) => {
    const { boundErrors, result } = bindAndLayout(parsed, viewport, registry);
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
    `aspect 写法：${grammar.put.aspects.join(' / ')}（w/h 比值，保留四位小数；必须且只能有一个已知轴）`,
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
          return runCheck(params, await resolveRegistry(params));
        case 'ui.layout':
          return runLayout(params, await resolveRegistry(params));
        case 'ui.preview':
          return runPreview(params, await resolveRegistry(params));
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
