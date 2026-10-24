/**
 * 鼠标滚轮事件契约（T36）。
 *
 * 为什么不在 `contract.ts` 里：那个文件贴着单文件 300 行上限（AGENTS 铁律 2），
 * 滚轮是一个独立输入面，拆开不影响「契约只在一处」——对外导入路径仍然是
 * `platform/contract`（由它 re-export），与 `keyboard-contract.ts` 同一套做法。
 *
 * 三端统一语义（写死，别各端自己解释）：
 * 1. `deltaX` / `deltaY` **已归一为像素**：web 的 `deltaMode`（0 像素 / 1 行 / 2 页）
 *    在 `wheel-utils.ts` 里换算成像素，换算只写一遍；
 * 2. 正 `deltaY` = 向下滚（看后面的内容）；正 `deltaX` = 向右滚；
 * 3. `x` / `y` 是**画布逻辑坐标**（与 `PointerSample` 同一坐标系），不是页面坐标；
 * 4. `onWheel` 是**可选成员**：手机端、老基础库没有滚轮，压根不实现它。
 *    调用方写 `platform.onWheel?.(...)` 判存在，与 `onKey?` 同一种风格 ——
 *    不新增 `Capability` 位，是因为「成员在不在」本身就是能力信号
 *    （`can('keyboard')` 那种能力位是为了给**没有对应成员**的情况留出口）。
 */

import type { Unsubscribe } from './contract';

/** 一次滚轮事件（已归一：坐标是画布逻辑坐标，delta 是像素）。 */
export interface WheelEvent {
  readonly x: number;
  readonly y: number;
  readonly deltaX: number;
  readonly deltaY: number;
  /** 事件时间戳（ms），与 PointerEvent.time 同一口径 */
  readonly time: number;
}

/** 滚轮事件回调。 */
export type WheelListener = (event: WheelEvent) => void;

/** 订阅滚轮事件，返回解绑函数。 */
export type OnWheel = (cb: WheelListener) => Unsubscribe;
