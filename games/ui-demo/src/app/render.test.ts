import { expect, it } from 'vitest';
import type { Ctx2D } from './deps';
import { GALLERY_ENTRIES } from './gallery';
import { createLayoutEngine } from './layout';
import { createGalleryItemRenderer, createRenderer, DEMO_THEME, EMPTY_ASSETS } from './render';
import { INITIAL_STATE } from './state';
import type { BaseScreen, DemoState } from './state';
import { createDemoRegistry } from './ui-registry';

const engine = createLayoutEngine();
const renderer = createRenderer();
const galleryRenderer = createRenderer(undefined, engine.registry);

/** 记录 fillRect / fillText 的假画布（含 button 组件会调的 save/restore/translate/scale）。 */
const spyCtx = (): {
  ctx: Ctx2D;
  fills: number[][];
  texts: { text: string; x: number; y: number; color: string }[];
  paths: number;
} => {
  const fills: number[][] = [];
  const texts: { text: string; x: number; y: number; color: string }[] = [];
  let paths = 0;
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
    // checkbox / radio 画勾和圈用描边
    lineWidth: 1,
    strokeStyle: '',
    lineCap: '',
    lineJoin: '',
    stroke: () => undefined,
    setLineDash: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    scale: () => undefined,
    // 圆角组件（progress / badge / scrollbar）走标准 canvas path API
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arcTo: () => undefined,
    closePath: () => undefined,
    // avatar 走 arc + clip、carousel 走 rect + clip
    arc: () => undefined,
    rect: () => undefined,
    clip: () => undefined,
    fill: () => {
      paths += 1;
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      fills.push([x, y, w, h]);
    },
    fillText: (text: string, x: number, y: number) => {
      texts.push({ text, x, y, color: String(ctx.fillStyle) });
    },
  } as unknown as Ctx2D;
  return {
    ctx,
    fills,
    texts,
    get paths() {
      return paths;
    },
  };
};

const stateOf = (screen: BaseScreen, hits = 0): DemoState => ({ ...INITIAL_STATE, screen, hits });

/** 画一帧并把「底层 + 浮层」都走一遍渲染器（T42：浮层叠加，不替换底层）。 */
const drawScreen = (state: DemoState) => {
  const spy = spyCtx();
  const layers = engine.computeLayers({ width: 390, height: 844 }, state);
  renderer.draw(spy.ctx, layers.base, layers.modal);
  return spy;
};

it('menu：背景 + 面板 + 四个入口 + 提示入口 + 进度条都真实绘制，文字都画了', () => {
  const spy = drawScreen(stateOf('menu'));
  // 背景 1 + panel 兜底 1 + 四个入口底 4 + toast 底 1（progress 走圆角 path，不算 fillRect）
  expect(spy.fills.length).toBeGreaterThanOrEqual(7);
  // progress 轨道一次圆角 path fill（value=0 时没有填充段）
  expect(spy.paths).toBeGreaterThanOrEqual(1);
  expect(spy.fills[0]?.slice(0, 2)).toEqual([0, 0]);
  const labels = spy.texts.map((t) => t.text);
  expect(labels).toContain('UI 链验证 Demo');
  expect(labels).toContain('T13d：widgets 接进游戏');
  expect(labels).toContain('开始');
  expect(labels).toContain('打开背包');
  expect(labels).toContain('打开弹窗');
  expect(labels).toContain('组件总览（21）');
  // T35：提示入口（toast 组件画的提示条文字）
  expect(labels).toContain('金币提示');
  // 文字坐标落在视口内（不是 NaN / 跑出屏幕）
  for (const text of spy.texts) {
    expect(Number.isFinite(text.x)).toBe(true);
    expect(text.x).toBeGreaterThan(0);
    expect(text.x).toBeLessThan(390);
    expect(text.y).toBeGreaterThan(0);
    expect(text.y).toBeLessThan(844);
  }
});

it('play：绘制目标块与实时命中数（1 / 3）', () => {
  const spy = drawScreen(stateOf('play', 1));
  const labels = spy.texts.map((t) => t.text);
  expect(labels).toContain('点目标 3 次');
  expect(labels.filter((t) => t === '1 / 3').length).toBe(2); // tapTarget + coinBadge
  expect(labels).toContain('放弃');
  // tapTarget 的深墨外框 + 主色内块
  expect(spy.fills.length).toBeGreaterThanOrEqual(2);
});

it('result：绘制结算成绩与评级', () => {
  const spy = drawScreen(stateOf('result', 3));
  const labels = spy.texts.map((t) => t.text);
  expect(labels).toContain('完成！');
  expect(labels).toContain('3 / 3');
  expect(labels).toContain('完美');
  expect(labels).toContain('再来一次');
});

