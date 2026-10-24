/**
 * 游戏状态：纯数据 + 纯函数，不碰平台、不碰 canvas。
 *
 * **底层界面**（BaseScreen，占满屏幕、互相切换）：
 * menu → play → result → menu；menu ⇄ inventory / gallery / bag（网格背包）/
 * nest（嵌套滚动）；gallery 里也能开浮层。play 里点目标 3 次进结算。
 *
 * **浮层**（Modal，叠加在底层之上，**不替换**底层）：popup / sheet / half / tip。
 * T42 之前这四个是「换界面」（`screen = 'sheet'`），导致底层 menu 被整个替换 ——
 * 用户指出「新的画布的半屏是假的半屏，本质是全屏，之前的元素全没有了」。
 * 现在 `screen` 保持底层不变，浮层单独记在 `modal` 里：
 * - 打开 / 关闭浮层**不动** `screen` / `scrolls` / `selected`（底层状态原样保留）；
 * - 布局层同时算两份（底层 + 浮层），渲染先画底层再画浮层；
 * - 命中先查浮层，遮罩 `hit block` 吃掉点击 → 底层点不到。
 *
 * 交互状态（`press` / `scrolls` / `selected` / `tipFrames`）：
 * - `press` 由 `core/ui/press.ts` 的状态机算出新值；
 * - `scrolls` 是**每个可滚容器各自的滚动位**（组件名 → 像素），拖动与滚轮都只改
 *   「指针下面那一个容器」的键 —— 嵌套时不会出现「内外共享一个 offset」的串台；
 * - `tipFrames` 是 tip 浮层的倒计时帧数（`tick` 递减到 0 只清 modal）。
 * 状态仍然只有「纯数据 + 纯函数」一种形态，绘制每帧从状态重算。
 */

import { IDLE_PRESS } from './deps';
import type { PressState } from './deps';
import { ITEMS } from './inventory';

/** 底层界面（会互相替换、占满整屏的那种）。 */
export type BaseScreen = 'menu' | 'play' | 'result' | 'inventory' | 'gallery' | 'bag' | 'nest';

/** 浮层（叠加在底层之上，底层原样可见）。 */
export type Modal = 'popup' | 'sheet' | 'half' | 'tip';

/** `.ui` 布局键：底层界面 + 浮层都在布局表里（`ScreenLayout.screen` 用它）。 */
export type Screen = BaseScreen | Modal;

/** 通关所需命中次数。 */
export const TARGET = 3;

/** 任意位置提示显示多少帧（60 帧 @60fps ≈ 1 秒）。 */
export const TIP_FRAMES = 60;

export interface DemoState {
  /** 底层界面：浮层打开时**不变** */
  readonly screen: BaseScreen;
  /** 当前浮层；null = 没有浮层（此时行为与 T42 之前完全一致） */
  readonly modal: Modal | null;
  readonly hits: number;
  /** 按钮按压状态（`press.ts` 的状态机；`pressed` 是组件名） */
  readonly press: PressState;
  /** 各可滚容器的滚动位（组件名 → 像素，0 = 顶部）；缺省视为 0 */
  readonly scrolls: Readonly<Record<string, number>>;
  /** 背包 / 网格里选中的物品下标；null = 没选 */
  readonly selected: number | null;
  /** tip 浮层剩余帧数；0 = 没在倒计时 */
  readonly tipFrames: number;
}

export const INITIAL_STATE: DemoState = {
  screen: 'menu',
  modal: null,
  hits: 0,
  press: IDLE_PRESS,
  scrolls: {},
  selected: null,
  tipFrames: 0,
};

export type Action =
  | { readonly kind: 'start' }
  | { readonly kind: 'hit' }
  | { readonly kind: 'giveUp' }
  | { readonly kind: 'restart' }
  | { readonly kind: 'openPopup' }
  | { readonly kind: 'closePopup' }
  | { readonly kind: 'openInventory' }
  | { readonly kind: 'openGallery' }
  | { readonly kind: 'openSheet' }
  | { readonly kind: 'closeSheet' }
  | { readonly kind: 'openHalf' }
  | { readonly kind: 'closeHalf' }
  | { readonly kind: 'openBag' }
  | { readonly kind: 'closeBag' }
  | { readonly kind: 'openNest' }
  | { readonly kind: 'closeNest' }
  | { readonly kind: 'openTip' }
  | { readonly kind: 'tick' }
  | { readonly kind: 'backToMenu' }
  | { readonly kind: 'press'; readonly state: PressState }
  /** 某一个可滚容器滚到 offset（拖动 / 滚轮都走这一条） */
  | { readonly kind: 'scrollTo'; readonly name: string; readonly offset: number }
  | { readonly kind: 'select'; readonly index: number };

