/**
 * 玻璃面板与布局的一致性（2026-10-29 修 bug 后新增）。
 *
 * 背景：面板曾经在 `scene.ts` 里写死 `174.56/844`（dock 还是 24% 时代的值）与左右留白 16，
 * `.ui` 把 dock 改成 26.5% 后面板没跟上 —— 用户肉眼在 375×667 下看到播放键顶部凸出面板 16.2px。
 *
 * 这里锁三件事：
 * ① 面板必须**完整包含** dock 里的所有 put（不变量，任何视口都该成立）；
 * ② `上留 == 下留`（= dock 的 pad-y，误差 ≤0.01）；
 * ③ `panel.h == 26.5% × 视口高`、`上留 == 1.5% × 视口高`（锁住设计参数本身）。
 *
 * 第 ③ 条是为了让测试**不是恒真**：把 `.ui` 的 dock 临时改成 30% 时，①②仍会通过，
 * 只有 ③ 会红 —— 这正是「参数被谁悄悄改了」要抓的。
 */

import { describe, expect, it } from 'vitest';
import { solve, panelRectOf } from './scene';
import type { Rect } from './deps';
import { createPlayerRegistry } from './ui-registry';

/** dock 里的两个 put（`primaryControls` 在上、`secondaryRow` 在下）。 */
const DOCK_ITEMS = ['primaryControls', 'secondaryRow'] as const;

const solveAt = (width: number, height: number) =>
  solve({ width, height }, createPlayerRegistry());

const rectOf = (rects: Readonly<Record<string, Rect>>, name: string): Rect => {
  const rect = rects[name];
  if (rect === undefined) throw new Error(`rects 里没有 '${name}'`);
  return rect;
};

for (const [w, h] of [[390, 844], [375, 812], [375, 667], [320, 568]] as const) {
  describe(`玻璃面板 @${w}×${h}`, () => {
    const solved = solveAt(w, h);
    const panel = panelRectOf(solved);
    const top = rectOf(solved.rects, 'primaryControls');
    const bottom = rectOf(solved.rects, 'secondaryRow');

    it('面板存在且完整包含 dock 里的所有 put', () => {
      expect(panel).not.toBeNull();
      if (panel === null) return;
      for (const name of DOCK_ITEMS) {
        const rect = rectOf(solved.rects, name);
        expect(rect.x, `${name}.x`).toBeGreaterThanOrEqual(panel.x - 0.01);
        expect(rect.y, `${name}.y`).toBeGreaterThanOrEqual(panel.y - 0.01);
        expect(rect.x + rect.w, `${name}.right`).toBeLessThanOrEqual(panel.x + panel.w + 0.01);
        expect(rect.y + rect.h, `${name}.bottom`).toBeLessThanOrEqual(panel.y + panel.h + 0.01);
      }
    });

    it('上留 == 下留（误差 ≤0.01）', () => {
      if (panel === null) return;
      const padTop = top.y - panel.y;
      const padBottom = panel.y + panel.h - (bottom.y + bottom.h);
      console.log(
        `[${w}x${h}] panel=${panel.x},${panel.y},${panel.w},${panel.h}`
        + ` primaryControls=${top.x},${top.y},${top.w},${top.h}`
        + ` 上留=${padTop.toFixed(2)} 下留=${padBottom.toFixed(2)}`
        + ` secondaryRow底到面板底=${padBottom.toFixed(2)}`,
      );
      expect(Math.abs(padTop - padBottom)).toBeLessThanOrEqual(0.01);
    });

    it('设计参数锁死：panel.h = 26.5%，上留 = 1.5%（改 dock 会红）', () => {
      if (panel === null) return;
      const padTop = top.y - panel.y;
      expect(panel.h).toBeCloseTo(h * 0.265, 1);
      expect(padTop).toBeCloseTo(h * 0.015, 1);
    });
  });
}
