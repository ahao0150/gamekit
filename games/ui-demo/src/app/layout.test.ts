import { expect, it } from 'vitest';
import { GALLERY_ENTRIES, galleryContentHeight } from './gallery';
import { contentHeight, ITEMS, scrollRatios } from './inventory';
import { createLayoutEngine } from './layout';
import { INITIAL_STATE, TARGET } from './state';
import type { BaseScreen, DemoState, Modal, Screen } from './state';

const engine = createLayoutEngine();
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
];
/** 7 个底层界面 */
const BASE_SCREENS: readonly BaseScreen[] = ['menu', 'play', 'result', 'inventory', 'gallery', 'bag', 'nest'];
/** 4 个浮层（T42：不再当底层界面用，布局单独验） */
const MODALS: readonly Modal[] = ['popup', 'sheet', 'half', 'tip'];
const ALL_SCREENS: readonly Screen[] = [...BASE_SCREENS, ...MODALS];
const stateOf = (screen: BaseScreen, hits = 0): DemoState => ({ ...INITIAL_STATE, screen, hits });
/** 单层布局：浮层也用同一个 compute（它不读底层状态）。 */
const layoutOf = (screen: Screen, viewport: { width: number; height: number }) =>
  engine.compute(screen, viewport, INITIAL_STATE);

it('7 个底层界面 × 两个视口：绑定无错、布局无溢出、组件矩形齐全且都在视口内', () => {
  for (const screen of BASE_SCREENS) {
    for (const viewport of VIEWPORTS) {
      const tag = `${screen}@${viewport.width}×${viewport.height}`;
      const view = engine.compute(screen, viewport, stateOf(screen));
      expect(view.errors, `${tag} 有布局错误`).toEqual([]);
      const names = Object.keys(view.components);
      expect(names.length, `${tag} 没有组件`).toBeGreaterThan(0);
      for (const name of names) {
        const rect = view.rects[name];
        expect(rect, `${tag} 组件 ${name} 缺矩形`).toBeDefined();
        if (rect === undefined) continue;
        expect(rect.w, `${tag} ${name} 宽`).toBeGreaterThan(0);
        expect(rect.h, `${tag} ${name} 高`).toBeGreaterThan(0);
        expect(rect.x, `${tag} ${name} 左越界`).toBeGreaterThanOrEqual(0);
        expect(rect.y, `${tag} ${name} 上越界`).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w, `${tag} ${name} 右越界`).toBeLessThanOrEqual(viewport.width + 0.01);
        expect(rect.y + rect.h, `${tag} ${name} 下越界`).toBeLessThanOrEqual(viewport.height + 0.01);
      }
    }
  }
});

it('4 个浮层 × 两个视口：.ui 干净、矩形都在视口内（浮层是叠加层，不该溢出）', () => {
  for (const modal of MODALS) {
    for (const viewport of VIEWPORTS) {
      const tag = `${modal}@${viewport.width}×${viewport.height}`;
      const view = layoutOf(modal, viewport);
      expect(view.errors, `${tag} 有布局错误`).toEqual([]);
      for (const name of Object.keys(view.rects)) {
        const rect = view.rects[name]!;
        expect(rect.x, `${tag} ${name} 左越界`).toBeGreaterThanOrEqual(0);
        expect(rect.y, `${tag} ${name} 上越界`).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w, `${tag} ${name} 右越界`).toBeLessThanOrEqual(viewport.width + 0.01);
        expect(rect.y + rect.h, `${tag} ${name} 下越界`).toBeLessThanOrEqual(viewport.height + 0.01);
      }
    }
  }
});

it('paintOrder 与 rects / meta 一一对应（绘制序就是命中序的来源）', () => {
  for (const screen of ALL_SCREENS) {
    const view = layoutOf(screen, VIEWPORTS[0]!);
    for (const name of view.paintOrder) {
      expect(view.rects[name], `${screen}/${name} 在 paintOrder 里但没有矩形`).toBeDefined();
      expect(view.meta[name], `${screen}/${name} 缺 meta`).toBeDefined();
    }
    // 反向：有 meta 的都应该在 paintOrder 里
    expect(Object.keys(view.meta).sort(), `${screen} 的 meta 与 paintOrder 不一致`).toEqual(
      [...view.paintOrder].sort(),
    );
  }
});

