/**
 * 离线 ASCII 预览：把 `layout()` 的矩形表渲染成 AI 一眼能读的结构图。
 *
 * 为什么不是截图：AI 读截图贵且精度低。这里每个元素直接给名字 + **实际宽高**，
 * 每条区域给实际高度（百分比来源也标出来）。
 *
 * 出问题的块**就地标** `⚠ <短原因>`（问题清单由 `ui-issues.ts` 与 `ui.check`
 * 共用同一份判定）：AI 一眼看到「哪里坏了」，不用在图和错误列表之间来回对照。
 * 没有具体归属的错误（如整屏 region 溢出）标在框顶总览行；框下给一行汇总。
 */

import type { Rect } from '../../runtime/src/core/ui/contract';
import type { HitMode, LayerName, LayoutResult, LayoutViewport } from '../../runtime/src/core/ui/layout';
import type { ParsedUi } from '../../runtime/src/core/ui/parse';
import { formatNumber } from './ui-format';
import type { UiIssue } from './ui-issues';
import { summaryOf } from './ui-issues';

export { formatNumber };

const sizeText = (rect: Rect): string => `${formatNumber(rect.w)}×${formatNumber(rect.h)}`;

/** 终端显示宽度：`⚠` 占两列，其余按字符算（不引第三方库）。 */
const displayWidth = (text: string): number =>
  [...text].reduce((sum, char) => sum + (char === '⚠' ? 2 : 1), 0);

const padRight = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(0, width - displayWidth(text)));

interface ChildView {
  readonly name: string;
  readonly rect: Rect;
  /** `fill` / `auto` / 百分比来源，便于 AI 对照源码 */
  readonly note: string;
  /** 命中语义（v0.5）；非默认 `self` 时在行尾标出来 */
  readonly hit: HitMode;
}

interface RegionView {
  readonly name: string;
  readonly edge: string;
  readonly layer: LayerName;
  /** 声明序（同层内），overlay 靠它排先后 */
  readonly order: number;
  readonly rect: Rect;
  readonly note: string;
  readonly children: readonly ChildView[];
}

const noteOfSize = (size: unknown): string => {
  if (typeof size !== 'object' || size === null) return '';
  const spec = size as { kind?: unknown; r?: unknown };
  if (spec.kind === 'fill') return ' fill';
  if (spec.kind === 'auto') return ' auto';
  if (spec.kind === 'ratio' && typeof spec.r === 'number') return ` ${formatNumber(spec.r * 100)}%`;
  return '';
};

/** 收集「区域 + 区域内命名元素」：base 按视觉顺序，overlay 按声明序排在最后。 */
const collectRegions = (parsed: ParsedUi, result: LayoutResult): RegionView[] => {
  const views: RegionView[] = [];
  for (const region of parsed.spec.regions) {
    const rect = result.regions[region.name];
    if (rect === undefined) continue;
    const children: ChildView[] = [];
    for (const child of region.node?.stack?.children ?? []) {
      if (child.name === undefined) continue;
      const childRect = result.rects[child.name];
      if (childRect === undefined) continue;
      children.push({
        name: child.name,
        rect: childRect,
        note: noteOfSize(child.size),
        hit: result.meta[child.name]?.hit ?? 'self',
      });
    }
    views.push({
      name: region.name,
      edge: region.edge,
      layer: region.layer ?? 'base',
      order: views.length,
      rect,
      note: region.edge === 'fill' ? ` fill=${formatNumber(rect.h)}` : noteOfSize(region.height),
      children,
    });
  }
  return views.sort((a, b) => {
    // 层序：base 在前、overlay 在后（后者盖前者）
    if (a.layer !== b.layer) return a.layer === 'base' ? -1 : 1;
    // overlay 恒为整屏，y 都一样，按声明序；base 按视觉位置
    if (a.layer === 'overlay') return a.order - b.order;
    return a.rect.y - b.rect.y || a.rect.x - b.rect.x;
  });
};

const SEPARATOR = '\u0000';

/** 按目标名归并问题；同一行多个问题时只显示第一个，其余折成 `+n`。 */
const indexIssues = (issues: readonly UiIssue[]): Map<string, UiIssue[]> => {
  const byTarget = new Map<string, UiIssue[]>();
  for (const issue of issues) {
    for (const target of issue.targets) {
      const list = byTarget.get(target);
      if (list === undefined) byTarget.set(target, [issue]);
      else list.push(issue);
    }
  }
  return byTarget;
};

const suffixOf = (byTarget: Map<string, UiIssue[]>, name: string): string => {
  const list = byTarget.get(name);
  if (list === undefined || list.length === 0) return '';
  const first = list[0];
  if (first === undefined) return '';
  const more = list.length - 1;
  return `  ⚠ ${first.short}${more > 0 ? ` +${more}` : ''}`;
};

/**
 * 画一个视口的预览框：区域内问题就地标 ⚠，框下给汇总 + ✗ 明细。
 *
 * `issues` 由调用方用 `collectIssues()` 算好传进来（preview 用宽松口径）。
 */
export const renderPreview = (
  parsed: ParsedUi,
  result: LayoutResult,
  viewport: LayoutViewport,
  issues: readonly UiIssue[] = [],
): string => {
  const label = `${formatNumber(viewport.width)}×${formatNumber(viewport.height)}`;
  const regions = collectRegions(parsed, result);
  const elementCount = Object.keys(result.rects).filter((name) => result.regions[name] === undefined).length;
  const byTarget = indexIssues(issues);

  const body: string[] = [];
  regions.forEach((region, index) => {
    if (index > 0) body.push(SEPARATOR);
    // overlay 行标出来：一眼能看出哪些块是「独立整屏、盖在 base 上」的
    const layerTag = region.layer === 'overlay' ? '  [overlay]' : '';
    body.push(`${region.name}  ${formatNumber(region.rect.h)}${region.note}${layerTag}${suffixOf(byTarget, region.name)}`);
    for (const child of region.children) {
      const hitTag = child.hit === 'self' ? '' : ` hit=${child.hit}`;
      body.push(`  [${child.name} ${sizeText(child.rect)}${child.note}${hitTag}]${suffixOf(byTarget, child.name)}`);
    }
  });

  const width = Math.max(
    30,
    label.length + 2,
    // +1：内容区实际可用宽度是 width-1（两侧各留一个空格），否则最长行会把右边框顶出去
    ...body.map((line) => (line === SEPARATOR ? 0 : displayWidth(line) + 1)),
  );

  // 无归属问题（整屏 region 溢出等）标在框顶总览行右侧
  const unassigned = issues.filter((issue) => issue.targets.length === 0);
  const head = `─ ${label} `;
  const tail =
    unassigned.length === 0
      ? ''
      : ` ⚠ ${unassigned.length === 1 ? (unassigned[0]?.short ?? '问题') : `${unassigned.length} 处`} `;
  const inner = Math.max(2, width + 1 - displayWidth(head) - displayWidth(tail));

  const lines: string[] = [`┌${head}${'─'.repeat(inner)}${tail}┐`];
  for (const line of body) {
    lines.push(line === SEPARATOR ? `├${'─'.repeat(width + 1)}┤` : `│ ${padRight(line, width - 1)} │`);
  }
  lines.push(`└${'─'.repeat(width + 1)}┘`);
  lines.push(summaryOf(regions.length, elementCount, issues));

  const details = issues.map((issue) => `✗ ${issue.message}`);
  return details.length > 0 ? `${lines.join('\n')}\n\n${details.join('\n')}` : lines.join('\n');
};
