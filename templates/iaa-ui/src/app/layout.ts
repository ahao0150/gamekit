/**
 * 界面布局：`.ui` 产物 + 组件注册表 → 每个界面的组件矩形。
 *
 * 全链路：`.ui` 源码（构建期由 `@mg/ui-plugin` 编译成数据模块）→ `bindComponents`
 * 注入组件的 `measure()` → `layout()` 求解。**这里没有任何手写坐标**，换屏型只是
 * 换 viewport。
 *
 * 数据走单通道：`compute` 收到的 `data` 挂在 `ScreenLayout.data` 上，绘制期直接读，
 * 避免「布局有、绘制无」导致画面全空（见 `resolveUiData`）。
 */

import homeUi from '../../ui/home.ui';
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
import { SCORE_GOAL } from './state';
import type { GameState, Screen } from './state';
import { createRegistry } from './ui-registry';

/** 各界面（这里是编译产物；构建期由插件从 `.ui` 生成）。 */
const UI_OF: Readonly<Record<Screen, { readonly spec: LayoutSpec }>> = {
  home: homeUi,
};

export interface ScreenLayout {
  readonly screen: Screen;
  readonly viewport: LayoutViewport;
  /** 组件名 → 矩形（逻辑像素） */
  readonly rects: Readonly<Record<string, Rect>>;
  /** 绘制顺序（正序）：渲染按它画，命中按它逆序 */
  readonly paintOrder: readonly string[];
  /** 组件名 → 层 / 命中语义（来自 `.ui` 的 `layer` 与 `put ... hit`） */
  readonly meta: Readonly<Record<string, NodeMeta>>;
  /** 组件名 → 组件定义（绘制期按名字取） */
  readonly components: Readonly<Record<string, ComponentDef>>;
  /** 组件名 → 参数（静态 style 与动态状态合并后） */
  readonly props: Readonly<Record<string, StyleProps>>;
  /** 与布局期同源的 UI 数据（绘制期必须用这一份） */
  readonly data: UiData;
  /** 绑定期 + 布局期错误（中文）；为空表示这个界面是干净的 */
  readonly errors: readonly string[];
}

export interface LayoutEngine {
  /** 构建期与运行时共用的那一份注册表（渲染层也用它） */
  readonly registry: ComponentRegistry;
  compute(screen: Screen, viewport: LayoutViewport, state: GameState, data?: UiData): ScreenLayout;
}

/** 动态 props：每帧可能在变的值（分数、提示文案）。静态文案留在 `.ui` 的 style 里。 */
const dynamicProps = (state: GameState): Readonly<Record<string, StyleProps>> => ({
  progress: { value: state.score, max: SCORE_GOAL },
  toast: { text: state.hint },
});

/**
 * 静态 props（`.ui` 的 style）与动态 props 合并：**逐键覆盖，不整对象替换**。
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
  const registry = createRegistry();
  return {
    registry,
    compute(screen, viewport, state, data = {}): ScreenLayout {
      const bound = bindComponents(UI_OF[screen].spec, { registry, env: { viewport, data } });
      const solved = layout(bound.spec, viewport);
      return {
        screen,
        viewport,
        rects: solved.rects,
        paintOrder: solved.paintOrder,
        meta: solved.meta,
        components: bound.components,
        props: mergeProps(bound.props, dynamicProps(state)),
        data,
        errors: [...bound.errors, ...solved.errors],
      };
    },
  };
};
