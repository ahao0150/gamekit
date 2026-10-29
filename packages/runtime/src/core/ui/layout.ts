/**
 * UI 布局核心（纯函数）。
 *
 * 三个原语表达一整个界面：**region 切带 → stack 一维流 → size 尺寸约束**。
 * 为什么不用绝对坐标：坐标写死在插件里，换屏型就崩；而「切带 + 流式排布 + 约束」
 * 是唯一能在 390×844 / 320×568 / 2046×1407 上都成立的描述方式。
 *
 * 铁律（AGENTS §2）：**纯函数**、不 import canvas / 浏览器任何东西、不读写全局状态。
 * 入参是 spec + viewport，出参是 rect 表 + 错误列表，Node 里可任意枚举屏型。
 *
 * 语义（写死，改之前先问）：
 * - `region`：按 top / bottom / fill 把视口切成若干带，**顺序无关** ——
 *   top 从顶部累加、bottom 从底部累减、fill 吃掉剩余（多个 fill 平分）。
 * - `stack`：容器内一维排布；`gap` 是间距，`align` 是**交叉轴**对齐。
 * - `fill`：主轴吃掉剩余空间；交叉轴由 align 决定（stretch 时拉满）。
 * - `auto`：尺寸由子元素的 `measure()` 决定，没注册 measure 时按 0（不报错，
 *   留给后面的组件注册表补）。
 * - `fixed(n)` / `ratio(r)`：主轴定长 / 占可用空间的比例。
 * - `aspect`（v0.7）：按宽高比从一个**已知轴**推另一轴。交叉轴确定（`cross` 或
 *   `align stretch`）推主轴、主轴确定（`size` 是 fixed/ratio）推交叉轴；两轴都定或
 *   都不定都报错。求解在 `layout-aspect.ts`，**必须在第一遍推进 cursor 之前**算完。
 * - overlay + `at`（v0.6）：region 用**中心点** `(x, y)` + `size` 任意定位，
 *   不参与流；边与高度对 overlay 无意义，可以省略。
 *
 * 溢出一律进 `errors`（中文，带数字），**不抛异常** —— 布局坏了要能一口气
 * 把全部问题列出来，而不是死在第一个。
 *
 * 几何工具（num / round2 / resolveLength / toInsets / deflate / Ctx）在
 * `layout-geometry.ts`，`at` 求解在 `layout-at.ts` —— 拆出去是为了守 300 行上限。
 */

import type { Rect } from './contract';
import type {
  Align,
  Justify,
  LayoutResult,
  LayoutSpec,
  LayoutViewport,
  NodeSpec,
  RegionSpec,
  Size,
  SizeSpec,
  StackSpec,
} from './layout-spec';
import { collectPaint } from './layout-paint';
import { deflate, num, resolveLength, round2, toInsets } from './layout-geometry';
import type { Ctx } from './layout-geometry';
import { resolveAtRect } from './layout-at';
import { crossFromMain, planAspectStack } from './layout-aspect';

// 类型与构造器在 layout-spec.ts；这里原样 re-export，外部只认 `./layout` 一个入口。
export type {
  Align,
  HitMode,
  Justify,
  LayerName,
  LayoutResult,
  LayoutSpec,
  LayoutViewport,
  Length,
  LengthInsets,
  MeasuredSize,
  NodeMeta,
  NodeSpec,
  RegionSpec,
  Size,
  SizeSpec,
  StackSpec,
  StyleProps,
  StyleValue,
} from './layout-spec';
export { LAYER_INDEX, LAYER_ORDER } from './layout-paint';
export { fill, auto, fixed, ratio } from './layout-spec';

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

/** 解析普通（非 fill）尺寸；fill 由调用方单独分配，这里返回 null。 */
function resolveSize(
  size: Size | undefined,
  available: number,
  child: NodeSpec | undefined,
  mainAxis: boolean,
  box: Rect,
): number | null {
  if (size === undefined) return 0;
  if (typeof size === 'number') return num(size);
  switch (size.kind) {
    case 'fixed':
      return num(size.n);
    case 'ratio':
      return num(available * size.r);
    case 'auto': {
      // measure 的入参是父容器可用框（T7：组件按它/视口做尺寸判断）
      const measured = child?.measure?.(box);
      if (measured === undefined) return 0;
      return num(mainAxis ? measured.w : measured.h);
    }
    case 'fill':
      return null;
  }
}

/** 记录节点矩形（匿名节点只递归，不产出）。 */
function placeNode(child: NodeSpec, rect: Rect, ctx: Ctx, path: string): void {
  if (child.name !== undefined) ctx.rects[child.name] = rect;
  if (child.stack !== undefined) layoutStack(rect, child.stack, ctx, child.name ?? `${path}/stack`);
}