it('play：命中数变化反映到 tapTarget / coinBadge 的 label', () => {
  const view = engine.compute('play', VIEWPORTS[0]!, stateOf('play', 2));
  expect(view.props['tapTarget']).toEqual({ label: '2 / 3' });
  expect(view.props['coinBadge']).toEqual({ label: '2 / 3' });
});

it('result：评级由命中数决定（3 次 → 完美）', () => {
  const view = engine.compute('result', VIEWPORTS[0]!, stateOf('result', TARGET));
  expect(view.props['scorePanel']).toEqual({ label: '3 / 3', grade: '完美' });
});

it('menu：通用组件重写后的绘制序（base 的 panel/进度/按钮 → overlay 的标题）', () => {
  const view = engine.compute('menu', VIEWPORTS[0]!, stateOf('menu'));
  expect(view.errors).toEqual([]);
  // panel 在 base 最底；标题/副标题在 overlay 最后（压在最上面）
  expect(view.paintOrder).toEqual([
    'panel',
    'progress',
    'button',
    'primaryButton',
    'secondaryButton',
    'card0',
    'card1',
    'infoPanel',
    'toast',
    'parcelGrid',
    'label',
    'statusText',
    // T38：嵌套滚动入口（overlay 右上角），声明在最后 → 画在最上面
    'coinBadge',
  ]);
  expect(view.meta['label']).toMatchObject({ layer: 'overlay' });
  expect(view.meta['panel']).toMatchObject({ layer: 'base' });
  // panel 铺满顶部带（26% 高）
  expect(view.rects['panel']?.h).toBeCloseTo(844 * 0.26, 1);
  // footer 4 个入口依次向下排（开始 → 背包 → 弹窗 → 总览），最后一个留在屏内
  const entries = ['button', 'primaryButton', 'secondaryButton', 'card0'].map((n) => view.rects[n]!);
  for (let i = 1; i < entries.length; i += 1) {
    expect(entries[i - 1]!.y + entries[i - 1]!.h).toBeLessThanOrEqual(entries[i]!.y + 0.01);
  }
  expect(entries[entries.length - 1]!.y + entries[entries.length - 1]!.h).toBeLessThanOrEqual(844 + 0.01);
  // T35：四个入口同一行（横排，不相交）
  const row = ['card1', 'infoPanel', 'toast', 'parcelGrid'].map((n) => view.rects[n]!);
  for (let i = 1; i < row.length; i += 1) {
    expect(row[i]!.x).toBeGreaterThanOrEqual(row[i - 1]!.x + row[i - 1]!.w);
  }
});

it('menu：按下哪个按钮哪个变 pressed（动态 props）', () => {
  const pressed: DemoState = { ...stateOf('menu'), press: { pressed: 'button', pointerId: 1 } };
  const view = engine.compute('menu', VIEWPORTS[0]!, pressed);
  expect(view.props['button']).toMatchObject({ state: 'pressed', text: '开始' });
  // 内置按钮没有 state 参数（三态是通用 button 的能力），按压不影响它们的静态 props
  expect(view.props['primaryButton']).toMatchObject({ label: '打开背包' });
  // 松开后回到 normal
  const released = engine.compute('menu', VIEWPORTS[0]!, stateOf('menu'));
  expect(released.props['button']).toMatchObject({ state: 'normal' });
});

it('menu：statusText 保留副标题文案，progress 带 value/max', () => {
  const view = engine.compute('menu', VIEWPORTS[0]!, stateOf('menu'));
  expect(view.props['statusText']).toMatchObject({ label: 'T13d：widgets 接进游戏' });
  expect(view.props['progress']).toMatchObject({ value: 0, max: TARGET });
});

