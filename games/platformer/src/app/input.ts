/**
 * 输入状态机（T49）：键盘 + 多点触控 → 三个动作键（left / right / jump）。
 *
 * 为什么抽出来：`game.ts` 已经贴着 300 行上限，而这里有一条**必须能被单测锁住**
 * 的真机 bug —— 旧实现把触屏按下的三键快照塞进一个 `held` 对象，第二根手指按下
 * 时会重算整个快照并 `setKey('left', false)`，于是「按住左移再按跳，左移被打断」。
 * 现在触屏状态交给 `core/ui/multi-press`（每个 pointerId 独立绑定），键盘与触屏
 * 各自记录、**取并集**得到最终生效的三个键，互不干扰（UI 按钮仍用 `press.ts` 语义）。
 *
 * 纯函数：输入 `旧状态 + 一个事件 → 新状态`；不碰 canvas、无全局状态、不改入参。
 * 失效绑定（手指滑出按钮 / 元素消失 / pointercancel）由 multi-press 自己解绑。
 *
 * T80：按键命中表不再写死坐标。旧实现用 `TOUCH_ENTRIES`（来自 `render.ts` 的
 * 390×844 绝对矩形），画与点虽然同源但都不随视口变化，窄画框里按钮直接跑到画布外。
 * 现在由 `setEntries()` 每帧从 `.ui` 的 layout 结果喂进来（`ui.ts` 的 `touchEntriesOf`），
 * 键盘那一路完全不受影响。
 */

import {
  EMPTY_MULTI_PRESS,
  isPressed,
  multiDown,
  multiMove,
  multiUp,
  pressedNames,
} from './deps';
import type { HitEntry, HitPoint, MultiPressState } from './deps';

/** 三个动作键（与键盘映射、触屏按钮同名）。 */
export type ActionKey = 'left' | 'right' | 'jump';

/** 固定顺序：键盘 / 触屏事件都按这个顺序同步，行为可复现。 */
export const ACTION_KEYS: readonly ActionKey[] = ['left', 'right', 'jump'];

/** 一路输入的两个来源：键盘按住的键 + 触屏每根手指绑定的按钮。 */
export interface InputState {
  readonly keyboard: Readonly<Record<ActionKey, boolean>>;
  readonly touch: MultiPressState;
}

/** 空闲输入（什么都没按）。 */
export const IDLE_INPUT: InputState = {
  keyboard: { left: false, right: false, jump: false },
  touch: EMPTY_MULTI_PRESS,
};

/** 键盘按下 / 松开。只动键盘那一路，触屏绑定原样保留。 */
export const withKey = (state: InputState, which: ActionKey, down: boolean): InputState =>
  state.keyboard[which] === down
    ? state
    : { ...state, keyboard: { ...state.keyboard, [which]: down } };

/** 只知道「这次 pointer 事件」不够：multiUp 的 cancel 分支要用 NaN 点表示「不激活」。 */
const CANCEL_POINT: HitPoint = { x: Number.NaN, y: Number.NaN };

/**
 * 触屏 pointer 事件：down 绑定这一根手指，move 滑出就解绑这一根，
 * up / cancel 解绑这一根并（up 时）丢弃激活结果 —— 这里只关心「还按着哪些键」。
 *
 * `entries` 是当前帧的按键命中表（`.ui` layout 出来的矩形）。传空表时触屏一律不响应，
 * 所以首帧还没算出布局时不会误判。
 *
 * 关键：**任何一条分支都只影响 `event.pointer.id` 对应的绑定**，其他手指的绑定
 * 原样保留，所以「松开跳键」不会松开左键。
 */