it('绘制顺序 = paintOrder 正序（menu：base 三个按钮 → overlay 的标题文字）', () => {
  const spy = drawScreen(stateOf('menu'));
  const labels = spy.texts.map((t) => t.text);
  const start = labels.indexOf('开始');
  const bag = labels.indexOf('打开背包');
  const popup = labels.indexOf('打开弹窗');
  const title = labels.indexOf('UI 链验证 Demo');
  expect(start).toBeGreaterThanOrEqual(0);
  // base 内按声明序：开始 → 打开背包 → 打开弹窗
  expect(bag).toBeGreaterThan(start);
  expect(popup).toBeGreaterThan(bag);
  // overlay 的标题压在所有 base 元素之后画（盖在最上面）
  expect(title).toBeGreaterThan(popup);
});

it('menu：按下态真的改变绘制（pressed 的按钮下移 2px，未按的不动）', () => {
  const normal = drawScreen(stateOf('menu'));
  const pressedState: DemoState = { ...stateOf('menu'), press: { pressed: 'button', pointerId: 1 } };
  const pressed = drawScreen(pressedState);
  const normalY = normal.texts.find((t) => t.text === '开始')?.y;
  const pressedY = pressed.texts.find((t) => t.text === '开始')?.y;
  expect(normalY).toBeDefined();
  expect(pressedY).toBeDefined();
  expect((pressedY ?? 0) - (normalY ?? 0)).toBeCloseTo(2, 5);
  // 没按的按钮不动
  const normalBag = normal.texts.find((t) => t.text === '打开背包')?.y;
  const pressedBag = pressed.texts.find((t) => t.text === '打开背包')?.y;
  expect(pressedBag).toBeCloseTo(normalBag ?? 0, 5);
});

it('inventory：列表项文字真的画出来（renderItem 注入生效）', () => {
  const spy = drawScreen(stateOf('inventory'));
  // 只取列表项文字（badge 的「20 件」也在 texts 里，但它是 base 层的另一个组件）
  const items = spy.texts.map((t) => t.text).filter((text) => text.startsWith('物品'));
  // 第一项按数据画：名字 + 数量
  expect(items[0]).toBe('物品 01  ×1');
  expect(items[1]).toBe('物品 02  ×8');
  expect(items[2]).toBe('物品 03  ×2');
  // 视口只画得下约 10 项（虚拟列表不会把 20 项全画）
  expect(items.length).toBeLessThan(20);
  expect(items.length).toBeGreaterThanOrEqual(8);
});

it('inventory：滚动后绘制的内容跟着上移（scrollTop 进了渲染路径）', () => {
  const top = drawScreen(stateOf('inventory'));
  const scrolled = drawScreen({
    ...stateOf('inventory'),
    scrolls: { list: 200 },
  });
  const itemTexts = (spy: ReturnType<typeof spyCtx>) =>
    spy.texts.filter((t) => t.text.startsWith('物品'));
  const topFirst = itemTexts(top)[0];
  const scrolledFirst = itemTexts(scrolled)[0];
  expect(topFirst?.text).toBe('物品 01  ×1');
  // 滚 200px 后第一项已出屏：最先画的是包含滚动位的那一项（floor(200/56)=3 → 物品 04）
  expect(scrolledFirst?.text).toBe('物品 04  ×9');
  expect(scrolledFirst?.y ?? 0).toBeLessThan(topFirst?.y ?? 0);
});

it('inventory：选中项多画一层主色底（选中高亮）', () => {
  const plain = drawScreen(stateOf('inventory'));
  const selected = drawScreen({ ...stateOf('inventory'), selected: 2 });
  // 选中项多一次 fillRect（主色底）
  expect(selected.fills.length).toBe(plain.fills.length + 1);
  // 选中项文字仍是第 3 项
  expect(selected.texts.map((t) => t.text)).toContain('物品 03  ×2');
});

it('popup：先画整个 menu、再画浮层（底层元素真的画了，不是伪造的底层）', () => {
  const spy = drawScreen({ ...INITIAL_STATE, modal: 'popup' });
  const labels = spy.texts.map((t) => t.text);
  // 底层 menu 的文字全在（T42 核心：弹窗打开时 menu 不被替换）
  expect(labels).toContain('UI 链验证 Demo');
  expect(labels).toContain('打开背包');
  expect(labels).toContain('打开弹窗');
  // 浮层自己的文字也画了
  expect(labels).toContain('确认打开？');
  expect(labels).toContain('确定');
  // 顺序：menu 的标题在浮层文字之前（先底层、后浮层）
  expect(labels.indexOf('UI 链验证 Demo')).toBeLessThan(labels.indexOf('确认打开？'));
  expect(labels.indexOf('确认打开？')).toBeLessThan(labels.indexOf('确定'));
  // 遮罩真的多画了一层：比只画 menu 时多一次 fillRect
  const baseOnly = drawScreen(INITIAL_STATE);
  expect(spy.fills.length).toBeGreaterThan(baseOnly.fills.length);
});

