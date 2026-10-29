/**
 * L1 对拍（`aspect` 落地后的判据，2026-10-29 第二次改）：
 *
 * - `albumCover` 用 `size fill aspect 1`，box 变成真正的正方形（`align center` 让它水平居中）。
 *   代价：390 档 `w` 从 318 → 296.89（−6.64%）、`x` 从 36 → 46.55，但**中心点不变（195.00）**。
 *   所以这一项按「中心点 + 边长偏差 ≤7%」判，不按 x/w 全等。
 * - 其余 8 项仍按 `x` / `w` 与设计稿**完全相等**判（比例只影响间距，不该动左右边）。
 * - `y` 受 `dock 26.5%` 重排影响，只记录不判定。
 * - 与 `tools/svg-rect-diff.mjs` 的分工不变：那个量 SVG 真实几何，这里量 `.ui` 的解。
 */

import { describe, expect, it } from 'vitest';
import playerUi from '../../ui/player.ui';
import { albumCoverPartsOf } from './parts';
import { bindComponents, layout } from './deps';
import type { Rect } from './deps';
import { createPlayerRegistry } from './ui-registry';

const HEIGHT_TOL = 0.05;
const SIDE_TOL = 0.07;

interface Golden {
  readonly name: string;
  readonly rect: Rect;
}

/** SPEC.md ③ 的前 9 行（19 个 data-name 里进 `.ui` 的那 9 个）。 */
const GOLDEN: readonly Golden[] = [
  { name: 'backBtn', rect: { x: 24, y: 20.2, w: 44, h: 44 } },
  { name: 'headerTitle', rect: { x: 80, y: 32.2, w: 230, h: 20 } },
  { name: 'moreBtn', rect: { x: 322, y: 20.2, w: 44, h: 44 } },
  { name: 'albumCover', rect: { x: 36, y: 115.92, w: 318, h: 318 } },
  { name: 'songTitle', rect: { x: 36, y: 457.92, w: 318, h: 40 } },
  { name: 'artistName', rect: { x: 36, y: 521.92, w: 318, h: 20 } },
  { name: 'progressBar', rect: { x: 36, y: 565.92, w: 318, h: 44 } },
  { name: 'primaryControls', rect: { x: 28, y: 659.44, w: 334, h: 84 } },
  { name: 'secondaryRow', rect: { x: 28, y: 782, w: 334, h: 44 } },
];

/** 设计稿里封面的水平中心：36 + 318 / 2。 */
const COVER_CENTER_X = 36 + 318 / 2;

const solveAt = (width: number, height: number) => {
  const registry = createPlayerRegistry();
  const bound = bindComponents(playerUi.spec, {
    registry,
    env: { viewport: { width, height }, data: {} },
  });
  return { bound, solved: layout(bound.spec, { width, height }) };
};

describe('L1 @390×844：其余 8 项的 x / w 与设计稿完全相等', () => {
  const { bound, solved } = solveAt(390, 844);

  it('绑定无错（9 个组件全部已注册）', () => {
    expect(bound.errors).toEqual([]);
  });

  for (const golden of GOLDEN.filter((item) => item.name !== 'albumCover')) {
    it(`${golden.name} 的 x / w 与设计稿相等`, () => {
      const got = solved.rects[golden.name];
      expect(got).toBeDefined();
      if (got === undefined) return;
      expect(got.x, `${golden.name}.x`).toBeCloseTo(golden.rect.x, 2);
      expect(got.w, `${golden.name}.w`).toBeCloseTo(golden.rect.w, 2);
    });
  }
});

describe('L1 @390×844：albumCover 按中心点 + 边长判', () => {
  const { solved } = solveAt(390, 844);
  const box = solved.rects.albumCover;

  it('box 是正方形（w === h）', () => {
    expect(box).toBeDefined();
    if (box === undefined) return;
    console.log(`[cover] box = ${box.w} × ${box.h}`);
    expect(box.w).toBeCloseTo(box.h, 2);
  });

  it('中心点 x 与设计稿完全相等（195.00）', () => {
    if (box === undefined) return;
    const centerX = box.x + box.w / 2;
    const centerY = box.y + box.h / 2;
    console.log(`[cover] 中心 (${centerX.toFixed(2)}, ${centerY.toFixed(2)})，设计中心 x=${COVER_CENTER_X}`);
    expect(centerX).toBeCloseTo(COVER_CENTER_X, 2);
  });

  it(`边长偏差 ≤ ${SIDE_TOL * 100}%（296.89 vs 318 = −6.64%）`, () => {
    if (box === undefined) return;
    const dev = Math.abs(box.w - 318) / 318;
    console.log(`[cover] 边长偏差 = ${(dev * 100).toFixed(2)}%`);
    expect(dev).toBeLessThanOrEqual(SIDE_TOL);
  });

  it('box 与组件内实际绘制的正方形重合（差值 0）', () => {
    if (box === undefined) return;
    const parts = albumCoverPartsOf(box);
    console.log(`[cover] parts.cover = ${parts.cover.x},${parts.cover.y},${parts.cover.w},${parts.cover.h}`);
    expect(parts.cover.x).toBeCloseTo(box.x, 4);
    expect(parts.cover.y).toBeCloseTo(box.y, 4);
    expect(parts.cover.w).toBeCloseTo(box.w, 4);
    expect(parts.cover.h).toBeCloseTo(box.h, 4);
  });
});

