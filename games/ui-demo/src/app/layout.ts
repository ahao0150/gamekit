/**
 * 界面布局：`.ui` 产物 + 组件注册表 → 每个界面、每个视口的组件矩形。
 *
 * 全链路：`.ui` 源码（构建期编译成数据模块）→ `bindComponents` 注入组件
 * `measure()` → `layout()` 求解。这里没有任何手写坐标，换屏型只是换 viewport。
 *
 * v0.5 起 `layout()` 还输出 `paintOrder`（绘制正序）与 `meta`（每个组件的 layer / hit），
 * 这里原样透传给渲染层与命中层 —— 两边用同一份顺序，不会各算一套。
 *
 * T13d：布局期把**游戏数据**（`UiData`）一起带出去，渲染层直接拿去喂 `list` 的
 * `items` / `renderItem`。同一份数据既进 `bindComponents` 的 `MeasureEnv`，也进
 * 绘制依赖 —— 组件「量出来的」和「画出来的」不会来自两份快照。
 *
 * T27：`LayoutEngine` 暴露 `registry`。gallery 的每行要「从注册表取组件定义、
 * 直接调 draw」，渲染层必须拿到**同一份**注册表（不是另建一个内容相同的）。
 *
 * T35：加 `bag`（网格背包，数据是 `ITEMS` + 选中下标）与 `tip`（任意位置提示，
 * 布局本身由 `at` 决定，这里不注入动态数据）。
 *
 * T38：加 `nest`（嵌套滚动：外层 `scroll` + 内层 `list`）；所有可滚容器的
 * `scrollTop` 统一由 `state.scrolls[组件名]` 注入 —— 每个容器读自己的键，
 * 嵌套时内外互不串台（见 `scrollables.ts`）。
 *
 * T42：浮层不再替换底层。`computeLayers()` 一次给出**两份**布局：
 * `base`（state.screen）+ `modal`（state.modal，没有则为 null）。两份各自独立求解，
 * 渲染先画 base 再画 modal；命中与滚轮先查 modal —— 浮层的遮罩才能真的挡住底层。
 */

import atAnywhereUi from '../../ui/at-anywhere.ui';
import galleryUi from '../../ui/gallery.ui';
import gridBagUi from '../../ui/grid-bag.ui';
import inventoryUi from '../../ui/inventory.ui';
import menuUi from '../../ui/menu.ui';
import playUi from '../../ui/play.ui';
import popupHalfUi from '../../ui/popup-half.ui';
import popupSheetUi from '../../ui/popup-sheet.ui';
import popupUi from '../../ui/popup.ui';
import resultUi from '../../ui/result.ui';
import scrollNestUi from '../../ui/scroll-nest.ui';
import { bindComponents, layout } from './deps';
import type {
  ComponentDef,
  ComponentRegistry,
  LayoutSpec,
  LayoutViewport,
  NodeMeta,
  Rect,
  StyleProps,
  UiData,
} from './deps';
import { GALLERY_ENTRIES, galleryContentHeight } from './gallery';
import { contentHeight, itemAt, ITEMS, scrollRatios } from './inventory';
import { isScrollComponent } from './scrollables';
import { gradeOf, TARGET } from './state';
import type { DemoState, Screen } from './state';
import { createDemoRegistry } from './ui-registry';

/** 十一个界面（7 个底层 + 4 个浮层）的编译产物（构建期由 `@mg/ui-plugin` 从 `.ui` 生成）。 */
const UI_OF: Readonly<Record<Screen, { readonly spec: LayoutSpec }>> = {
  menu: menuUi,
  play: playUi,
  result: resultUi,
  popup: popupUi,
  inventory: inventoryUi,
  gallery: galleryUi,
  sheet: popupSheetUi,
  half: popupHalfUi,
  bag: gridBagUi,
  tip: atAnywhereUi,
  nest: scrollNestUi,
};