/** 一维流排布。 */
function layoutStack(container: Rect, stack: StackSpec, ctx: Ctx, path: string): void {
  const row = stack.direction === 'row';
  const mainLen = row ? container.w : container.h;
  const crossLen = row ? container.h : container.w;
  // gap 的百分比按方向取基数：row → 视口宽，column → 视口高（v0.3）
  const gap = resolveLength(stack.gap, row ? ctx.viewport.width : ctx.viewport.height);
  const align: Align = stack.align ?? 'stretch';
  const justify: Justify = stack.justify ?? 'start';
  const children = stack.children;
  const total = children.length;
  if (total === 0) return;

  // 第一遍：解析主轴尺寸，fill 的留给第二遍
  const rawMains: Array<number | null> = children.map((child) =>
    resolveSize(child.size, mainLen, child, row, container),
  );
  const fixedSum = rawMains.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const gapSum = Math.max(0, total - 1) * gap;
  const flexCount = rawMains.filter((v) => v === null).length;
  const remain = mainLen - fixedSum - gapSum;
  const flexSize = flexCount > 0 ? Math.max(0, remain / flexCount) : 0;

  // aspect（v0.7）：必须在 cursor 推进之前算完（主轴要参与 cursor，不能推到第二遍）。
  // `size fill` + `aspect` 的主轴上限也在这里定下：main = min(flexSize, mainLimit)，
  // 被钳小的差额留在 remain 里 → 进 free 交给 justify（不重新分给别的 fill 元素）。
  const plan = planAspectStack({ children, align, row, mainLen, crossLen, rawMains, flexSize, remain });
  for (const message of plan.errors) ctx.errors.push(`${path}/${message}`);

  // justify（v0.4）：fill 先吃掉剩余空间，**剩下的**才交给主轴对齐分配。
  // 有 fill 时 free 通常为 0，所以 justify 不改变 fill 的现有语义；溢出时不分配负空间。
  const free = plan.free;
  let offset = 0;
  let extraGap = 0;
  if (justify === 'center') offset = free / 2;
  else if (justify === 'end') offset = free;
  else if (justify === 'space-between' && total > 1) extraGap = free / (total - 1);

  if (flexCount === 0 && remain < -0.001) {
    ctx.errors.push(`${path} 主轴溢出：内容需要 ${round2(fixedSum + gapSum)}px，容器只有 ${round2(mainLen)}px（超出 ${round2(-remain)}px）`);
  }
  if (flexCount > 0 && remain < -0.001) {
    ctx.errors.push(`${path} 主轴溢出：定长部分 + 间距已占 ${round2(fixedSum + gapSum)}px，容器只有 ${round2(mainLen)}px（超出 ${round2(-remain)}px）`);
  }

  // 第二遍：放置
  let cursor = (row ? container.x : container.y) + offset;
  children.forEach((child, index) => {
    const main = plan.mains[index] ?? 0;

    // 交叉轴：子元素自己的 align 优先（`.ui` 的 put 可以单独覆盖），否则跟随 stack
    const childAlign: Align = child.align ?? align;
    // aspect 决定的交叉轴优先于 align（stretch 也会让位：否则「size + aspect」在默认
    // stretch 的 stack 里永远算不出交叉轴）
    const solvedCross = plan.solved[index];
    let cross: number;
    if (solvedCross?.kind === 'cross') cross = solvedCross.value;
    else if (solvedCross?.kind === 'fill') cross = crossFromMain(child.aspect ?? 1, row, main);
    else if (childAlign === 'stretch') cross = crossLen;
    else if (child.cross !== undefined) cross = resolveSize(child.cross, crossLen, child, !row, container) ?? 0;
    else {
      const measured = child.measure?.(container);
      cross = measured === undefined ? 0 : num(row ? measured.h : measured.w);
    }
    let crossStart = row ? container.y : container.x;
    if (childAlign === 'center') crossStart += (crossLen - cross) / 2;
    else if (childAlign === 'end') crossStart += crossLen - cross;

    const rect: Rect = row
      ? { x: round2(cursor), y: round2(crossStart), w: round2(main), h: round2(cross) }
      : { x: round2(crossStart), y: round2(cursor), w: round2(cross), h: round2(main) };
    placeNode(child, rect, ctx, `${path}/${child.name ?? index}`);
    cursor += main + gap + extraGap;
  });
}

/** 一条带的高度解析（ratio 相对视口高）。 */
function regionHeight(spec: RegionSpec, viewport: Rect): number {
  if (spec.edge === 'fill') return 0;
  const value = resolveSize(spec.height, viewport.h, undefined, false, viewport);
  return value ?? 0;
}