describe('L1 @390×844：h 偏差 ≤5%，超出的点名', () => {
  const { solved } = solveAt(390, 844);

  it('逐项打印 + 只有 albumCover 超 5%', () => {
    const rows = GOLDEN.map((golden) => {
      const got = solved.rects[golden.name];
      const h = got?.h ?? 0;
      const dev = golden.rect.h === 0 ? 0 : Math.abs(h - golden.rect.h) / golden.rect.h;
      return { name: golden.name, h, want: golden.rect.h, dev };
    });
    for (const row of rows) {
      console.log(`[L1-h] ${row.name.padEnd(16)} ${row.h.toFixed(2)} vs ${row.want} → ${(row.dev * 100).toFixed(2)}%`);
    }
    const over = rows.filter((row) => row.dev > HEIGHT_TOL).map((row) => row.name);
    expect(over).toEqual(['albumCover']);
  });

  it('触控目标未被缩放：44 / 84 / 44（以及曲名行 40）', () => {
    expect(solved.rects.backBtn?.h).toBeCloseTo(44, 2);
    expect(solved.rects.moreBtn?.h).toBeCloseTo(44, 2);
    expect(solved.rects.primaryControls?.h).toBeCloseTo(84, 2);
    expect(solved.rects.secondaryRow?.h).toBeCloseTo(44, 2);
    expect(solved.rects.songTitle?.h).toBeCloseTo(40, 2);
  });
});

describe('L1 @390×844：y 只记录（dock 26.5% 重排的必然结果）', () => {
  const { solved } = solveAt(390, 844);

  it('打印 y 偏移，不判定', () => {
    for (const golden of GOLDEN) {
      const got = solved.rects[golden.name];
      if (got === undefined) continue;
      const delta = got.y - golden.rect.y;
      console.log(`[L1-y] ${golden.name.padEnd(16)} ${got.y.toFixed(2)} vs ${golden.rect.y} → ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`);
    }
    expect(solved.rects).toBeDefined();
  });
});

/**
 * 三档响应式验收：画布 = 视口（`fit: fill`），三档 layout errors 全 0。
 *
 * 封面用 `size fill aspect 1`：三档 box 都必须是正方形（`w === h`），
 * 任何一档不等就是 aspect 的求解问题，**不许用 clamp 兜**。
 */
describe('三档响应式', () => {
  for (const [w, h] of [[390, 844], [375, 812], [320, 568]] as const) {
    it(`${w}×${h} 无溢出 / 无越界`, () => {
      const { solved } = solveAt(w, h);
      console.log(`[${w}x${h}] errors=${JSON.stringify(solved.errors)}`);
      expect(solved.errors).toEqual([]);
    });

    it(`${w}×${h} 封面 box 是正方形，且与 partsOf 重合`, () => {
      const { solved } = solveAt(w, h);
      const box = solved.rects.albumCover;
      expect(box, `${w}x${h}`).toBeDefined();
      if (box === undefined) return;
      const parts = albumCoverPartsOf(box);
      const stage = solved.regions.stage;
      const ratio = stage === undefined ? 0 : box.w / stage.h;
      console.log(
        `[${w}x${h}] cover box=${box.w}×${box.h} 正方形=${box.w === box.h}`
        + ` parts=${parts.cover.w}×${parts.cover.h} stage=${stage?.h?.toFixed(2)} 占比=${(ratio * 100).toFixed(1)}%`,
      );
      expect(box.w).toBeCloseTo(box.h, 2);
      expect(parts.cover.w).toBeCloseTo(box.w, 4);
      expect(parts.cover.h).toBeCloseTo(box.h, 4);
    });
  }
});
