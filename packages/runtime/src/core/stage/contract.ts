/**
 * 场景栈契约。
 *
 * 为什么是栈：小游戏最常见的结构是「游戏 → 暂停面板 → 设置 → 确认框」，
 * 一层盖一层，关掉回到上一层。用栈表达最直接，不用自己维护状态机。
 *
 * 两种屏幕：
 * - 普通屏（默认）：游戏画面，栈顶接收输入；
 * - 模态屏（modal=true）：暂停面板、弹窗。它会挡住下层，下层不 update 也不 render。
 * - 非模态屏（modal=false）：HUD 叠加层。下层继续 update 和 render，它自己画在最上面。
 */

import type { Ctx2D } from '../../platform/contract';

/** 一个界面。所有方法都可选：纯展示屏只实现 render 就够。 */
export interface Screen {
  /** 入栈时调用一次 */
  enter?(): void;
  /** 出栈时调用一次 */
  exit?(): void;
  /** 固定步长更新，dt 单位为秒 */
  update?(dt: number): void;
  /** 每帧渲染，alpha 为插值系数 0..1。只读状态，不做判定。 */
  render?(ctx: Ctx2D, alpha: number): void;
}

export interface PushOptions {
  /** true（默认）= 模态，挡住下层；false = 叠加层，下层继续跑 */
  readonly modal?: boolean;
}

export interface Stage {
  push(screen: Screen, opts?: PushOptions): void;
  pop(): Screen | null;
  replace(screen: Screen): void;
  /** 栈顶屏幕；空栈为 null */
  readonly current: Screen | null;
  readonly depth: number;
  /** 从最上面一个模态屏（含）开始往下到栈顶，逐层 update */
  update(dt: number): void;
  /** 从最上面一个模态屏（含）开始往下到栈顶，逐层 render */
  render(ctx: Ctx2D, alpha: number): void;
  /** 清空栈：从顶到底逐层 exit */
  clear(): void;
}

export type CreateStage = () => Stage;