/**
 * 切换**底层**界面：交互状态一律清空（按压/滚动/选中/倒计时都不该跨屏残留），
 * 浮层一并关掉 —— 换底层时留着浮层会让人以为浮层属于新界面。
 */
const goTo = (state: DemoState, screen: BaseScreen, hits = state.hits): DemoState => ({
  screen,
  modal: null,
  hits,
  press: IDLE_PRESS,
  scrolls: {},
  selected: null,
  tipFrames: 0,
});

/** 能否在底层 `screen` 上做这个迁移：还要求当前没有浮层（浮层开着时底层不该响应）。 */
const at = (state: DemoState, screen: BaseScreen): boolean => state.screen === screen && state.modal === null;

/**
 * 打开浮层：**只设置 `modal`**，`screen` / `scrolls` / `selected` 原样保留。
 * 已经开着浮层时忽略（不做叠层，一个槽位够用，也避免状态机分支爆炸）。
 */
const openModal = (state: DemoState, modal: Modal): DemoState =>
  state.modal === null ? { ...state, modal } : state;

/** 关闭指定浮层：只清 modal（+ 按压态 / 倒计时这些属于浮层的瞬时状态）。 */
const closeModal = (state: DemoState, modal: Modal): DemoState =>
  state.modal === modal ? { ...state, modal: null, press: IDLE_PRESS, tipFrames: 0 } : state;

/**
 * 状态迁移：非法动作原样返回（不抛错）——pointer 事件可能来自任何时刻，
 * 游戏不能因为一次早到的点击就崩。
 */
export const reduce = (state: DemoState, action: Action): DemoState => {
  switch (action.kind) {
    case 'start':
      return at(state, 'menu') ? goTo(state, 'play', 0) : state;
    case 'hit': {
      if (!at(state, 'play')) return state;
      const hits = state.hits + 1;
      return hits >= TARGET ? goTo(state, 'result', hits) : { ...state, hits };
    }
    case 'giveUp':
      return at(state, 'play') ? goTo(state, 'menu', 0) : state;
    case 'restart':
      return at(state, 'result') ? goTo(state, 'menu', 0) : state;
    // ---- 浮层：打开只设 modal，关闭只清 modal（底层状态不受影响）----
    case 'openPopup':
      return openModal(state, 'popup');
    case 'closePopup':
      return closeModal(state, 'popup');
    case 'openSheet':
      return openModal(state, 'sheet');
    case 'closeSheet':
      return closeModal(state, 'sheet');
    case 'openHalf':
      return openModal(state, 'half');
    case 'closeHalf':
      return closeModal(state, 'half');
    case 'openTip':
      // tip 打开时开始倒计时（其余浮层不倒计时）
      return state.modal === null ? { ...state, modal: 'tip', tipFrames: TIP_FRAMES } : state;
    case 'tick': {
      // 只有 tip 浮层在倒计时；其它界面 tick 是空操作（每帧都会调一次）
      if (state.modal !== 'tip') return state;
      const next = state.tipFrames - 1;
      return next <= 0 ? { ...state, modal: null, press: IDLE_PRESS, tipFrames: 0 } : { ...state, tipFrames: next };
    }
    // ---- 底层界面切换 ----
    case 'openInventory':
      return at(state, 'menu') ? goTo(state, 'inventory', 0) : state;
    case 'openGallery':
      return at(state, 'menu') ? goTo(state, 'gallery', 0) : state;
    case 'openBag':
      return at(state, 'menu') ? goTo(state, 'bag', 0) : state;
    case 'openNest':
      return at(state, 'menu') ? goTo(state, 'nest', 0) : state;
    case 'closeBag':
      return at(state, 'bag') ? goTo(state, 'menu', 0) : state;
    case 'closeNest':
      return at(state, 'nest') ? goTo(state, 'menu', 0) : state;
    case 'backToMenu':
      // 背包 / 总览 / 网格 / 嵌套的返回按钮都走这条
      return at(state, 'inventory') || at(state, 'gallery') || at(state, 'bag') || at(state, 'nest')
        ? goTo(state, 'menu', 0)
        : state;
    // 按压/滚动是交互层，任何界面都能更新（切界面时已被 goTo 清空）
    case 'press':
      return { ...state, press: action.state };
    case 'scrollTo': {
      // 状态层只做数据校验（有限、非负）；「这个容器能不能滚、钳到多少」由事件侧按
      // 容器内容高/视口高算好（`core/ui/scroll.ts` / `wheel.ts` 的同一套口径）。
      if (!Number.isFinite(action.offset) || action.offset < 0) return state;
      return { ...state, scrolls: { ...state.scrolls, [action.name]: action.offset } };
    }
    case 'select': {
      // 背包（列表）与网格背包里能选；下标非法（NaN / 越界）当没点中，不改状态
      if (state.screen !== 'inventory' && state.screen !== 'bag') return state;
      if (!Number.isFinite(action.index) || action.index < 0 || action.index >= ITEMS.length) return state;
      return { ...state, selected: Math.floor(action.index) };
    }
  }
};

