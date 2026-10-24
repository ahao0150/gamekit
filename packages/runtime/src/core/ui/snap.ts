/**
 * 吸附判定（T22）：拖拽元素松手时找最近的落点。
 *
 * 为什么用「元素中心 → 目标中心」的距离，而不是边缘距离：大槽位（比如整行 200px 宽）
 * 的边缘距离永远很小，会把明显不相关的远处元素吸过去；中心距离才符合「拖到它身上」的直觉。
 *
 * 规则（写死，单测锁住）：
 * - 多个目标都在半径内 → 取最近的；距离相同 → 取数组里**先出现**的（稳定，不随机）；
 * - `radius <= 0` / 空目标 / 坏坐标 → `null`；不改入参。
 */

import type { HitPoint } from './hit';
import type { Rect } from './contract';

/** 一个吸附目标（槽位 / 格子 / 角色站位）。 */
export interface SnapTarget {
  readonly id: string;
  readonly rect: Rect;
}

/** 吸附结果。 */
export interface SnapResult {
  readonly id: string;
  /** 元素中心到目标中心的距离（像素） */
  readonly distance: number;
  /** 目标矩形（拷贝，调用方改它不影响入参） */
  readonly rect: Rect;
}

const centerOf = (rect: Rect): HitPoint => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

/** 在 `radius` 内找最近的吸附目标；没有就 `null`。 */
export function snapTo(center: HitPoint, targets: readonly SnapTarget[], radius: number): SnapResult | null {
  if (!Number.isFinite(radius) || !(radius > 0) || targets.length === 0) return null;
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
  let best: SnapResult | null = null;
  for (const target of targets) {
    const targetCenter = centerOf(target.rect);
    const distance = Math.hypot(center.x - targetCenter.x, center.y - targetCenter.y);
    if (!Number.isFinite(distance) || distance > radius) continue;
    // 严格小于才替换：距离相同保留先出现的（稳定，不依赖遍历顺序的随机性）
    if (best === null || distance < best.distance) {
      best = { id: target.id, distance, rect: { x: target.rect.x, y: target.rect.y, w: target.rect.w, h: target.rect.h } };
    }
  }
  return best;
}
