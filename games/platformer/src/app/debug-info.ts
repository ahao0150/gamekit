/**
 * 调试快照的构造（T45 从 game.ts 拆出，守单文件 ≤300 行）。
 *
 * 只读：每次 `get debug()` 都现造一个新对象，**没有任何 setter** —— 自动化验收
 * 只能读状态，不能自己写金币/生命来「通过」测试。
 */

import type { Entities } from './entities';
import type { FrameTiming } from './perf';
import type { GameState } from './state';

/** 调试快照（CDP 验收只读它，没有任何改状态的入口）。 */
export interface DebugInfo {
  readonly player: { readonly x: number; readonly y: number; readonly vx: number; readonly vy: number; readonly onGround: boolean };
  readonly phase: GameState['phase'];
  readonly lives: number;
  readonly coins: number;
  readonly enemies: readonly { readonly id: number; readonly x: number; readonly y: number; readonly alive: boolean }[];
  readonly coinsLeft: number;
  readonly goal: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly camera: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** 渲染剔除统计（本帧）：实体总数 / 实际绘制数 */
  readonly cull: { readonly total: number; readonly drawn: number };
  /** 最近一次踩怪发生时的玩家状态（只读遥测：验收用「下落中踩到」的直接证据） */
  readonly lastStomp: { readonly x: number; readonly y: number; readonly vy: number } | null;
  readonly keys: { readonly left: boolean; readonly right: boolean; readonly jump: boolean };
  /** 当前被手指按着的触屏按钮名（去重；验收「按住左再按跳，左仍在」的直接证据） */
  readonly touch: readonly string[];
  /** 生效的系统胶囊矩形（T49）：平台真实值或验收注入值；web 无注入时为 null */
  readonly menuButton: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
  /** 每帧耗时埋点（布局 / 绘制 / 帧间隔的滑动平均 + 峰值） */
  readonly timing: FrameTiming;
  /** 当前画面由哪几层组成（自下而上）：世界 → HUD → 浮层 */
  readonly layers: readonly string[];
  /** 最近一帧 `.ui` 绑定/布局错误（空 = 干净） */
  readonly uiErrors: readonly string[];
  /** 最近一帧 `.ui` 矩形（HUD 恒有；modal 只在通关/失败时非 null） */
  readonly uiRects: {
    readonly hud: Readonly<Record<string, { readonly x: number; readonly y: number; readonly w: number; readonly h: number }>>;
    readonly modal: Readonly<Record<string, { readonly x: number; readonly y: number; readonly w: number; readonly h: number }>> | null;
  };
}

/** 构造快照需要的全部输入（都是当前帧的只读值）。 */
export interface DebugInputs {
  readonly state: GameState;
  readonly entities: Entities;
  readonly cameraVisible: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly cull: { readonly total: number; readonly drawn: number };
  readonly lastStomp: { readonly x: number; readonly y: number; readonly vy: number } | null;
  readonly keys: { readonly left: boolean; readonly right: boolean; readonly jump: boolean };
  readonly touch: readonly string[];
  readonly menuButton: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
  readonly timing: FrameTiming;
  readonly layers: readonly string[];
  readonly uiErrors: readonly string[];
  readonly uiRects: DebugInfo['uiRects'];
}

export const buildDebugInfo = (input: DebugInputs): DebugInfo => ({
  player: {
    x: input.state.player.x,
    y: input.state.player.y,
    vx: input.state.player.vx,
    vy: input.state.player.vy,
    onGround: input.state.player.onGround,
  },
  phase: input.state.phase,
  lives: input.state.lives,
  coins: input.state.coins,
  enemies: input.entities.enemies.map((enemy) => ({
    id: enemy.id, x: enemy.x, y: enemy.y, alive: enemy.alive,
  })),
  coinsLeft: input.entities.coins.filter((coin) => !coin.taken).length,
  goal: input.entities.goal,
  camera: input.cameraVisible,
  cull: input.cull,
  lastStomp: input.lastStomp,
  keys: input.keys,
  touch: input.touch,
  menuButton: input.menuButton,
  timing: input.timing,
  layers: input.layers,
  uiErrors: input.uiErrors,
  uiRects: input.uiRects,
});
