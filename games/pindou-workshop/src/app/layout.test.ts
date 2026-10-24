// 布局与自绘区几何（T63）：三个视口下四块区域互不重叠、色块池完整可见、HUD 铺满宽
import { expect, it } from 'vitest';
import { createLayoutEngine } from './layout';
import { boardGeomOf, ironGeomOf, poolPos, slotPos } from './board-geom';
import { findOverlaps } from './deps';
import { GRID } from './levels';
import { INITIAL_STATE, reduce } from './state';
import { FULL_ITEMS } from './items';

const VIEWPORTS = [
  { width: 440, height: 956 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;

const engine = createLayoutEngine();
const boardState = reduce(INITIAL_STATE, { kind: 'startLevel', levelId: 1 });
/** 有广告入口的盘面（第 2 关）：需要先解锁，否则 startLevel 会被钳回第 1 关 */
const boardAdsState = (() => {
  const unlocked = reduce(INITIAL_STATE, {
    kind: 'restore',
    progress: { unlocked: 2, clears: 0, best: {}, sound: true, music: true, itemLeft: FULL_ITEMS },
  });
  return reduce(unlocked, { kind: 'startLevel', levelId: 2 });
})();
const ironState = (() => {
  let s = boardState;
  let guard = 300;
  while (s.screen === 'board' && guard-- > 0) {
    const p = s.pieces.find((q) => !q.placed)!;
    const idx = s.grid.findIndex((v, i) => v === p.color && !s.pieces.some((q) => q.loc.t === 'grid' && q.loc.i === i));
    s = reduce(s, { kind: 'drop', pieceId: p.id, target: { t: 'grid', i: idx } });
  }
  return s;
})();

/** 三个广告按钮的并集 = 道具条那一条带（首关没有按钮，用占位组件的 rect） */
const toolBarBandOf = (view: ReturnType<typeof engine.compute>) => {
  const direct = view.rects['toolBar'];
  if (direct !== undefined) return direct;
  const buttons = [view.rects['secondaryButton'], view.rects['primaryButton'], view.rects['button']].filter(
    (r): r is NonNullable<typeof r> => r !== undefined,
  );
  if (buttons.length === 0) return null;
  const x = Math.min(...buttons.map((b) => b.x));
  const y = Math.min(...buttons.map((b) => b.y));
  const right = Math.max(...buttons.map((b) => b.x + b.w));
  const bottom = Math.max(...buttons.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
};

it('board：盘面 / 临时位 / 色块池 / 道具条 四个矩形互不重叠（三个视口 × 首关/有广告两种盘面）', () => {
  for (const vp of VIEWPORTS) {
    for (const st of [boardState, boardAdsState]) {
      const where = `${vp.width}×${vp.height} 第${st.levelId}关`;
      const view = engine.compute('board', { width: vp.width, height: vp.height }, st);
      expect(view.errors, `${where} 布局有错`).toEqual([]);
      const area = view.rects['boardArea']!;
      const spawn = st.pieces.filter((p) => p.loc.t === 'spawn').length;
      const g = boardGeomOf(area, spawn, st.tempSlots);
      const toolBar = toolBarBandOf(view);
      expect(toolBar, `${where} 找不到道具条矩形`).not.toBeNull();
      const overlaps = findOverlaps({ play: g.bands.play, slot: g.bands.slot, pool: g.bands.pool, toolBar: toolBar! });
      expect(overlaps, `${where} 区域重叠：${JSON.stringify(overlaps)}`).toEqual([]);
      for (const [name, rect] of Object.entries({ play: g.bands.play, slot: g.bands.slot, pool: g.bands.pool, toolBar: toolBar! })) {
        expect(rect.y, `${where} ${name} 上越界`).toBeGreaterThanOrEqual(-0.01);
        expect(rect.y + rect.h, `${where} ${name} 下越界`).toBeLessThanOrEqual(vp.height + 0.01);
      }
    }
  }
});

it('board：第 1 关没有广告入口，第 2 关起有 3 个（含禁用态）', () => {
  for (const vp of VIEWPORTS) {
    const first = engine.compute('board', { width: vp.width, height: vp.height }, boardState);
    expect(first.rects['secondaryButton'], '第 1 关不该有广告按钮').toBeUndefined();
    expect(first.rects['primaryButton']).toBeUndefined();
    const ads = engine.compute('board', { width: vp.width, height: vp.height }, boardAdsState);
    expect(ads.rects['secondaryButton']).toBeDefined();
    expect(ads.rects['primaryButton']).toBeDefined();
    expect(ads.rects['button']).toBeDefined();
    // canRewarded=false 的引擎：三个按钮全是禁用态（文案里有次数）
    expect(ads.props['secondaryButton']!.label).toContain('提示');
    expect(ads.props['primaryButton']!.disabled).toBe(true);
  }
});

it('board：色块池最后一行完整可见（含 440×956 那种宽屏）', () => {
  for (const vp of VIEWPORTS) {
    const view = engine.compute('board', { width: vp.width, height: vp.height }, boardState);
    const area = view.rects['boardArea']!;
    const spawn = boardState.pieces.filter((p) => p.loc.t === 'spawn');
    const g = boardGeomOf(area, spawn.length, boardState.tempSlots);
    const last = poolPos(g, spawn.length - 1);
    expect(last.s, `${vp.width} 色块池格边为 0`).toBeGreaterThan(4);
    expect(last.y + last.s, `${vp.width} 最后一行被裁`).toBeLessThanOrEqual(vp.height + 0.01);
    expect(last.x, `${vp.width} 池子左边越界`).toBeGreaterThanOrEqual(area.x - 0.01);
    expect(last.x + last.s, `${vp.width} 池子右边越界`).toBeLessThanOrEqual(vp.width + 0.01);
  }
});

it('board：盘面是正方形、格子数 = GRID²、且落在盘面带内', () => {
  for (const vp of VIEWPORTS) {
    const view = engine.compute('board', { width: vp.width, height: vp.height }, boardState);
    const area = view.rects['boardArea']!;
    const g = boardGeomOf(area, boardState.pieces.length, boardState.tempSlots);
    expect(g.size).toBeCloseTo(g.cell * GRID, 5);
    expect(g.by).toBeGreaterThanOrEqual(g.bands.play.y - 0.01);
    expect(g.by + g.size).toBeLessThanOrEqual(g.bands.play.y + g.bands.play.h + 0.01);
    expect(g.bx + g.size).toBeLessThanOrEqual(vp.width + 0.01);
  }
});

it('board：临时位格不互相压，且在临时位带内（4 个空位时最窄视口也放得下）', () => {
  for (const vp of VIEWPORTS) {
    const view = engine.compute('board', { width: vp.width, height: vp.height }, boardState);
    const area = view.rects['boardArea']!;
    const g = boardGeomOf(area, boardState.pieces.length, 4);
    const slots = [0, 1, 2, 3].map((k) => slotPos(g, k));
    for (let i = 0; i < slots.length; i += 1) {
      expect(slots[i]!.x + slots[i]!.s).toBeLessThanOrEqual(vp.width + 0.01);
      expect(slots[i]!.y).toBeGreaterThanOrEqual(g.bands.slot.y - 0.01);
      expect(slots[i]!.y + slots[i]!.s).toBeLessThanOrEqual(g.bands.slot.y + g.bands.slot.h + 0.01);
    }
  }
});

it('HUD 带铺满视口宽（不是只占左边一截）', () => {
  for (const vp of VIEWPORTS) {
    const view = engine.compute('board', { width: vp.width, height: vp.height }, boardState);
    const panel = view.rects['panel']!;
    expect(panel.w, `${vp.width} HUD 带没铺满`).toBeCloseTo(vp.width, 1);
    expect(panel.x).toBeCloseTo(0, 1);
  }
});

it('iron：盘面与温度条不重叠、都在 boardArea 内', () => {
  for (const vp of VIEWPORTS) {
    const view = engine.compute('iron', { width: vp.width, height: vp.height }, ironState);
    expect(view.errors, `${vp.width} iron 布局有错`).toEqual([]);
    const area = view.rects['boardArea']!;
    const g = ironGeomOf(area);
    expect(findOverlaps({ board: { x: g.bx, y: g.by, w: g.size, h: g.size }, bar: g.bar })).toEqual([]);
    expect(g.bar.y + g.bar.h).toBeLessThanOrEqual(area.y + area.h + 0.01);
    expect(g.cell).toBeGreaterThan(4);
  }
});
it('home：标题浮层不压按钮、且装饰文字是 hit none（320×568 曾压住「开始拼豆」导致点不动）', () => {
  for (const vp of VIEWPORTS) {
    const view = engine.compute('home', { width: vp.width, height: vp.height }, INITIAL_STATE);
    expect(view.errors, `${vp.width} home 布局有错`).toEqual([]);
    const title = view.rects['label']!;
    const subtitle = view.rects['statusText']!;
    const primary = view.rects['primaryButton']!;
    const secondary = view.rects['secondaryButton']!;
    const overlaps = findOverlaps({ title, subtitle, primary, secondary });
    expect(overlaps, `${vp.width}×${vp.height} 标题压按钮：${JSON.stringify(overlaps)}`).toEqual([]);
    // 命中语义：overlay 里的文案默认 hit=self，压到按钮上就会把点击吃掉（点了没反应）
    expect(view.meta['label']!.hit, '标题必须 hit none').toBe('none');
    expect(view.meta['statusText']!.hit, '副标题必须 hit none').toBe('none');
    expect(title.y).toBeGreaterThanOrEqual(0);
    expect(subtitle.y + subtitle.h).toBeLessThanOrEqual(primary.y);
  }
});
it('result：提示语有非零宽度（statusText 的 base label 为空 → 量出 0 宽会把字号压到 1px，看不见）', () => {
  const won = { ...boardState, screen: 'result' as const, outcome: 'win' as const, toast: '熨烫完成！' };
  for (const vp of VIEWPORTS) {
    const view = engine.compute('result', { width: vp.width, height: vp.height }, won);
    expect(view.errors, `${vp.width} result 布局有错`).toEqual([]);
    const status = view.rects['statusText']!;
    expect(status.w, `${vp.width} 提示语宽度为 0（字号会被压到 1px）`).toBeGreaterThan(40);
    expect(view.props['statusText']!.label, '提示语文案没注入').toBe('熨烫完成！');
    // 按钮不能被提示语压住
    expect(findOverlaps({ status, primary: view.rects['primaryButton']!, secondary: view.rects['secondaryButton']! })).toEqual([]);
  }
});