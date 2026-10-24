/**
 * 快照 diff：两次快照之间「新增 / 消失 / 位移」三类差异。
 *
 * 两层数据分别 diff：
 * - **布局树**：按 path 对得上（`primary` / `cards[0]`），语义清晰；
 * - **绘制记录**：绘制没有稳定 id，按「kind + 资源/文字」分组后用位置就近匹配，
 *   匹配不上就算新增/消失。文字变化（倒计时）会频繁进出，这是预期。
 *
 * 输出有上限（每类最多 50 条），超出的在 summary 里报总数，避免一次刷屏。
 */

import type { Rect } from '../../runtime/src/core/ui/contract';
import type { McpSnapshot, SnapshotDraw } from './snapshot';

export interface MovedRect {
  readonly path: string;
  readonly from: Rect;
  readonly to: Rect;
  readonly delta: { readonly dx: number; readonly dy: number; readonly dw: number; readonly dh: number };
}

export interface LayoutDiff {
  readonly appeared: readonly { readonly path: string; readonly rect: Rect }[];
  readonly disappeared: readonly { readonly path: string; readonly rect: Rect }[];
  readonly moved: readonly MovedRect[];
}

export interface DrawDiff {
  readonly appeared: readonly SnapshotDraw[];
  readonly disappeared: readonly SnapshotDraw[];
  readonly moved: readonly {
    readonly from: SnapshotDraw;
    readonly to: SnapshotDraw;
    readonly delta: { readonly dx: number; readonly dy: number; readonly dw: number; readonly dh: number };
  }[];
}

export interface SnapshotDiff {
  readonly from: string;
  readonly to: string;
  readonly layout: LayoutDiff;
  readonly draws: DrawDiff;
  readonly summary: string;
}

/** 布局位移容差（px）：小于它当噪声，不报 moved。 */
const LAYOUT_TOL = 0.5;
/** 绘制匹配：中心距离 ≤ 它认为是同一次绘制。 */
const MATCH_DISTANCE = 8;
/** 绘制位移容差（px）。 */
const DRAW_TOL = 1;
const MAX_ITEMS = 50;

const center = (rect: Rect): { x: number; y: number } => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

