/**
 * `.ui` 层引擎（T45）：HUD + 触屏按键 + 通关 / 失败浮层。
 *
 * 为什么游戏里还要写这百来行：runtime 提供的是 `.ui` 的**编译 / 绑定 / 布局**能力
 * （compile → bind → layout → 组件 draw），没有「一键渲染 ScreenLayout」这种
 * 属于游戏装配层的 API（ui-demo 也是自己写的）。这里抄的是同一套结构，
 * 但没有 import 任何 ui-demo 代码（那是另一个游戏）。
 *
 * 四层渲染由 `game.ts` 调度：世界（canvas）→ 触屏按键（本文件）→ HUD（本文件）
 * → 浮层（本文件）。
 * 本文件只做三件事：
 * 1. `bindComponents` 量尺寸（布局期）→ `layout()` 求解矩形；
 * 2. 每帧把金币 / 生命 / 进度 / 按键按下态这些**动态值注入 props**（`.ui` 里只写初值）；
 * 3. 按 `paintOrder` 正序逐组件 `draw()`（不清屏、不画背景 —— 底层游戏画面保留）。
 *
 * 数据双通道（docs 里刚写的那条）：`bindComponents` 的 `env.data` 与绘制期
 * `DrawDeps.data` 必须给**同一份快照**，否则「量出来的」和「画出来的」会来自两份
 * 不同数据。当前 HUD 的文本走 props（不是数据驱动组件），这里仍把同一份 data
 * 同时传给两边，保证以后换成 list / tabs 这类数据组件时不会踩坑。
 *
 * T80：触屏按键从 `render.ts` 手绘迁到本层。旧的 `TOUCH` 常量是 390×844 的绝对坐标，
 * 画在窄画框（PC 预览的 iframe、小屏手机）里会跑出画布；现在位置由
 * `ui/controls.ui` 的约束算出，**画与命中都用 layout 出来的同一份矩形**。
 */

import controlsUi from '../../ui/controls.ui';
import gameoverUi from '../../ui/gameover.ui';
import hudUi from '../../ui/hud.ui';
import winUi from '../../ui/win.ui';
import { bindComponents, DEFAULT_THEME, layout } from './deps';
import type {
  ComponentDef,
  ComponentRegistry,
  Ctx2D,
  DrawDeps,
  HitEntry,
  LayoutSpec,
  LayoutViewport,
  Rect,
  StyleProps,
  UiData,
} from './deps';
import { COINS } from './level';
import type { GameState } from './state';
import { createPlatformerRegistry, TOUCH_NODES } from './ui-registry';

/** HUD / 浮层用到的层名（同时是 `.ui` 文件名的语义标识）。 */
export type UiLayerName = 'controls' | 'hud' | 'win' | 'gameover';

/** 三个触屏按键的按下态（每帧从输入注入 `.ui`）。 */
export interface PressedKeys {
  readonly left: boolean;
  readonly right: boolean;
  readonly jump: boolean;
}

/** 什么都没按（初值 / 单测默认）。 */
export const IDLE_PRESSED: PressedKeys = { left: false, right: false, jump: false };

/** 一份求解好的 `.ui` 层（矩形 + 绘制顺序 + 组件定义 + 合并后的 props）。 */
export interface UiLayer {
  readonly name: UiLayerName;
  readonly rects: Readonly<Record<string, Rect>>;
  readonly paintOrder: readonly string[];
  readonly components: Readonly<Record<string, ComponentDef>>;
  readonly props: Readonly<Record<string, StyleProps>>;
  readonly data: UiData;
  readonly errors: readonly string[];
}

export interface UiEngine {
  readonly registry: ComponentRegistry;
  /** HUD 层（每帧都在）；`offset` 用于系统胶囊避让（T49，web 恒为 0） */
  hud(viewport: LayoutViewport, state: GameState, offset?: HudOffset): UiLayer;
  /** 触屏按键层：矩形由 `ui/controls.ui` 算出，绘制与命中都用它 */
  controls(viewport: LayoutViewport, state: GameState, pressed: PressedKeys): UiLayer;
  /** 浮层：won / gameover 时返回对应 `.ui`，其余 phase 返回 null */
  modal(viewport: LayoutViewport, state: GameState): UiLayer | null;
  /** 画一层（不清屏，只画组件） */
  draw(ctx: Ctx2D, layer: UiLayer): void;
}