export interface ScreenLayout {
  /** 这个布局属于哪个界面 */
  readonly screen: Screen;
  readonly viewport: LayoutViewport;
  /** 组件名 → 矩形（逻辑像素） */
  readonly rects: Readonly<Record<string, Rect>>;
  /** 绘制顺序（正序，来自 `layout()` 的 paintOrder）：渲染按它画，命中按它逆序 */
  readonly paintOrder: readonly string[];
  /** 组件名 → 层 / 命中语义（来自 `.ui` 的 `layer` 与 `put ... hit`） */
  readonly meta: Readonly<Record<string, NodeMeta>>;
  /** 组件名 → 组件定义（绘制期按名字取） */
  readonly components: Readonly<Record<string, ComponentDef>>;
  /** 组件名 → 参数（静态 style 与动态状态合并后） */
  readonly props: Readonly<Record<string, StyleProps>>;
  /** 游戏数据快照（`list` 的 items 等）；绘制层会再补 `renderItem` */
  readonly data: UiData;
  /** 绑定期 + 布局期错误（中文）；为空表示这个界面是干净的 */
  readonly errors: readonly string[];
}

export interface Layers {
  /** 底层界面的布局（始终存在） */
  readonly base: ScreenLayout;
  /** 浮层布局；没有浮层时 null */
  readonly modal: ScreenLayout | null;
}

export interface LayoutEngine {
  /** 构建期与运行时共用的那一份注册表（渲染层要为 gallery 取组件定义） */
  readonly registry: ComponentRegistry;
  /** 单层求解（测试 / 离线工具用；浮层也能单独算） */
  compute(screen: Screen, viewport: LayoutViewport, state: DemoState): ScreenLayout;
  /** 一次算出「底层 + 浮层」两份布局（T42：浮层叠加，不替换底层） */
  computeLayers(viewport: LayoutViewport, state: DemoState): Layers;
}

/**
 * 游戏数据：列表类界面各带自己的数据。
 *
 * `bindComponents` 的 `MeasureEnv.data` 和渲染层的 `DrawDeps.data` 都取这一份 ——
 * 组件在布局期和绘制期看到的是同一个快照。
 */
const uiDataOf = (screen: Screen, state: DemoState): UiData => {
  if (screen === 'inventory') return { items: ITEMS, selectedIndex: state.selected };
  // T35：网格背包也用同一份 ITEMS（20 件，4 列 5 行）；选中下标交给 renderItem 画高亮
  if (screen === 'bag') return { items: ITEMS, selectedIndex: state.selected };
  if (screen === 'gallery') return { items: GALLERY_ENTRIES };
  // T38：嵌套滚动的内层 list 用同一份假物品；外层 scroll 的内容由渲染层回调画
  if (screen === 'nest') return { items: ITEMS };
  return {};
};

/** 按钮的 state：按下的那一个显示 pressed，其余 normal。 */
const buttonStateOf = (state: DemoState, name: string): string =>
  state.press.pressed === name ? 'pressed' : 'normal';

/** 可滚动列表界面的动态 props（inventory / gallery 共用一套算法）。 */
const scrollableProps = (
  state: DemoState,
  rects: Readonly<Record<string, Rect>>,
  contentPx: number,
): Readonly<Record<string, StyleProps>> => {
  const listHeight = rects['list']?.h ?? 0;
  const offset = state.scrolls['list'] ?? 0;
  const ratios = scrollRatios(contentPx, listHeight, offset);
  return {
    // list 的 scrollTop 由 `scrollProps` 统一注入（所有可滚容器同一条路径），
    // 这里只负责滚动条的两个比例：滑块位置 + 滑块长度
    scrollbar: { value: ratios.value, viewport: ratios.viewport },
    button: { state: buttonStateOf(state, 'button') },
  };
};

/**
 * 所有可滚容器的通用动态 props：每个容器读**自己的**滚动位。
 *
 * 这是「嵌套只滚最里层、外层一点不动」的数据基础 —— 内外是两个键，
 * 不存在一张共享 offset（T13d 的单 `scroll` 状态只能表达一个容器）。
 */
const scrollProps = (
  state: DemoState,
  components: ScreenLayout['components'],
): Readonly<Record<string, StyleProps>> => {
  const out: Record<string, StyleProps> = {};
  for (const name of Object.keys(components)) {
    if (isScrollComponent(name)) out[name] = { scrollTop: state.scrolls[name] ?? 0 };
  }
  return out;
};

