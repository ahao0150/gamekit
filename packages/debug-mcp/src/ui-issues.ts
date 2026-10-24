/**
 * 离线 UI 的问题清单：把 `layout()` 错误与 L2 断言统一成**结构化 issue**。
 *
 * 为什么要结构而不只是字符串：`ui.check` 要完整文案，`ui.preview` 要在对应行
 * 打 `⚠ <短原因>`、还要按类别汇总。两处必须用**同一份判定**，否则会出现
 * 「check 说没问题、preview 标红」这种自相矛盾（AI 会信哪个？）。
 *
 * 一个刻意的口径差：`preview` 把「任一维为 0」也标出来（`高度 0` 一眼暴露
 * measure 未注册），而 `check` 只在 0×0 时判错——0 高在布局里是合法中间态
 * （组件 measure 未注册就有 0），不能当校验失败。选项 `anyZeroDimension` 区分。
 */

import type { Rect } from '../../runtime/src/core/ui/contract';
import type { LayoutResult, LayoutViewport } from '../../runtime/src/core/ui/layout';
import type { ParsedUi } from '../../runtime/src/core/ui/parse';
import { formatNumber } from './ui-format';

export type IssueKind = 'overflow' | 'zero' | 'overlap';

export interface UiIssue {
  readonly kind: IssueKind;
  /** 完整错误文案（`ui.check` 的 errors 与预览底部 ✗ 列表用） */
  readonly message: string;
  /** 高亮落在哪几行（region / 元素名）；空数组 = 无具体归属，标在总览行 */
  readonly targets: readonly string[];
  /** 行内高亮短原因（≤ 12 字） */
  readonly short: string;
}

/** 汇总行里的类别名（顺序即汇总顺序）。 */
export const ISSUE_KINDS: readonly IssueKind[] = ['overflow', 'zero', 'overlap'];

export const ISSUE_LABEL: Readonly<Record<IssueKind, string>> = {
  overflow: '溢出',
  zero: '尺寸为 0',
  overlap: '重叠',
};

export interface IssueOptions {
  /**
   * `true`（preview）：任一维为 0 都算提示；
   * `false`（check，默认）：仅 0×0 判错（0 高 = measure 未注册的合法中间态）。
   */
  readonly anyZeroDimension?: boolean;
}

const rectText = (rect: Rect): string =>
  `(${formatNumber(rect.x)}, ${formatNumber(rect.y)}) ${formatNumber(rect.w)}×${formatNumber(rect.h)}`;

const viewportText = (viewport: LayoutViewport): string =>
  `${formatNumber(viewport.width)}×${formatNumber(viewport.height)}`;

/** 短原因超过 12 字就退化，避免把 ASCII 行撑坏。 */
const shortOf = (preferred: string, fallback: string): string =>
  [...preferred].length <= 12 ? preferred : fallback;

/**
 * 从 layout 错误文案里认归属节点。`layout()` 的错误以 path 开头：
 * region 层是 `regionName`，stack 层是 `regionName/childName`（见 layout.ts）。
 */
const targetsOfMessage = (message: string, known: ReadonlySet<string>): string[] => {
  const head = message.split(' ', 1)[0] ?? '';
  const parts = head.split('/').filter((part) => part.length > 0);
  const last = parts[parts.length - 1];
  if (last !== undefined && known.has(last)) return [last];
  const first = parts[0];
  if (first !== undefined && known.has(first)) return [first];
  return [];
};

/** 布局层错误（区带溢出 / 主轴溢出）：文案里没有 `节点 'x'` 形状，靠 path 认领。 */
const layoutIssues = (result: LayoutResult): UiIssue[] => {
  const known = new Set([...Object.keys(result.rects), ...Object.keys(result.regions)]);
  return result.errors.map((message) => ({
    kind: 'overflow',
    message,
    targets: targetsOfMessage(message, known),
    short: message.includes('region 溢出') ? '视口溢出' : '主轴溢出',
  }));
};

/**
 * 收集全部问题（顺序与 `ui.check` 旧输出一致：布局错误 → 尺寸/越界 → 重叠）。
 *
 * 纯函数：只读入参，不改 rect / errors。
 */
export const collectIssues = (
  parsed: ParsedUi,
  result: LayoutResult,
  viewport: LayoutViewport,
  options: IssueOptions = {},
): UiIssue[] => {
  const anyZero = options.anyZeroDimension === true;
  const issues: UiIssue[] = [...layoutIssues(result)];

  for (const [name, rect] of Object.entries(result.rects)) {
    const zeroW = rect.w <= 0;
    const zeroH = rect.h <= 0;
    const reportZero = anyZero ? zeroW || zeroH : zeroW && zeroH;
    if (reportZero) {
      const both = zeroW && zeroH;
      const short = both ? '尺寸 0×0' : zeroH ? '高度 0' : '宽度 0';
      const message = both
        ? `节点 '${name}' 尺寸 0×0（size=auto 但组件没有 measure()？）`
        : `节点 '${name}' 尺寸 ${formatNumber(rect.w)}×${formatNumber(rect.h)}（${short}，size=auto 但组件没有 measure()？）`;
      issues.push({ kind: 'zero', message, targets: [name], short });
      continue;
    }

    const outside =
      rect.x < -0.01 ||
      rect.y < -0.01 ||
      rect.x + rect.w > viewport.width + 0.01 ||
      rect.y + rect.h > viewport.height + 0.01;
    if (outside) {
      issues.push({
        kind: 'overflow',
        message: `节点 '${name}' 越界：${rectText(rect)}，视口 ${viewportText(viewport)}`,
        targets: [name],
        short: '越界',
      });
    }
  }

  for (const region of parsed.spec.regions) {
    const names = (region.node?.stack?.children ?? [])
      .map((child) => child.name)
      .filter((name): name is string => name !== undefined);
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        const nameA = names[i];
        const nameB = names[j];
        if (nameA === undefined || nameB === undefined) continue;
        const a = result.rects[nameA];
        const b = result.rects[nameB];
        if (a === undefined || b === undefined || a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) continue;
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (overlapX > 0.01 && overlapY > 0.01) {
          issues.push({
            kind: 'overlap',
            message: `节点 '${nameA}' 与 '${nameB}' 重叠 ${formatNumber(overlapX)}×${formatNumber(overlapY)}（region ${region.name}）`,
            targets: [nameA, nameB],
            short: shortOf(`与 ${nameB} 重叠`, '重叠'),
          });
        }
      }
    }
  }

  return issues;
};

/** 汇总行：`共 8 块 / 22 个元素 / 2 处问题（1 溢出、1 尺寸为 0）`。 */
export const summaryOf = (
  regionCount: number,
  elementCount: number,
  issues: readonly UiIssue[],
): string => {
  const counts = new Map<IssueKind, number>();
  for (const issue of issues) counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1);
  const detail = ISSUE_KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0)
    .map((kind) => `${counts.get(kind) ?? 0} ${ISSUE_LABEL[kind]}`)
    .join('、');
  const tail = detail.length > 0 ? `（${detail}）` : '';
  return `共 ${regionCount} 块 / ${elementCount} 个元素 / ${issues.length} 处问题${tail}`;
};
