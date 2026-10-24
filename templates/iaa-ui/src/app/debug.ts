/**
 * 只读调试钩子：把运行时状态与布局挂到 `globalThis.__mg`。
 *
 * 严格只读：`Object.defineProperty` + getter，每次读都是新快照，没有任何改状态的
 * 入口 —— 自动化验证读到的必须是玩家真实能到达的状态，不能给测试写后门。
 *
 * 这是**模板示例**的调试出口，业务游戏不必照抄。
 */

import type { PlatformAdapter } from './deps';
import type { Game } from './game';
import type { GameState } from './state';

interface RectSnapshot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface MgDebugSnapshot {
  readonly state: GameState;
  readonly layout: Readonly<Record<string, RectSnapshot>>;
  /** 布局期错误（为空说明界面是干净的） */
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
    get: (): MgDebugSnapshot => ({
      state: game.state,
      layout: game.layout.rects,
      errors: game.layout.errors,
      platform: {
        name: platform.name,
        width: platform.screen.width,
        height: platform.screen.height,
        dpr: platform.screen.dpr,
      },
    }),
  });
};
