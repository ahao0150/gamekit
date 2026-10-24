/**
 * 软键盘（系统输入法）的契约面。
 *
 * 为什么不是写在 `contract.ts` 里：那个文件已经贴着单文件 300 行上限（AGENTS 铁律 2），
 * 而键盘是**独立能力面**（web 造 `<input>`、wx/tt 调 showKeyboard），拆开不影响
 * 「契约只在一处」—— 对外导入路径仍然是 `platform/contract`，由它 re-export。
 *
 * 语义要点：
 * 1. 软键盘 ≠ 物理键盘。`Capability` 里两个能力位分开：`keyboard` 是桌面物理键盘
 *    （小游戏恒 false），`soft-keyboard` 是三端都有的系统输入法；
 * 2. 必须能感知「收起」（`onClose`），否则界面会卡在聚焦态，见 KeyboardService 注释；
 * 3. 长度 / 确认键这些参数由 `keyboard-utils.ts` 归一，三端不许各判一遍。
 */

import type { Unsubscribe } from './contract';

/** 输入框在画布上的位置（逻辑像素，相对画布左上角）。 */
export interface KeyboardRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 唤起系统键盘的参数。
 *
 * `rect` / `textSize` 只有 web 需要（它要造一个真 `<input>` 盖在画布上）；
 * wx / tt 的 `showKeyboard` 由系统自己弹键盘，忽略它们 —— 这不影响契约一致性：
 * 给了没用比不给却得崩要好。
 */
export interface KeyboardOptions {
  readonly defaultValue?: string;
  readonly maxLength?: number;
  readonly confirmType?: 'done' | 'next' | 'search' | 'send';
  /** web 专用：输入框覆盖的位置（缺省放画布顶部居中，只在没有布局信息时兜底）。 */
  readonly rect?: KeyboardRect;
  /** web 专用：叠在画布上的输入框字号（CSS 像素），与组件 `textSize` 对齐才不违和。 */
  readonly textSize?: number;
}

/**
 * 系统键盘服务。
 *
 * 为什么 `onClose` 是必需的：输入类界面必须知道「键盘收了、焦点没了」才能把
 * 组件画回未聚焦态。只有 onInput / onConfirm 时，用户点空白收起键盘，
 * 游戏界面就会永远停在「光标闪烁但键盘不在了」的样子。
 * 三端都有对应事件：wx 的 `onKeyboardComplete`、tt 的 `onKeyboardComplete` /
 * `onKeyboardConfirm` 兜底、web 的 `blur`。
 */
export interface KeyboardService {
  /** 唤起系统键盘。重复调用 = 先关再开（避免两个输入框同时抢焦点）。 */
  open(opts?: KeyboardOptions): void;
  /** 收起键盘（不改输入值）。 */
  close(): void;
  /** 每次输入变化（可能每次按键都触发，含中文输入法的拼音中间态，调用方自己做节流/去抖）。 */
  onInput(cb: (value: string) => void): Unsubscribe;
  /** 用户点「完成 / 发送」等确认键。 */
  onConfirm(cb: (value: string) => void): Unsubscribe;
  /** 键盘关闭（确认键 / 点空白 / 系统收回），带回最后一次的值。 */
  onClose(cb: (value: string) => void): Unsubscribe;
}
