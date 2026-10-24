/**
 * 列表 / 网格的滚动位与滚动条比例（T38 从 layout.test.ts 拆出）。
 *
 * 从 layout.test.ts 拆出来的原因：单文件 ≤300 行（AGENTS 铁律 2）。
 * 这三个用例只关心「state.scrolls → 布局 props → scrollbar 比例」这一条链。
 */

import { expect, it } from 'vitest';
import { galleryContentHeight } from './gallery';
import { contentHeight, ITEMS, scrollRatios } from './inventory';
import { createLayoutEngine } from './layout';
import { INITIAL_STATE } from './state';
import type { DemoState } from './state';

const engine = createLayoutEngine();
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
];
const stateOf = (screen: DemoState['screen'], hits = 0): DemoState => ({ ...INITIAL_STATE, screen, hits });

it('inventory：列表滚动位 / 滚动条比例 / 选中文字都由状态驱动', () => {
  const scrolled: DemoState = {
    ...stateOf('inventory'),
    scrolls: { list: 200 },
    selected: 2,
  };
  const view = engine.compute('inventory', VIEWPORTS[0]!, scrolled);
  const list = view.rects['list']!;
  const ratios = scrollRatios(contentHeight(), list.h, 200);
  expect(view.props['list']).toMatchObject({ scrollTop: 200, itemH: 56, divider: true });
  expect(view.props['scrollbar']).toMatchObject({ value: ratios.value, viewport: ratios.viewport, thickness: 6 });
  expect(view.props['badge']).toMatchObject({ text: `${ITEMS.length} 件` });
  // 物品 03 的数量 = ((2×7) % 13) + 1 = 2
  expect(view.props['statusText']).toMatchObject({ label: '已选：物品 03 ×2' });
  // 没选中的时候是提示文案
  const fresh = engine.compute('inventory', VIEWPORTS[0]!, stateOf('inventory'));
  expect(fresh.props['statusText']).toMatchObject({ label: '拖动列表滚动，点一项选中' });
});

it('inventory：滚动条 viewport < 1（20 项超过一屏，说明真的有滚动空间）', () => {
  const view = engine.compute('inventory', VIEWPORTS[0]!, stateOf('inventory'));
  expect(view.props['scrollbar']?.['viewport']).toBeLessThan(0.75);
  // 内容总高比列表可视区高出一大截（不是「刚好装下」）
  expect(contentHeight()).toBeGreaterThan((view.rects['list']?.h ?? 0) * 1.5);
});

it('gallery：滚动位与滚动条比例由状态驱动，计数用 badge 显示', () => {
  const scrolled: DemoState = {
    ...stateOf('gallery'),
    scrolls: { list: 300 },
  };
  const view = engine.compute('gallery', VIEWPORTS[0]!, scrolled);
  const list = view.rects['list']!;
  const ratios = scrollRatios(galleryContentHeight(), list.h, 300);
  expect(view.props['list']).toMatchObject({ scrollTop: 300, itemH: 88, divider: true });
  expect(view.props['scrollbar']).toMatchObject({ value: ratios.value, viewport: ratios.viewport });
  expect(view.props['badge']).toMatchObject({ text: '21 个' });
  // 标题来自 `.ui` 的静态 style
  expect(view.props['label']).toMatchObject({ text: '通用组件总览' });
});