const SPEC_OF: Readonly<Record<UiLayerName, { readonly spec: LayoutSpec }>> = {
  controls: controlsUi,
  hud: hudUi,
  win: winUi,
  gameover: gameoverUi,
};

/** 统一的暗底亮字主题（游戏是深色场景）。 */
const THEME = { ...DEFAULT_THEME, ink: '#edf4ee', light: '#edf4ee' };

/** 这个游戏不引美术：所有组件走纯色回落。 */
const EMPTY_ASSETS = { get: (): null => null };

/** 金币总数（进度条 max）。 */
const TOTAL_COINS = COINS.length;

/** 每帧动态 props：按键按下态 / 金币 / 生命 / 收集进度 / 结算统计。 */
const dynamicPropsOf = (
  name: UiLayerName,
  state: GameState,
  pressed: PressedKeys,
): Readonly<Record<string, StyleProps>> => {
  if (name === 'controls') {
    return {
      touchLeft: { pressed: pressed.left },
      touchRight: { pressed: pressed.right },
      touchJump: { pressed: pressed.jump },
    };
  }
  if (name === 'hud') {
    return {
      coinBadge: { label: `金币 ${state.coins}` },
      label: { text: `生命 ×${state.lives}` },
      statusText: { label: '关卡 1/1' },
      progress: { value: state.coins, max: TOTAL_COINS },
    };
  }
  if (name === 'win') {
    return {
      label: { text: '到达终点！' },
      statusText: { label: `金币 ${state.coins}/${TOTAL_COINS} · 生命 ${state.lives}` },
    };
  }
  return {
    label: { text: '生命用完' },
    statusText: { label: `金币 ${state.coins} · 按按钮重开` },
  };
};

/** 静态 props（`.ui` 的 style）与动态 props 合并：**逐键覆盖，不整对象替换**。 */
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

/**
 * 指针命中：逆序遍历 `paintOrder`（后画的在上面）找第一个包含该点的节点。
 *
 * 浮层里的遮罩是 `hit block`，所以点在遮罩空白处会命中 `panel`（不是按钮），
 * 不会误触发「再来一次」；只有真的点在按钮矩形里才返回 `primaryButton`。
 */
export const hitLayer = (layer: UiLayer, x: number, y: number): string | null => {
  for (let index = layer.paintOrder.length - 1; index >= 0; index -= 1) {
    const name = layer.paintOrder[index];
    if (name === undefined) continue;
    const rect = layer.rects[name];
    if (rect === undefined) continue;
    if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) return name;
  }
  return null;
};

/**
 * 触屏按键的命中表：矩形直接取 `.ui` 解出来的那一份，所以「画在哪」和「点在哪」
 * 永远是同一份数据。
 *
 * 旧实现用写死的 `TOUCH` 常量（390×844 坐标系），画与点虽然同源但都不随视口变化 ——
 * 放进窄画框时按钮会跑到画布外，点也点不中。改成从 layout 结果派生后任何视口都对得上。
 */
export const touchEntriesOf = (rects: Readonly<Record<string, Rect>>): readonly HitEntry[] => {
  const out: HitEntry[] = [];
  TOUCH_NODES.forEach(([action, node], index) => {
    const rect = rects[node];
    if (rect !== undefined) out.push({ name: action, rect, hit: 'self', layer: 0, index });
  });
  return out;
};

/** 当前应该画几层（自下而上；不含世界层，世界由 canvas 手绘）。 */
export const uiLayerNames = (state: GameState): readonly UiLayerName[] => {
  if (state.phase === 'won') return ['controls', 'hud', 'win'];
  if (state.phase === 'gameover') return ['controls', 'hud', 'gameover'];
  return ['controls', 'hud'];
};

/** HUD 内容与系统胶囊之间至少留的视觉间隙（逻辑像素）。 */
export const HUD_MENU_GAP = 8;

/** HUD 整体偏移（逻辑像素；web 恒为 0）。 */
export interface HudOffset {
  readonly x: number;
  readonly y: number;
}

/** 无偏移（web / 桌面 / 没有系统胶囊的宿主）。 */
export const ZERO_HUD_OFFSET: HudOffset = { x: 0, y: 0 };