/** 评级（结算面板用）。 */
export const gradeOf = (hits: number): string => (hits >= TARGET ? '完美' : hits >= 2 ? '不错' : '再练练');

/**
 * 界面里「可点组件 → 动作」的映射。
 *
 * 判定数据与界面描述分开：`.ui` 只管画，哪个组件能点、点了做什么由这里决定。
 *
 * **浮层的遮罩（节点名 `panel`）只 `hit block`、不绑动作**：T42 定的交互是
 * 「点遮罩不关闭」—— 关闭只走面板里的按钮。这样验收里「点底层按钮的位置，
 * screen 仍是 menu、modal 仍在」就能唯一证明遮罩吃掉了点击（没穿透）。
 *
 * 背包的 `list` 与网格背包的 `grid` 都没有静态 action：点第几项 / 第几格要按
 * 「手指坐标 + 组件矩形 + 滚动位」算下标，由 `game.ts` 在命中时调 core 的
 * `listIndexAt` / `gridIndexAt` 后发 `select`。
 */
export const ACTION_OF: Readonly<Record<Screen, Readonly<Record<string, Action>>>> = {
  menu: {
    // 「开始」是三态通用按钮；另外几个入口用内置组件（组件名不能重名）
    button: { kind: 'start' },
    primaryButton: { kind: 'openInventory' },
    secondaryButton: { kind: 'openPopup' },
    // card0 当「组件总览」入口：内置卡片件，点它进 gallery
    card0: { kind: 'openGallery' },
    // T32：两个半屏弹窗入口（card1 与 infoPanel 是菜单里还没用过的组件名）
    card1: { kind: 'openSheet' },
    infoPanel: { kind: 'openHalf' },
    // T35：提示入口 —— toast 画成提示条，点它弹 tip 浮层（at 30%/70% 的 +1 金币）
    toast: { kind: 'openTip' },
    // T35：网格背包入口 —— 内置 parcelGrid 画的是 3×2 格网，语义正好是「网格」
    parcelGrid: { kind: 'openBag' },
    // T38：嵌套滚动入口 —— coinBadge 在菜单里还没用过，放右上角画成「嵌套滚动」小条
    coinBadge: { kind: 'openNest' },
  },
  play: { tapTarget: { kind: 'hit' }, secondaryButton: { kind: 'giveUp' } },
  result: { primaryButton: { kind: 'restart' } },
  // 浮层：只有面板里的按钮能关；遮罩 `hit block` 只吃点击（点遮罩不关，见上）
  popup: { primaryButton: { kind: 'closePopup' } },
  sheet: { primaryButton: { kind: 'closeSheet' } },
  half: { primaryButton: { kind: 'closeHalf' } },
  inventory: { button: { kind: 'backToMenu' } },
  // 组件总览：返回 + 「弹窗」入口 —— 验收第 3 条要在 gallery 滚 300 后开/关浮层，
  // 所以这个界面必须有能打开浮层的触发点
  gallery: { button: { kind: 'backToMenu' }, secondaryButton: { kind: 'openSheet' } },
  bag: { button: { kind: 'closeBag' } },
  // nest（嵌套滚动）只演示滚轮语义，返回按钮和背包/总览同一条路径
  nest: { button: { kind: 'backToMenu' } },
  // tip 是纯展示浮层：没有可点组件，1 秒后自己消失（底层一直可见）
  tip: {},
};
