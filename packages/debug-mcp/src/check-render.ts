/**
 * `checkRender`：布局树 vs 本帧绘制记录的对照检查。
 *
 * 要回答的是《万历求生录》那一类 bug：**数据全绿、画面全空**。
 * 所以这里不对比数据，只对比「应该在的矩形」与「实际画了的矩形」。
 *
 * 三类判定（对应 PLAN §8.2）：
 * - `layoutOnly`：布局里有、绘制里完全没有 → 最严重（算了没画）
 * - `drawOnly`：绘制了、但布局里没有对应元素 → 画了不该画的
 * - `offset`：有同形状绘制，但矩形偏差 > 2px → 错位
 *
 * 两个诚实的限制（写在这里，避免下一个人当 bug 改）：
 * 1. 布局树没有「这个元素应该由什么绘制」的元数据，只能按形状匹配。
 *    文本类元素（title/hint/…）天然没有同形状底板，归入 `warnings` 而不是错误；
 *    面积大、名字不像文本的元素如果只有文字/图标，也会进 `warnings`，提示「底板可能没画」。
 * 2. 全屏背景/遮罩不算「该元素的绘制」：它们的面积远大于元素，不参与 box 匹配。
 */

import type { Rect } from '../../runtime/src/core/ui/contract';
import type { McpSnapshot, SnapshotDraw } from './snapshot';

export interface LayoutOnlyIssue {
  readonly path: string;
  readonly rect: Rect;
  /** 元素矩形被任何绘制覆盖的比例（0~1，5×5 采样） */
  readonly coverage: number;
}

export interface DrawOnlyIssue {
  readonly z: number;
  readonly kind: string;
  readonly rect: Rect;
  readonly asset?: string;
  readonly text?: string;
}

export interface OffsetIssue {
  readonly path: string;
  readonly layout: Rect;
  readonly matched: Rect;
  readonly delta: { readonly dx: number; readonly dy: number; readonly dw: number; readonly dh: number };
}

export interface RenderWarning {
  readonly path: string;
  readonly rect: Rect;
  readonly coverage: number;
  readonly reason: string;
}

export interface CheckRenderResult {
  readonly ok: boolean;
  readonly snapshot: string;
  readonly checked: number;
  readonly layoutOnly: readonly LayoutOnlyIssue[];
  readonly drawOnly: readonly DrawOnlyIssue[];
  readonly offset: readonly OffsetIssue[];
  readonly warnings: readonly RenderWarning[];
  readonly summary: string;
}

const EPS = 0.01;
const OFFSET_TOL = 2;
/** 小于这个面积的绘制不参与「画了但布局没有」：文字锚点只有 1×1。 */
const MIN_DRAW_AREA = 16;
/** 采样覆盖率 ≥ 这个值就认为「该元素有绘制」（多个绘制拼出来的区域，如格子阵）。 */
const COVERED_RATIO = 0.3;
/** 文本类元素名：它们本来就没有同形状底板。 */
const TEXT_LIKE = /(title|text|label|hint|caption|tip)/i;

const area = (rect: Rect): number => Math.max(0, rect.w) * Math.max(0, rect.h);

const rectDelta = (a: Rect, b: Rect): { dx: number; dy: number; dw: number; dh: number } => ({
  dx: Math.round((b.x - a.x) * 100) / 100,
  dy: Math.round((b.y - a.y) * 100) / 100,
  dw: Math.round((b.w - a.w) * 100) / 100,
  dh: Math.round((b.h - a.h) * 100) / 100,
});

const intersectionArea = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

const iou = (a: Rect, b: Rect): number => {
  const inter = intersectionArea(a, b);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
};

const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x - EPS &&
  inner.y >= outer.y - EPS &&
  inner.x + inner.w <= outer.x + outer.w + EPS &&
  inner.y + inner.h <= outer.y + outer.h + EPS;

const pointInRect = (x: number, y: number, rect: Rect): boolean =>
  x >= rect.x - EPS && y >= rect.y - EPS && x <= rect.x + rect.w + EPS && y <= rect.y + rect.h + EPS;

/** 5×5 采样：元素矩形被绘制覆盖的比例。 */
const coverageOf = (rect: Rect, draws: readonly SnapshotDraw[]): number => {
  if (rect.w <= 0 || rect.h <= 0) return 0;
  const elementArea = area(rect);
  // 背景级绘制（面积远大于元素，比如全屏底图/遮罩）不算「这个元素被画了」：
  // 否则任何元素都被背景覆盖 100%，「算了没画」永远检测不出来。
  const relevant = draws.filter((draw) => draw.rect !== undefined && area(draw.rect) <= elementArea * 3);
  let hit = 0;
  let total = 0;
  for (let i = 0; i < 5; i += 1) {
    for (let j = 0; j < 5; j += 1) {
      total += 1;
      const x = rect.x + (rect.w * (i + 0.5)) / 5;
      const y = rect.y + (rect.h * (j + 0.5)) / 5;
      if (relevant.some((draw) => draw.rect !== undefined && pointInRect(x, y, draw.rect))) hit += 1;
    }
  }
  return total === 0 ? 0 : Math.round((hit / total) * 100) / 100;
};