// ---------------------------------------------------------------------------
// T27：组件总览 —— 19 项逐项独立调 draw（不经过 .ui 节点）
// ---------------------------------------------------------------------------

it('gallery：19 项逐项调 draw，每一项都真的画了东西（没有空白行）', () => {
  const registry = createDemoRegistry();
  const deps = { assets: EMPTY_ASSETS, theme: DEMO_THEME };
  const itemRenderer = createGalleryItemRenderer(registry, deps);
  const ROW = { x: 10, y: 0, w: 360, h: 88 };

  for (const entry of GALLERY_ENTRIES) {
    const spy = spyCtx();
    itemRenderer(spy.ctx, entry, ROW, 0);
    // 名字文字必须出现（右侧 label 画的）
    expect(spy.texts.map((t) => t.text), `${entry.name} 名字没画`).toContain(entry.name);
    // 除名字外，组件本体至少产生一次绘制（fillRect / path fill / 文字三者任一）
    const total = spy.fills.length + spy.paths + spy.texts.length;
    expect(total, `${entry.name} 只有名字、组件本体一次都没画`).toBeGreaterThan(1);
  }
});

it('gallery：数据驱动组件的示例数据真的被画出来（不只是底和指示点）', () => {
  const registry = createDemoRegistry();
  const deps = { assets: EMPTY_ASSETS, theme: DEMO_THEME };
  const itemRenderer = createGalleryItemRenderer(registry, deps);
  const ROW = { x: 10, y: 0, w: 360, h: 88 };

  // 每项：组件名 → 数据里必须出现的文字
  // carousel 只画**可见页**（gallery 里 index=1 → 当前是第二页），这是组件契约
  const EXPECT: Readonly<Record<string, readonly string[]>> = {
    list: ['列表项 A', '列表项 B', '列表项 C'],
    carousel: ['第二页'],
    tabs: ['推荐', '关注', '最新'],
    segmented: ['日', '周', '月'],
    keypad: ['1', '2', '3', '4', '5', '6'],
  };
  for (const entry of GALLERY_ENTRIES) {
    const expected = EXPECT[entry.name];
    if (expected === undefined) continue;
    const spy = spyCtx();
    itemRenderer(spy.ctx, entry, ROW, 0);
    const texts = spy.texts.map((t) => t.text);
    for (const text of expected) {
      expect(texts, `${entry.name} 的数据内容 '${text}' 没画出来`).toContain(text);
    }
  }
});

it('gallery：每一项都取自注册表，且 19 个组件全部可用（draw 可独立调用）', () => {
  const registry = createDemoRegistry();
  for (const entry of GALLERY_ENTRIES) {
    const def = registry.get(entry.name);
    expect(def, `${entry.name} 不在注册表里`).not.toBeNull();
    // draw 是组件定义的一部分，能脱离 bind / layout 直接调（不带 measure 也能画）
    expect(typeof def?.draw).toBe('function');
  }
});

it('gallery：滚动三屏合起来把 19 项全部画出（虚拟列表按滚动位裁剪）', () => {
  const drawn = new Set<string>();
  const names = new Set(GALLERY_ENTRIES.map((entry) => entry.name));
  // 内容 21×88=1848、视口 633 → 最大滚动位约 1215；取顶/中/底三屏
  for (const offset of [0, 560, 1215]) {
    const view = engine.compute('gallery', { width: 390, height: 844 }, {
      ...INITIAL_STATE,
      screen: 'gallery',
      scrolls: { list: offset },
    });
    const spy = spyCtx();
    galleryRenderer.draw(spy.ctx, view);
    for (const text of spy.texts.map((t) => t.text)) {
      if (names.has(text)) drawn.add(text);
    }
  }
  expect([...drawn].sort()).toEqual([...names].sort());
  expect(drawn.size).toBe(GALLERY_ENTRIES.length);
});

it('gallery：一屏只画得下约 7 项（虚拟列表没有把 19 项全画）', () => {
  const view = engine.compute('gallery', { width: 390, height: 844 }, { ...INITIAL_STATE, screen: 'gallery' });
  const spy = spyCtx();
  galleryRenderer.draw(spy.ctx, view);
  const names = new Set(GALLERY_ENTRIES.map((entry) => entry.name));
  const drawnHere = spy.texts.map((t) => t.text).filter((text) => names.has(text));
  expect(drawnHere.length).toBeGreaterThanOrEqual(6);
  expect(drawnHere.length).toBeLessThan(19);
});