it('inventory：列表吃掉剩余高度，滚动条与列表等高且贴右', () => {
  for (const viewport of VIEWPORTS) {
    const view = engine.compute('inventory', viewport, stateOf('inventory'));
    expect(view.errors, `${viewport.width} 布局有错`).toEqual([]);
    const list = view.rects['list'];
    const bar = view.rects['scrollbar'];
    expect(list, '缺 list 矩形').toBeDefined();
    expect(bar, '缺 scrollbar 矩形').toBeDefined();
    if (list === undefined || bar === undefined) continue;
    // 列表是「去掉 head 16% + tools 11% 后剩下的」，两个视口都远超一屏
    expect(list.h).toBeGreaterThan(390);
    // 滚动条与列表等高（`.ui` 里用 71% 近似，实测两视口高度完全一致）
    expect(bar.h).toBeCloseTo(list.h, 1);
    // 贴右：滚动条右缘离视口右边缘只有一个 pad（1% 视口宽）
    expect(bar.x + bar.w).toBeLessThanOrEqual(viewport.width - viewport.width * 0.01 + 0.01);
    expect(bar.x).toBeGreaterThan(viewport.width * 0.9);
  }
});

it('gallery：21 项数据都在 layout.data 里，列表与滚动条等高且贴右', () => {
  for (const viewport of VIEWPORTS) {
    const view = engine.compute('gallery', viewport, stateOf('gallery'));
    expect(view.errors, `${viewport.width} 布局有错`).toEqual([]);
    // list 的 items 就是 21 条总览项（渲染层与布局层同一份快照）
    const items = view.data['items'];
    expect(Array.isArray(items)).toBe(true);
    expect((items as readonly unknown[]).length).toBe(21);
    const list = view.rects['list'];
    const bar = view.rects['scrollbar'];
    expect(list, '缺 list 矩形').toBeDefined();
    expect(bar, '缺 scrollbar 矩形').toBeDefined();
    if (list === undefined || bar === undefined) continue;
    // 内容 21×88=1848 远超一屏，必须能滚
    expect(galleryContentHeight()).toBe(21 * 88);
    expect(galleryContentHeight()).toBeGreaterThan(list.h * 2);
    expect(bar.h).toBeCloseTo(list.h, 0);
    expect(bar.x).toBeGreaterThan(viewport.width * 0.9);
  }
});

it('gallery 的 21 项与注册表组件数一致（21 个通用件全部在册）', () => {
  expect(GALLERY_ENTRIES.length).toBe(21);
  const names = GALLERY_ENTRIES.map((entry) => entry.name);
  expect(new Set(names).size).toBe(21); // 没有重名
  for (const name of names) {
    expect(engine.registry.has(name), `注册表缺组件 ${name}`).toBe(true);
  }
  // 每一项都有能看出形态的尺寸
  for (const entry of GALLERY_ENTRIES) {
    expect(entry.size.w, `${entry.name} 宽`).toBeGreaterThan(0);
    expect(entry.size.h, `${entry.name} 高`).toBeGreaterThan(0);
  }
});

it('popup：浮层只有遮罩 / 面板 / 按钮（不再伪造底层）；遮罩 hit block，按钮 hit self', () => {
  const view = layoutOf('popup', VIEWPORTS[0]!);
  expect(view.errors).toEqual([]);
  // 绘制正序：遮罩 → 面板 → 确认按钮（T42：base 层的假底层已删）
  expect(view.paintOrder).toEqual(['panel', 'card0', 'primaryButton']);
  expect(view.meta['panel']).toMatchObject({ hit: 'block', layer: 'overlay' });
  expect(view.meta['card0']).toMatchObject({ hit: 'self', layer: 'overlay' });
  expect(view.meta['primaryButton']).toMatchObject({ hit: 'self', layer: 'overlay' });
  // 遮罩盖满整个视口（overlay 的 region 是整屏坐标系），且是半透明黑
  expect(view.rects['panel']).toEqual({ x: 0, y: 0, w: 390, h: 844 });
  expect(view.props['panel']).toMatchObject({ fillColor: 'rgba(0,0,0,0.55)' });
});

it('tapTarget 在两个视口都不小于 96px（手指点得准）', () => {
  for (const viewport of VIEWPORTS) {
    const rect = engine.compute('play', viewport, stateOf('play')).rects['tapTarget'];
    expect(rect, 'tapTarget 缺矩形').toBeDefined();
    if (rect === undefined) continue;
    expect(Math.min(rect.w, rect.h), `${viewport.width} 宽目标过小`).toBeGreaterThanOrEqual(96);
  }
});

