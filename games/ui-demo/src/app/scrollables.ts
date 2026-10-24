/**
 * 可滚容器的几何与语义（T38）：哪些节点能滚、内容多高、滚轮落在谁身上。
 *
 * 全部是纯函数，输入只有一个 `ScreenLayout` 快照（`.ui` 求解结果）：
 * - **哪些能滚**：节点名就是组件名（`.ui` 的 `put <组件名>` 约定），`list` / `grid`
 *   支持 `scrollTop`，`scroll` 支持 `scrollTop + contentH`，所以这三类算可滚容器；
 * - **内容多高**：`list` / `grid` 按数据项数 + 行高算（与组件绘制同一口径），
 *   `scroll` 用 `.ui` 里声明的 `contentH`。内容高不在这里钳制 —— 钳制交给
 *   `scrollClamp`，只吐「内容总尺寸」；
 * - **落在谁身上**：按 `paintOrder` **逆序**找第一个包含该点的容器。`.ui` 是扁平布局、
 *   没有真正的嵌套节点，但「外层 scroll 的矩形里压着一个内层 list」在几何上就是嵌套：
 *   内层后画（在上），逆序第一个命中的就是最里层 —— 滚轮只滚它，不接力给外层。
 *
 * 为什么放游戏侧而不是 core：`.ui` 的布局结果（谁盖住谁）是游戏装配层的信息，
 * core 的 `wheel.ts` 只负责「增量 → 新 offset」这一段纯数学。
 */

import type { Rect } from './deps';
// 只取类型：运行时不会有 layout ⇄ scrollables 的循环依赖（`import type` 被擦除）
import type { ScreenLayout } from './layout';

/**
 * 滚轮速度乘子：一格滚轮（web 上通常 100px）乘这个系数。
 *
 * 1.0 在手机画布（390×844）上一次滚轮就翻过一整行还多，手感偏冲；
 * 0.8 → 一格 80px，背包（行高 56）约 1.4 行、总览（行高 88）约 0.9 行，逐格可控。
 * 调这里就能整体改快慢（`scrollByWheel` 的 `speed` 参数）。
 */
export const WHEEL_SPEED = 0.8;

/** 支持滚动位的组件名（与 `list` / `grid` / `scroll` 的 props 对应）。 */
const SCROLL_COMPONENTS: readonly string[] = ['list', 'grid', 'scroll'];

/** 这个组件名是不是可滚容器。 */
export const isScrollComponent = (name: string): boolean => SCROLL_COMPONENTS.includes(name);

/** 从 props 里读一个数字（缺失 / 非法用 fallback）。 */
export const numberPropOf = (props: Readonly<Record<string, unknown>>, key: string, fallback: number): number => {
  const raw = props[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
};

/** 一个可滚容器：名字 + 视口矩形 + 内容总高（像素）。 */
export interface Scrollable {
  readonly name: string;
  readonly rect: Rect;
  readonly contentSize: number;
}

/** 数据快照里的项数（`items` 不是数组就按 0 项算，不崩）。 */
const itemCountOf = (view: ScreenLayout): number => {
  const items = view.data['items'];
  return Array.isArray(items) ? items.length : 0;
};

/**
 * 容器的内容总高。
 *
 * - `scroll`：`.ui` 里写的 `contentH`（内容由游戏回调画，组件不知道有多少内容）；
 * - `grid`：`ceil(项数 / cols)` 行 × `cellH` + 行间距（与 `grid.ts` 的 `pitch` 一致）；
 * - `list`：项数 × `itemH` + 项间距（不含末尾 gap，与 `list-window.ts` 同口径）。
 */
export const scrollContentSizeOf = (view: ScreenLayout, name: string): number => {
  if (!isScrollComponent(name)) return 0;
  const props = view.props[name] ?? {};
  if (name === 'scroll') return Math.max(0, numberPropOf(props, 'contentH', 0));
  const count = itemCountOf(view);
  if (count <= 0) return 0;
  if (name === 'grid') {
    const cols = Math.max(1, Math.floor(numberPropOf(props, 'cols', 4)));
    const cellH = Math.max(0, numberPropOf(props, 'cellH', 56));
    const gapY = Math.max(0, numberPropOf(props, 'gapY', 8));
    const rows = Math.ceil(count / cols);
    return rows * cellH + Math.max(0, rows - 1) * gapY;
  }
  const itemH = Math.max(0, numberPropOf(props, 'itemH', 56));
  const gap = Math.max(0, numberPropOf(props, 'gap', 0));
  return count * itemH + Math.max(0, count - 1) * gap;
};

/** 当前界面的所有可滚容器（按绘制行序，逆序即「从上往下」）。 */
export const scrollablesOf = (view: ScreenLayout): Scrollable[] => {
  const out: Scrollable[] = [];
  for (const name of view.paintOrder) {
    const rect = view.rects[name];
    if (rect === undefined || !isScrollComponent(name)) continue;
    out.push({ name, rect, contentSize: scrollContentSizeOf(view, name) });
  }
  return out;
};

/** 点是否在矩形里（右下边界算外，与命中层同一口径）。 */
const contains = (rect: Rect, point: { readonly x: number; readonly y: number }): boolean =>
  point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h;

/**
 * 滚轮落点 → 要滚的容器；落在所有容器之外返回 null（此时什么都不发生）。
 *
 * 逆序遍历 `paintOrder`：后画的（视觉上更上层）先被检查，所以嵌套时只命中内层。
 */
export const scrollableAt = (view: ScreenLayout, point: { readonly x: number; readonly y: number }): Scrollable | null => {
  const list = scrollablesOf(view);
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const candidate = list[index];
    if (candidate !== undefined && contains(candidate.rect, point)) return candidate;
  }
  return null;
};