/** 找与布局元素同形状的绘制（九宫格 / 矩形 / 图片），返回匹配最好的一条。 */
const boxMatchOf = (rect: Rect, draws: readonly SnapshotDraw[]): SnapshotDraw | null => {
  let best: SnapshotDraw | null = null;
  let bestScore = 0;
  for (const draw of draws) {
    if (draw.rect === undefined) continue;
    const candidate = draw.rect;
    // 同形状（IoU 高）或「这次绘制把元素整个盖住且不是背景级的大块」
    const score = iou(rect, candidate);
    const containing = contains(candidate, rect) && area(candidate) <= area(rect) * 3;
    const value = containing ? Math.max(score, 0.5) : score;
    if (value >= 0.5 && value > bestScore) {
      best = draw;
      bestScore = value;
    }
  }
  return best;
};

const textHitOf = (rect: Rect, draws: readonly SnapshotDraw[]): boolean =>
  draws.some(
    (draw) =>
      draw.kind === 'text' &&
      draw.rect !== undefined &&
      pointInRect(draw.rect.x + draw.rect.w / 2, draw.rect.y + draw.rect.h / 2, rect),
  );

/** 容器不是绘制元素：safe、零矩形、接近整屏的根节点都跳过。 */
const isContainer = (path: string, rect: Rect, screen: { width: number; height: number } | undefined): boolean => {
  if (path === 'safe' || path === 'root' || path === 'screen') return true;
  if (rect.w <= 0 || rect.h <= 0) return true;
  if (screen !== undefined && screen.width > 0 && screen.height > 0) {
    if (area(rect) >= screen.width * screen.height * 0.95) return true;
  }
  return false;
};

/**
 * 对照检查。
 *
 * `snapshot` 必须已经归一化好布局（`snapshot.ts` 的 `captureSnapshot` / `readSnapshot`）。
 */
export const checkRender = (snapshot: McpSnapshot): CheckRenderResult => {
  const draws = snapshot.draws;
  const screen = snapshot.canvas.screen ?? snapshot.game.screen;
  const layoutOnly: LayoutOnlyIssue[] = [];
  const drawOnly: DrawOnlyIssue[] = [];
  const offset: OffsetIssue[] = [];
  const warnings: RenderWarning[] = [];
  const checkedPaths: string[] = [];

  for (const [path, rect] of Object.entries(snapshot.layout)) {
    if (isContainer(path, rect, screen)) continue;
    checkedPaths.push(path);
    const coverage = coverageOf(rect, draws);
    const matched = boxMatchOf(rect, draws);
    if (matched?.rect !== undefined) {
      const delta = rectDelta(rect, matched.rect);
      const bad =
        Math.abs(delta.dx) > OFFSET_TOL ||
        Math.abs(delta.dy) > OFFSET_TOL ||
        Math.abs(delta.dw) > OFFSET_TOL ||
        Math.abs(delta.dh) > OFFSET_TOL;
      if (bad) offset.push({ path, layout: rect, matched: matched.rect, delta });
      continue;
    }
    // 多个绘制拼出来的区域（格子阵、列表行）：覆盖率够高也算画了
    if (coverage >= COVERED_RATIO) continue;
    const textHit = textHitOf(rect, draws);
    if (textHit) {
      warnings.push({
        path,
        rect,
        coverage,
        reason: TEXT_LIKE.test(path) ? '文本元素：只有文字绘制（正常）' : '只有文字/图标，没有同形状底板（可能是漏画面板）',
      });
      continue;
    }
    layoutOnly.push({ path, rect, coverage });
  }

  // 画了但布局里没有：面积够大、且不与任何**非容器**布局元素相交
  // （不排除容器的话，全屏背景/fill 会和 safe 相交，drawOnly 永远为空）
  const layoutRects = Object.entries(snapshot.layout)
    .filter(([path, rect]) => !isContainer(path, rect, screen))
    .map(([, rect]) => rect);
  for (const draw of draws) {
    if (draw.rect === undefined) continue;
    if (area(draw.rect) < MIN_DRAW_AREA) continue;
    const touches = layoutRects.some((rect) => intersectionArea(rect, draw.rect as Rect) > EPS);
    if (touches) continue;
    drawOnly.push({ z: draw.z, kind: draw.kind, rect: draw.rect, asset: draw.asset, text: draw.text });
  }

  const parts = [
    `${checkedPaths.length} 个布局元素`,
    `${layoutOnly.length} 个布局有但没画`,
    `${drawOnly.length} 个画了但布局没有`,
    `${offset.length} 处偏移 >${OFFSET_TOL}px`,
  ];
  if (warnings.length > 0) parts.push(`${warnings.length} 处提示`);
  return {
    ok: layoutOnly.length === 0 && drawOnly.length === 0 && offset.length === 0,
    snapshot: snapshot.name,
    checked: checkedPaths.length,
    layoutOnly,
    drawOnly,
    offset,
    warnings,
    summary: parts.join(' · '),
  };
};