it('可点元素的触摸高度在两个视口都不小于 44px（最小触摸目标）', () => {
  const cases: readonly (readonly [Screen, string])[] = [
    ['menu', 'button'],
    ['menu', 'primaryButton'],
    ['menu', 'secondaryButton'],
    ['menu', 'card1'],
    ['menu', 'infoPanel'],
    ['play', 'secondaryButton'],
    ['result', 'primaryButton'],
    ['popup', 'primaryButton'],
    ['inventory', 'button'],
    ['sheet', 'primaryButton'],
    ['half', 'primaryButton'],
  ];
  for (const viewport of VIEWPORTS) {
    for (const [screen, name] of cases) {
      const rect = layoutOf(screen, viewport).rects[name];
      expect(rect, `${screen}/${name} 缺矩形`).toBeDefined();
      if (rect === undefined) continue;
      expect(rect.h, `${screen}/${name}@${viewport.width} 太矮`).toBeGreaterThanOrEqual(44);
    }
  }
});

// ---------------------------------------------------------------------------
// T32 + T42：两个半屏浮层的几何（抽屉贴底 45% / 半屏居中 58%）
// ---------------------------------------------------------------------------

it('sheet：抽屉贴屏幕底部、占 45% 高，遮罩整屏盖住上方 55%', () => {
  for (const viewport of VIEWPORTS) {
    const view = layoutOf('sheet', viewport);
    expect(view.errors, `${viewport.width} 布局有错`).toEqual([]);
    // T35：遮罩换成通用 panel（半透明），抽屉底色换成内置 infoPanel
    const panel = view.rects['infoPanel'];
    const mask = view.rects['panel'];
    expect(panel, '缺 infoPanel').toBeDefined();
    expect(mask, '缺 panel').toBeDefined();
    if (panel === undefined || mask === undefined) continue;
    expect(panel.h, `${viewport.width} 抽屉高`).toBeCloseTo(viewport.height * 0.45, 1);
    expect(panel.y + panel.h, `${viewport.width} 抽屉没贴底`).toBeCloseTo(viewport.height, 1);
    expect(mask.h, `${viewport.width} 遮罩没铺满`).toBeCloseTo(viewport.height, 1);
    // 关闭按钮整个落在抽屉里；标题是「大盒子 + 文字垂直居中」，判文字中线在抽屉里
    const button = view.rects['primaryButton']!;
    expect(button.y, `${viewport.width} 关闭按钮在抽屉上方`).toBeGreaterThanOrEqual(panel.y - 0.01);
    expect(button.y + button.h, `${viewport.width} 关闭按钮掉出抽屉`).toBeLessThanOrEqual(panel.y + panel.h + 0.01);
    const title = view.rects['label']!;
    const titleMid = title.y + title.h / 2;
    expect(titleMid, `${viewport.width} 标题文字在抽屉上方`).toBeGreaterThanOrEqual(panel.y);
    expect(titleMid, `${viewport.width} 标题文字掉出抽屉`).toBeLessThanOrEqual(panel.y + panel.h);
  }
});

it('half：面板 58% 高、84% 宽、竖直居中，遮罩整屏', () => {
  for (const viewport of VIEWPORTS) {
    const view = layoutOf('half', viewport);
    expect(view.errors, `${viewport.width} 布局有错`).toEqual([]);
    // T35：遮罩换成通用 panel（半透明），半屏底面换成内置 infoPanel
    const panel = view.rects['infoPanel'];
    expect(panel, '缺 infoPanel').toBeDefined();
    if (panel === undefined) continue;
    expect(panel.h, `${viewport.width} 面板高`).toBeCloseTo(viewport.height * 0.58, 1);
    expect(panel.w, `${viewport.width} 面板宽`).toBeCloseTo(viewport.width * 0.84, 1);
    expect(panel.y, `${viewport.width} 没竖直居中`).toBeCloseTo((viewport.height - panel.h) / 2, 1);
    expect(panel.x, `${viewport.width} 左右留白不是 8%`).toBeCloseTo(viewport.width * 0.08, 1);
    // 内容（标题 + 关闭）在面板内部居中区域
    for (const name of ['label', 'primaryButton']) {
      const rect = view.rects[name]!;
      expect(rect.y, `${viewport.width} ${name} 在面板外`).toBeGreaterThanOrEqual(panel.y - 0.01);
      expect(rect.y + rect.h, `${viewport.width} ${name} 在面板外`).toBeLessThanOrEqual(panel.y + panel.h + 0.01);
    }
  }
});
