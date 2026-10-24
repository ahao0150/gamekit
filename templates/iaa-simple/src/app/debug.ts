/**
 * 只读调试钩子：把运行时状态挂到 `globalThis.__mg`。
 *
 * 为什么需要：
 * 自动化验证要读「运行时真实分数」和「按钮真实位置」，
 * 但**不能**给测试任何改状态的入口 —— 一旦能改，测试就可以自己把分数写上去，
 * 那验证的就是「测试自己骗自己」，不是「游戏真的能玩」。
 *
 * 因此这里严格只读：
 * 1. 用 `Object.defineProperty` + getter，`__mg` 本身不可被替换（configurable: false）；
 * 2. 每次读都是**新快照**（深拷贝），拿到的东西改了也影响不到游戏；
 * 3. 没有任何 setter、没有任何能触发状态变更的方法（不暴露 tap / watchRewarded）。
 *
 * 注意：这是**模板示例**的调试出口，业务游戏项目不必照抄。
 */

import type { PlatformAdapter } from './deps';
import type { Game } from './game';

interface RectSnapshot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 一次快照的内容。 */
export interface MgDebugSnapshot {
  readonly state: {
    readonly score: number;
    readonly rewardedCount: number;
    readonly hint: string;
  };
  readonly layout: {
    readonly safe: RectSnapshot;
    readonly scoreBar: RectSnapshot;
    readonly tapButton: RectSnapshot;
    readonly rewardedButton: RectSnapshot;
    readonly bannerSlot: RectSnapshot;
    readonly hintArea: RectSnapshot;
  };
  readonly platform: {
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly dpr: number;
    readonly insets: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  };
}

const copyRect = (r: { x: number; y: number; w: number; h: number }): RectSnapshot => ({
  x: r.x,
  y: r.y,
  w: r.w,
  h: r.h,
});

/** 装只读钩子。同一个页面重复调用会抛错（configurable:false），所以只装一次。 */
export const installDebugHook = (game: Game, platform: PlatformAdapter): void => {
  Object.defineProperty(globalThis, '__mg', {
    configurable: false,
    enumerable: true,
    get: (): MgDebugSnapshot => {
      const layout = game.layout;
      return {
        state: { ...game.state },
        layout: {
          safe: copyRect(layout.safe),
          scoreBar: copyRect(layout.scoreBar),
          tapButton: copyRect(layout.tapButton),
          rewardedButton: copyRect(layout.rewardedButton),
          bannerSlot: copyRect(layout.bannerSlot),
          hintArea: copyRect(layout.hintArea),
        },
        platform: {
          name: platform.name,
          width: platform.screen.width,
          height: platform.screen.height,
          dpr: platform.screen.dpr,
          insets: { ...platform.screen.insets },
        },
      };
    },
  });
};