/**
 * HUD 整体偏移（T49）：宿主有系统胶囊（微信/抖音右上角）时，把 HUD 挪到胶囊下方。
 *
 * 为什么是「整体下移」而不是「收窄宽度再重排」：`.ui` 是静态布局，收窄视口宽度会让
 * 窄屏（320×568）上的 HUD 行直接溢出（实测 coinBadge+label 需要 230px，胶囊左侧只剩
 * 203px）——那是把布局搞坏，不是避让。整体下移**不动任何行列约束**，只把解出来的
 * 矩形整体平移，所有屏幕宽度都不会溢出。
 *
 * 三条边界（都有单测）：
 * - `menuButton === undefined`（**web / 桌面 / 老基础库**）→ 返回零偏移，
 *   布局逐像素不变；这是回归风险最大的地方（web 上 HUD 不能因为避让而错位或消失）；
 * - 胶囊数据坏了（h <= 0 / 偏移超过屏高 25%）→ 退回零偏移：宁可能被胶囊压住，
 *   也不能把 HUD 挪到屏幕外（那等于整块消失）；
 * - 偏移只作用于 HUD 层：通关 / 失败浮层仍按整屏居中（胶囊只压顶部，不压浮层）。
 *
 * 顶部安全区 / 系统按钮的通用抄法（给别的游戏）：**不要**把胶囊坐标写进 `.ui`，
 * 而是像这里一样在 layout 之后按运行时矩形平移（或等 `.ui` 支持 inset 后注入）；
 * 无系统 UI 的平台必须走「零偏移」分支，这样 web 与真机才能用同一份验收脚本对比。
 */
export const hudOffsetFor = (
  screen: {
    readonly height: number;
    readonly menuButton?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  },
  gap: number = HUD_MENU_GAP,
): HudOffset => {
  const menu = screen.menuButton;
  if (menu === undefined) return ZERO_HUD_OFFSET;
  if (!Number.isFinite(menu.y) || !Number.isFinite(menu.h) || menu.h <= 0) return ZERO_HUD_OFFSET;
  const y = menu.y + menu.h + gap;
  if (!Number.isFinite(screen.height) || y > screen.height * 0.25) return ZERO_HUD_OFFSET;
  return { x: 0, y };
};

/** 按偏移平移一层的矩形（不改入参；偏移为 0 时原样返回，保持引用稳定）。 */
const shiftRects = (
  rects: Readonly<Record<string, Rect>>,
  offset: HudOffset,
): Readonly<Record<string, Rect>> => {
  if (offset.x === 0 && offset.y === 0) return rects;
  const out: Record<string, Rect> = {};
  for (const [name, rect] of Object.entries(rects)) {
    out[name] = { x: rect.x + offset.x, y: rect.y + offset.y, w: rect.w, h: rect.h };
  }
  return out;
};

export const createUiEngine = (): UiEngine => {
  // 注册表挂在引擎实例上（不是模块级可变单例）：构建期与运行时同一份
  const registry = createPlatformerRegistry();

  const compute = (
    name: UiLayerName,
    viewport: LayoutViewport,
    state: GameState,
    offset: HudOffset = ZERO_HUD_OFFSET,
    pressed: PressedKeys = IDLE_PRESSED,
  ): UiLayer => {
    // 双通道的同一份数据快照
    const data: UiData = { coins: state.coins, lives: state.lives, phase: state.phase };
    const bound = bindComponents(SPEC_OF[name].spec, { registry, env: { viewport, data } });
    const solved = layout(bound.spec, viewport);
    return {
      name,
      rects: shiftRects(solved.rects, offset),
      paintOrder: solved.paintOrder,
      components: bound.components,
      props: mergeProps(bound.props, dynamicPropsOf(name, state, pressed)),
      data,
      errors: [...bound.errors, ...solved.errors],
    };
  };

  const draw = (ctx: Ctx2D, layer: UiLayer): void => {
    const deps: DrawDeps = { assets: EMPTY_ASSETS, theme: THEME, data: layer.data };
    // save/restore 包一层：任何组件忘了恢复 ctx 状态也不会污染世界 / 下一层
    ctx.save();
    for (const name of layer.paintOrder) {
      const def = layer.components[name];
      const rect = layer.rects[name];
      if (def === undefined || rect === undefined) continue;
      def.draw(ctx, rect, layer.props[name] ?? {}, deps);
    }
    ctx.restore();
  };

  return {
    registry,
    hud: (viewport, state, offset) => compute('hud', viewport, state, offset),
    controls: (viewport, state, pressed) => compute('controls', viewport, state, ZERO_HUD_OFFSET, pressed),
    modal(viewport, state): UiLayer | null {
      if (state.phase === 'won') return compute('win', viewport, state);
      if (state.phase === 'gameover') return compute('gameover', viewport, state);
      return null;
    },
    draw,
  };
};
