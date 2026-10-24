/**
 * 只读调试钩子：把运行时状态与布局挂到 `globalThis.__mg`。
 *
 * 严格只读（与模板同款约定）：`Object.defineProperty` + getter，每次读都是新快照，
 * 没有任何改状态的入口 —— 自动化验证读到的必须是玩家真实能到达的状态。
 *
 * T13d 起状态快照带交互字段（`press.pressed` / `scrolls` / `selected`）：
 * 「按下按钮视觉变 pressed」「拖动 / 滚轮后各容器的滚动位」「点了第几项」都要能被验收读到，
 * 否则只能靠截图猜。T38 起滚动位是**按容器名分开**的（`scrolls.list` / `scrolls.grid` /
 * `scrolls.scroll`），嵌套用例才能断言「只滚了内层、外层没动」。
 *
 * T42：浮层叠加后有两份布局，快照分开暴露：
 * - `layers`：自下而上的层名，如 `['menu']` / `['gallery','sheet']`；
 * - `layout`：底层矩形（与 T42 之前兼容，仍是 `组件名 → 矩形`）；
 * - `overlay`：浮层矩形；没有浮层时 null（浮层的 `panel` 与底层的 `panel` 会重名，
 *   合成一张表反而没法断言）。
 */

import type { PlatformAdapter } from './deps';
import type { Game } from './game';
import type { DemoState } from './state';

interface RectSnapshot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

type RectMap = Readonly<Record<string, RectSnapshot>>;

export interface MgDebugSnapshot {
  readonly state: DemoState;
  /** 当前画的层（自下而上）；只有底层时是 `[screen]` */
  readonly layers: readonly string[];
  /** 底层布局矩形 */
  readonly layout: RectMap;
  /** 浮层布局矩形；没有浮层时 null */
  readonly overlay: RectMap | null;
  /** 布局期错误（底层 + 浮层合并；为空说明画面是干净的） */
  readonly errors: readonly string[];
  readonly platform: {
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly dpr: number;
  };
}

/** 装只读钩子。同一个页面重复调用会抛错（configurable:false），所以只装一次。 */
export const installDebugHook = (game: Game, platform: PlatformAdapter): void => {
  Object.defineProperty(globalThis, '__mg', {
    configurable: false,
    enumerable: true,
    get: (): MgDebugSnapshot => {
      const overlay = game.overlay;
      return {
        state: game.state,
        layers: overlay === null ? [game.state.screen] : [game.state.screen, overlay.screen],
        layout: game.layout.rects,
        overlay: overlay === null ? null : overlay.rects,
        errors: [...game.layout.errors, ...(overlay?.errors ?? [])],
        platform: {
          name: platform.name,
          width: platform.screen.width,
          height: platform.screen.height,
          dpr: platform.screen.dpr,
        },
      };
    },
  });
};
