/**
 * 对外契约：`GameOptions` / `Game`。
 *
 * 为什么单独一个文件：`game.ts` 已经贴着 AGENTS.md 铁律 2 的单文件 300 行上限，
 * 而这两个 interface 描述的是「外部调用方依赖什么」，与「游戏怎么跑」无关；
 * 拆开后 `debug.ts` 这类调用方也不用为一个类型把整个 game.ts 拖进依赖。
 */

import type { DebugInfo } from './debug-info';
import type { MenuButtonRect } from './deps';
import type { GameState } from './state';

/** 游戏可选项（只有验收相关的注入口子，玩法参数不在这里）。 */
export interface GameOptions {
  /**
   * 覆盖 `platform.screen.menuButton`（T49 验收专用）：web 端没有系统胶囊，
   * CDP 需要注入假矩形才能验证避让；生产入口不传，真机走 `platform.screen.menuButton`。
   */
  readonly menuButtonOverride?: MenuButtonRect;
}

export interface Game {
  readonly state: GameState;
  readonly debug: DebugInfo;
  start(): void;
  stop(): void;
}