/** 两个「组件名 → props」映射逐键合并：同一个组件两边的键都要保留（不整对象替换）。 */
const mergeDynamic = (
  a: Readonly<Record<string, StyleProps>>,
  b: Readonly<Record<string, StyleProps>>,
): Readonly<Record<string, StyleProps>> => {
  const out: Record<string, StyleProps> = { ...a };
  for (const [name, props] of Object.entries(b)) out[name] = { ...(out[name] ?? {}), ...props };
  return out;
};

/** 动态 props：命中数 / 评级 / 按压态 / 滚动位这些每帧可能在变的值。 */
const dynamicProps = (
  screen: Screen,
  state: DemoState,
  rects: Readonly<Record<string, Rect>>,
): Readonly<Record<string, StyleProps>> => {
  if (screen === 'play') {
    const label = `${state.hits} / ${TARGET}`;
    return { tapTarget: { label }, coinBadge: { label } };
  }
  if (screen === 'result') {
    return { scorePanel: { label: `${state.hits} / ${TARGET}`, grade: gradeOf(state.hits) } };
  }
  if (screen === 'menu') {
    return {
      button: { state: buttonStateOf(state, 'button') },
      // 通关进度：menu 里没有进行中的局，显示 0 / TARGET
      progress: { value: state.hits, max: TARGET },
    };
  }
  if (screen === 'inventory') {
    const selected = itemAt(state.selected);
    return {
      ...scrollableProps(state, rects, contentHeight()),
      badge: { text: `${ITEMS.length} 件` },
      statusText: {
        label: selected === null ? '拖动列表滚动，点一项选中' : `已选：${selected.name} ×${selected.count}`,
      },
    };
  }
  if (screen === 'gallery') {
    return {
      ...scrollableProps(state, rects, galleryContentHeight()),
      badge: { text: `${GALLERY_ENTRIES.length} 个` },
    };
  }
  if (screen === 'bag') {
    // 网格背包：选中高亮由 renderItem 按 data.selectedIndex 画，这里只需要按钮三态
    return { button: { state: buttonStateOf(state, 'button') } };
  }
  return {};
};

/**
 * 静态 props（`.ui` 的 style）与动态 props 合并：**逐键覆盖，不整对象替换**。
 *
 * 整对象替换会让 `list` 丢掉 `itemH` / `divider` 这类静态参数 ——
 * 它们只写在 `.ui` 里，布局与绘制都要用。
 */
const mergeProps = (
  base: Readonly<Record<string, StyleProps>>,
  dynamic: Readonly<Record<string, StyleProps>>,
): Readonly<Record<string, StyleProps>> => {
  const out: Record<string, StyleProps> = {};
  for (const [name, props] of Object.entries(base)) out[name] = { ...props, ...(dynamic[name] ?? {}) };
  for (const [name, props] of Object.entries(dynamic)) {
    if (out[name] === undefined) out[name] = props;
  }
  return out;
};

export const createLayoutEngine = (): LayoutEngine => {
  // 注册表挂在 engine 实例上（不是模块级可变单例）：每次 createGame 一份
  const registry = createDemoRegistry();
  const solve = (screen: Screen, viewport: LayoutViewport, state: DemoState): ScreenLayout => {
    const data = uiDataOf(screen, state);
    const bound = bindComponents(UI_OF[screen].spec, { registry, env: { viewport, data } });
    const solved = layout(bound.spec, viewport);
    return {
      screen,
      viewport,
      rects: solved.rects,
      paintOrder: solved.paintOrder,
      meta: solved.meta,
      components: bound.components,
      props: mergeProps(
        bound.props,
        mergeDynamic(scrollProps(state, bound.components), dynamicProps(screen, state, solved.rects)),
      ),
      data,
      errors: [...bound.errors, ...solved.errors],
    };
  };
  return {
    registry,
    compute: solve,
    computeLayers(viewport, state): Layers {
      return {
        base: solve(state.screen, viewport, state),
        // 浮层用同一个 state 求解：它的 `.ui` 里没有列表/滚动条，不读交互状态
        modal: state.modal === null ? null : solve(state.modal, viewport, state),
      };
    },
  };
};