const distance = (a: Rect, b: Rect): number => {
  const ca = center(a);
  const cb = center(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
};

const deltaOf = (a: Rect, b: Rect): MovedRect['delta'] => ({
  dx: Math.round((b.x - a.x) * 100) / 100,
  dy: Math.round((b.y - a.y) * 100) / 100,
  dw: Math.round((b.w - a.w) * 100) / 100,
  dh: Math.round((b.h - a.h) * 100) / 100,
});

const isMoved = (delta: MovedRect['delta']): boolean =>
  Math.abs(delta.dx) > LAYOUT_TOL ||
  Math.abs(delta.dy) > LAYOUT_TOL ||
  Math.abs(delta.dw) > LAYOUT_TOL ||
  Math.abs(delta.dh) > LAYOUT_TOL;

export const diffLayout = (from: Readonly<Record<string, Rect>>, to: Readonly<Record<string, Rect>>): LayoutDiff => {
  const appeared: { path: string; rect: Rect }[] = [];
  const disappeared: { path: string; rect: Rect }[] = [];
  const moved: MovedRect[] = [];
  for (const [path, rect] of Object.entries(to)) {
    const old = from[path];
    if (old === undefined) {
      appeared.push({ path, rect });
      continue;
    }
    const delta = deltaOf(old, rect);
    if (isMoved(delta)) moved.push({ path, from: old, to: rect, delta });
  }
  for (const [path, rect] of Object.entries(from)) {
    if (to[path] === undefined) disappeared.push({ path, rect });
  }
  return { appeared, disappeared, moved };
};

/** 同一「种」绘制才能互相匹配：类型 + 资源名 + 文字内容。 */
const drawKey = (draw: SnapshotDraw): string => `${draw.kind}|${draw.asset ?? ''}|${draw.text ?? ''}`;

const hasRect = (draw: SnapshotDraw): draw is SnapshotDraw & { rect: Rect } => draw.rect !== undefined;

/**
 * 绘制记录 diff：同种绘制按中心距离贪心匹配（≤8px），匹配不上算新增/消失。
 *
 * 为什么不做「按 z 序号一一对应」：z 会因为新增/删除一条绘制整体后移，
 * 一改就全变，报出来的全是噪声。
 */
export const diffDraws = (from: readonly SnapshotDraw[], to: readonly SnapshotDraw[]): DrawDiff => {
  const appeared: SnapshotDraw[] = [];
  const disappeared: SnapshotDraw[] = [];
  const moved: DrawDiff['moved'][number][] = [];

  const toWithRect = to.filter(hasRect);
  const toNoRect = to.filter((draw) => !hasRect(draw));
  const used = new Set<SnapshotDraw>();
  for (const old of from) {
    if (!hasRect(old)) {
      // 没有矩形的绘制（fill/stroke 路径、clear）：按 key 精确对一次
      const hit = toNoRect.find((candidate) => !used.has(candidate) && drawKey(candidate) === drawKey(old));
      if (hit !== undefined) used.add(hit);
      else disappeared.push(old);
      continue;
    }
    let best: (SnapshotDraw & { rect: Rect }) | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of toWithRect) {
      if (used.has(candidate)) continue;
      if (drawKey(candidate) !== drawKey(old)) continue;
      const d = distance(old.rect, candidate.rect);
      if (d <= MATCH_DISTANCE && d < bestDistance) {
        best = candidate;
        bestDistance = d;
      }
    }
    if (best === null) {
      disappeared.push(old);
      continue;
    }
    used.add(best);
    const delta = deltaOf(old.rect, best.rect);
    if (Math.abs(delta.dx) > DRAW_TOL || Math.abs(delta.dy) > DRAW_TOL || Math.abs(delta.dw) > DRAW_TOL || Math.abs(delta.dh) > DRAW_TOL) {
      moved.push({ from: old, to: best, delta });
    }
  }
  for (const draw of to) if (!used.has(draw)) appeared.push(draw);

  return { appeared, disappeared, moved };
};

const cap = <T>(items: readonly T[], label: string): { items: T[]; note: string } => {
  const shown = items.slice(0, MAX_ITEMS).map((item) => item);
  return { items: shown, note: items.length > MAX_ITEMS ? `${label}共 ${items.length} 条，只显示前 ${MAX_ITEMS} 条` : '' };
};

/** 两次快照的完整 diff。 */
export const diffSnapshots = (from: McpSnapshot, to: McpSnapshot): SnapshotDiff => {
  const layout = diffLayout(from.layout, to.layout);
  const draws = diffDraws(from.draws, to.draws);
  const lay = cap(layout.appeared, '布局新增');
  const layGone = cap(layout.disappeared, '布局消失');
  const layMoved = cap(layout.moved, '布局位移');
  const drawNew = cap(draws.appeared, '绘制新增');
  const drawGone = cap(draws.disappeared, '绘制消失');
  const drawMoved = cap(draws.moved, '绘制位移');
  const summary = [
    `布局：新增 ${layout.appeared.length} / 消失 ${layout.disappeared.length} / 位移 ${layout.moved.length}`,
    `绘制：新增 ${draws.appeared.length} / 消失 ${draws.disappeared.length} / 位移 ${draws.moved.length}`,
    ...(lay.note === '' ? [] : [lay.note]),
    ...(layGone.note === '' ? [] : [layGone.note]),
    ...(layMoved.note === '' ? [] : [layMoved.note]),
    ...(drawNew.note === '' ? [] : [drawNew.note]),
    ...(drawGone.note === '' ? [] : [drawGone.note]),
    ...(drawMoved.note === '' ? [] : [drawMoved.note]),
  ].join('；');
  return {
    from: from.name,
    to: to.name,
    layout: { appeared: lay.items, disappeared: layGone.items, moved: layMoved.items },
    draws: { appeared: drawNew.items, disappeared: drawGone.items, moved: drawMoved.items },
    summary,
  };
};
