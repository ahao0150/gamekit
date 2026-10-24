/**
 * 只读调试钩子：把运行时快照挂到 `globalThis.__mg`。
 *
 * 为什么严格只读：自动化要验证「游戏真的能玩」，所以测试只能读状态、**不能改**。
 * 一旦能给测试一个改状态的入口，测试就可以自己把金币写上去，验证的就变成了自己骗自己。
 * 这里只暴露 `Game.debug` 的即时快照（每次读都是新对象）与平台信息。
 */

import type { PlatformAdapter } from './deps';
import type { DebugInfo } from './debug-info';
import type { Game } from './game';

export interface MgDebugSnapshot {
  readonly game: DebugInfo;
  readonly platform: {
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly dpr: number;
    /** 系统胶囊（微信/抖音）；web 端为 null —— HUD 是否避让以它为准（T49） */
    readonly menuButton: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
  };
}

export const installDebugHook = (game: Game, platform: PlatformAdapter): void => {
  Object.defineProperty(globalThis, '__mg', {
    configurable: false,
    enumerable: true,
    get: (): MgDebugSnapshot => ({
      game: game.debug,
      platform: {
        name: platform.name,
        width: platform.screen.width,
        height: platform.screen.height,
        dpr: platform.screen.dpr,
        menuButton: platform.screen.menuButton ?? null,
      },
    }),
  });
};