export const withPointer = (
  state: InputState,
  kind: 'down' | 'move' | 'up' | 'cancel',
  point: HitPoint,
  pointerId: number,
  entries: readonly HitEntry[],
): InputState => {
  if (entries.length === 0) return state;
  if (kind === 'down') return withTouch(state, multiDown(state.touch, entries, point, pointerId));
  if (kind === 'move') return withTouch(state, multiMove(state.touch, entries, point, pointerId));
  if (kind === 'up') {
    return withTouch(state, multiUp(state.touch, entries, point, pointerId).state);
  }
  // cancel：指针状态不明 → 只解绑这一根手指，不给激活（NaN 点 = 停在原处也不算）
  return withTouch(state, multiUp(state.touch, entries, CANCEL_POINT, pointerId).state);
};

const withTouch = (state: InputState, touch: MultiPressState): InputState =>
  touch === state.touch ? state : { ...state, touch };

/**
 * 合并后的三个动作键：`键盘按下 || 任意一根手指按着该按钮`。
 *
 * 这就是「按住左再按跳，左仍生效」的判据：两路输入取并集，后按的那个
 * 不会覆盖先按的那个。
 */
export const effectiveKeys = (state: InputState): Readonly<Record<ActionKey, boolean>> => ({
  left: state.keyboard.left || isPressed(state.touch, 'left'),
  right: state.keyboard.right || isPressed(state.touch, 'right'),
  jump: state.keyboard.jump || isPressed(state.touch, 'jump'),
});

/** 当前被手指按着的触屏按钮名（去重；调试快照与验收断言用）。 */
export const touchPressed = (state: InputState): readonly string[] => pressedNames(state.touch);

/** 三个动作键里哪些变了（game.ts 据此只对变化项做 setKey，避免重复触发跳跃）。 */
export const changedKeys = (
  before: Readonly<Record<ActionKey, boolean>>,
  after: Readonly<Record<ActionKey, boolean>>,
): readonly ActionKey[] => ACTION_KEYS.filter((which) => before[which] !== after[which]);

/** 输入控制器：游戏只喂事件、读结果；按键变化通过回调通知（跳跃边沿仍由游戏处理）。 */
export interface InputController {
  /** 当前生效的三个动作键（键盘与触屏取并集）。 */
  readonly effective: Readonly<Record<ActionKey, boolean>>;
  /** 当前被手指按着的触屏按钮名（调试快照用）。 */
  readonly pressedTouch: readonly string[];
  /** 更新触屏按键命中表（每帧从 `.ui` 的矩形派生）。 */
  setEntries(entries: readonly HitEntry[]): void;
  /** 键盘按下 / 松开（which 已由调用方从物理键映射好）。 */
  handleKey(which: ActionKey, down: boolean): void;
  /** 单根指针的 down / move / up / cancel。 */
  handlePointer(kind: 'down' | 'move' | 'up' | 'cancel', point: HitPoint, pointerId: number): void;
}

/**
 * 造一个输入控制器：内部只保留一份 `InputState`，每次事件后算出**变化了的**动作键
 * 并逐个回调 `onChange(which, down)`。游戏侧把 `setKey` 传进来即可 ——
 * 这样「第二根手指按下时左键不会被误发一次 false」由这里保证，单测直接锁这条。
 */
export const createInput = (
  onChange: (which: ActionKey, down: boolean) => void,
): InputController => {
  let state = IDLE_INPUT;
  let entries: readonly HitEntry[] = [];
  const apply = (next: InputState): void => {
    if (next === state) return;
    const before = effectiveKeys(state);
    state = next;
    const after = effectiveKeys(state);
    for (const which of changedKeys(before, after)) onChange(which, after[which]);
  };
  return {
    get effective(): Readonly<Record<ActionKey, boolean>> {
      return effectiveKeys(state);
    },
    get pressedTouch(): readonly string[] {
      return touchPressed(state);
    },
    setEntries(next: readonly HitEntry[]): void {
      entries = next;
    },
    handleKey(which: ActionKey, down: boolean): void {
      apply(withKey(state, which, down));
    },
    handlePointer(kind, point, pointerId): void {
      apply(withPointer(state, kind, point, pointerId, entries));
    },
  };
};