/** 把视口切成带（顺序无关：只看 edge，不看数组位置）。 */
function layoutRegions(viewport: Rect, specs: readonly RegionSpec[], ctx: Ctx): void {
  const tops = specs.filter((s) => s.edge === 'top');
  const bottoms = specs.filter((s) => s.edge === 'bottom');
  const fills = specs.filter((s) => s.edge === 'fill');

  const topHeights = tops.map((s) => regionHeight(s, viewport));
  const bottomHeights = bottoms.map((s) => regionHeight(s, viewport));
  const usedTop = topHeights.reduce((a, b) => a + b, 0);
  const usedBottom = bottomHeights.reduce((a, b) => a + b, 0);
  const remain = viewport.h - usedTop - usedBottom;
  if (remain < -0.001) {
    ctx.errors.push(
      `region 溢出：top 带共 ${round2(usedTop)}px + bottom 带共 ${round2(usedBottom)}px = ${round2(usedTop + usedBottom)}px，` +
        `视口高只有 ${round2(viewport.h)}px（超出 ${round2(-remain)}px）`,
    );
  }
  const fillHeight = fills.length > 0 ? Math.max(0, remain) / fills.length : 0;

  const emit = (spec: RegionSpec, rect: Rect): void => {
    const padded = deflate(rect, toInsets(spec.padding, ctx.viewport));
    ctx.regions[spec.name] = { x: round2(rect.x), y: round2(rect.y), w: round2(rect.w), h: round2(rect.h) };
    if (spec.node !== undefined) {
      const nodeRect: Rect = { x: round2(padded.x), y: round2(padded.y), w: round2(padded.w), h: round2(padded.h) };
      placeNode(spec.node, nodeRect, ctx, spec.name);
    }
  };

  let cursorY = viewport.y;
  tops.forEach((spec, index) => {
    const h = topHeights[index] ?? 0;
    emit(spec, { x: viewport.x, y: cursorY, w: viewport.w, h });
    cursorY += h;
  });
  fills.forEach((spec, index) => {
    emit(spec, { x: viewport.x, y: cursorY + index * fillHeight, w: viewport.w, h: fillHeight });
  });
  let bottomY = viewport.y + viewport.h;
  bottoms.forEach((spec, index) => {
    const h = bottomHeights[index] ?? 0;
    bottomY -= h;
    emit(spec, { x: viewport.x, y: bottomY, w: viewport.w, h });
  });
}

/**
 * overlay 层求解（v0.5，v0.6 加 `at`）。
 *
 * 默认每个 region 都是**独立的整屏坐标系**（相对视口内边距），不参与 base 的流；
 * 多个 overlay region 天然重叠，声明顺序即叠序。
 *
 * v0.6：写了 `at` + `size` 的 region 不再整屏，而是「中心点 + 宽高」落在指定位置
 * （求解见 `layout-at.ts`）。`justify` / `align` 仍然作用于它**内部**的 put，互不冲突。
 */
function layoutOverlay(viewport: Rect, specs: readonly RegionSpec[], ctx: Ctx): void {
  for (const spec of specs) {
    let box: Rect = viewport;
    if (spec.at !== undefined) {
      if (spec.size === undefined) {
        // 解析器已经拦过一次；这里防手写 spec 漏 size（布局层不静默吃掉 at）
        ctx.errors.push(`region '${spec.name}' 有 at 但缺 size，已按整屏处理`);
      } else {
        box = resolveAtRect(spec.name, { at: spec.at, size: spec.size }, viewport, (message) =>
          ctx.errors.push(message),
        );
      }
    }
    const padded = deflate(box, toInsets(spec.padding, ctx.viewport));
    ctx.regions[spec.name] = {
      x: round2(box.x),
      y: round2(box.y),
      w: round2(box.w),
      h: round2(box.h),
    };
    if (spec.node !== undefined) {
      const nodeRect: Rect = { x: round2(padded.x), y: round2(padded.y), w: round2(padded.w), h: round2(padded.h) };
      placeNode(spec.node, nodeRect, ctx, spec.name);
    }
  }
}

/**
 * 求解：`layout(spec, viewport) → { rects, regions, paintOrder, meta, errors }`。
 *
 * 纯函数：同样的入参永远得到同样的出参，可在 Node 里枚举屏型。
 */
export const layout = (spec: LayoutSpec, viewport: LayoutViewport): LayoutResult => {
  const width = Math.max(0, num(viewport.width));
  const height = Math.max(0, num(viewport.height));
  // 百分比长度的基数用的是**钳制后**的视口尺寸（与 region 高度百分比同一口径）
  const ctx: Ctx = { rects: {}, regions: {}, errors: [], viewport: { width, height } };
  const outer: Rect = { x: 0, y: 0, w: width, h: height };
  const inner = deflate(outer, toInsets(spec.padding, ctx.viewport));
  const viewportRect: Rect = { x: inner.x, y: inner.y, w: inner.w, h: inner.h };
  // 分层求解：base 走现有切带流；overlay 每个 region 独立整屏（或 at 定位）
  layoutRegions(viewportRect, spec.regions.filter((region) => (region.layer ?? 'base') === 'base'), ctx);
  layoutOverlay(viewportRect, spec.regions.filter((region) => region.layer === 'overlay'), ctx);
  const paint = collectPaint(spec);
  return { rects: ctx.rects, regions: ctx.regions, paintOrder: paint.paintOrder, meta: paint.meta, errors: ctx.errors };
};
