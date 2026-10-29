/**
 * L2 对拍：`partsOf()` 算出的 10 个内部件 vs 设计稿（SPEC.md ③ 的黄金值，由 bake.mjs 实测）。
 *
 * 这 10 项在 `.ui` 里**不该出现**（扁平布局会把它们按 stage 的 column 流堆开），
 * 只能由组件内部算出 —— 所以这里是它们唯一的断言出口。
 */

import { describe, expect, it } from 'vitest';
import {
  controlsRowPartsOf, PRIMARY_CONTROLS, SECONDARY_CONTROLS, progressBarPartsOf,
} from './parts';
import type { Rect } from './deps';

const TOL = 2;

/** 三个复合组件在 390×844 下的 box（由 L1 的 layout 结果保证，见 layout-diff.test.ts）。 */
const PROGRESS_BOX: Rect = { x: 36, y: 565.92, w: 318, h: 44 };
const PRIMARY_BOX: Rect = { x: 28, y: 659.44, w: 334, h: 84 };
const SECONDARY_BOX: Rect = { x: 28, y: 782, w: 334, h: 44 };

interface Golden {
  readonly name: string;
  readonly rect: Rect;
}

/** SPEC.md ③ 的 10 个内部件（原样抄，四位小数）。 */
const GOLDEN: readonly Golden[] = [
  { name: 'progressTrack', rect: { x: 36, y: 565.92, w: 318, h: 18 } },
  { name: 'timeRow', rect: { x: 36, y: 591.92, w: 318, h: 18 } },
  { name: 'timeCurrent', rect: { x: 36, y: 591.92, w: 60, h: 18 } },
  { name: 'timeTotal', rect: { x: 294, y: 591.92, w: 60, h: 18 } },
  { name: 'prevBtn', rect: { x: 69, y: 675.44, w: 52, h: 52 } },
  { name: 'playBtn', rect: { x: 153, y: 659.44, w: 84, h: 84 } },
  { name: 'nextBtn', rect: { x: 269, y: 675.44, w: 52, h: 52 } },
  { name: 'repeatBtn', rect: { x: 28, y: 782, w: 44, h: 44 } },
  { name: 'likeBtn', rect: { x: 173, y: 782, w: 44, h: 44 } },
  { name: 'listBtn', rect: { x: 318, y: 782, w: 44, h: 44 } },
];

const at = (rects: readonly Rect[], index: number): Rect => {
  const rect = rects[index];
  if (rect === undefined) throw new Error(`controlsRowPartsOf 少了第 ${index} 个矩形`);
  return rect;
};

const parts = progressBarPartsOf(PROGRESS_BOX);
const primary = controlsRowPartsOf(PRIMARY_BOX, PRIMARY_CONTROLS);
const secondary = controlsRowPartsOf(SECONDARY_BOX, SECONDARY_CONTROLS);

/** 内部件名 → 由组件算出的矩形。 */
const actualOf = (name: string): Rect | undefined => {
  switch (name) {
    case 'progressTrack': return parts.track;
    case 'timeRow': return parts.timeRow;
    case 'timeCurrent': return parts.timeCurrent;
    case 'timeTotal': return parts.timeTotal;
    case 'prevBtn': return at(primary, 0);
    case 'playBtn': return at(primary, 1);
    case 'nextBtn': return at(primary, 2);
    case 'repeatBtn': return at(secondary, 0);
    case 'likeBtn': return at(secondary, 1);
    case 'listBtn': return at(secondary, 2);
    default: return undefined;
  }
};

const deltaOf = (got: Rect, want: Rect): number => Math.max(
  Math.abs(got.x - want.x), Math.abs(got.y - want.y), Math.abs(got.w - want.w), Math.abs(got.h - want.h),
);

describe('L2 内部件对拍（partsOf vs 设计稿黄金值）', () => {
  it('覆盖 10 项内部件', () => {
    expect(GOLDEN).toHaveLength(10);
  });

  for (const golden of GOLDEN) {
    it(`${golden.name} 误差 ≤ ${TOL}px`, () => {
      const got = actualOf(golden.name);
      expect(got).toBeDefined();
      if (got === undefined) return;
      const delta = deltaOf(got, golden.rect);
      expect(
        delta,
        `${golden.name} 算出来 ${JSON.stringify(got)}，设计稿 ${JSON.stringify(golden.rect)}，Δ=${delta.toFixed(3)}`,
      ).toBeLessThanOrEqual(TOL);
    });
  }

  it('10 项里的最大误差（便于报告引用）', () => {
    let worst = -1;
    let worstName = GOLDEN[0]?.name ?? '';
    for (const golden of GOLDEN) {
      const got = actualOf(golden.name);
      if (got === undefined) continue;
      const delta = deltaOf(got, golden.rect);
      if (delta > worst) {
        worst = delta;
        worstName = golden.name;
      }
    }
    expect(worst, `最大误差在 ${worstName}`).toBeLessThanOrEqual(TOL);
    console.log(`[L2] 10 项最大误差 = ${worst.toFixed(4)}px（在 ${worstName}）`);
  });
});
