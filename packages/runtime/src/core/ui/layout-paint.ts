/**
 * 绘制顺序与层/命中信息（v0.5）。
 *
 * 从 `layout.ts` 拆出来的原因：`layout.ts` 已 248 行，再塞这段就破 300 行铁律；
 * 而「从 spec 推出绘制序」本身是纯函数，与矩形求解无关，独立更好测。
 *
 * 顺序规则（写死，改之前先问）：
 * - 先按 `layer` 声明序：`base` → `overlay`（overlay 恒在 base 之上）；
 * - 同层内按**声明序**（跨 region 累计）：先声明的先画、在下。
 *
 * 绘制按 `paintOrder` 正序，命中按它逆序 —— 见 `hit.ts` 的 `sortForPaint` / `pickHit`。
 */

import type { LayerName, LayoutSpec, NodeMeta, NodeSpec } from './layout-spec';

/** 层号：与 `hit.ts` 的 `HitEntry.layer` 直接对接（小的先画）。 */
export const LAYER_INDEX: Readonly<Record<LayerName, number>> = { base: 0, overlay: 1 };

/** 层序（后者盖前者）。 */
export const LAYER_ORDER: readonly LayerName[] = ['base', 'overlay'];

export interface PaintInfo {
  readonly paintOrder: readonly string[];
  readonly meta: Readonly<Record<string, NodeMeta>>;
}

/** 遍历 spec 收集绘制顺序与每个命名节点的层/命中信息（纯函数）。 */
export const collectPaint = (spec: LayoutSpec): PaintInfo => {
  const paintOrder: string[] = [];
  const meta: Record<string, NodeMeta> = {};

  const visit = (node: NodeSpec, layer: LayerName, counter: { value: number }): void => {
    if (node.name !== undefined) {
      paintOrder.push(node.name);
      meta[node.name] = {
        layer,
        // 不写 hit 时默认 self：与 v0.4 之前「有 action 才响应」的现有行为等价
        hit: node.hit ?? 'self',
        layerIndex: LAYER_INDEX[layer],
        index: counter.value,
      };
      counter.value += 1;
    }
    for (const child of node.stack?.children ?? []) visit(child, layer, counter);
  };

  for (const layer of LAYER_ORDER) {
    const counter = { value: 0 };
    for (const region of spec.regions) {
      if ((region.layer ?? 'base') !== layer) continue;
      if (region.node !== undefined) visit(region.node, layer, counter);
    }
  }
  return { paintOrder, meta };
};
