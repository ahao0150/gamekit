/**
 * mock 平台的软键盘：一个可编程的假 `KeyboardService`。
 *
 * 为什么需要它：core / 业务要测「点输入框 → 唤起键盘 → 收到值 → 画回焦点态」
 * 这条链，但不能在 node 里弹真键盘。这个替身把三件事都做成可观察的：
 * 1. `open()` 的参数被记下来（断言 maxLength / confirmType / rect 透传正确）；
 * 2. 输入 / 确认 / 收起三个事件能手动触发（`emitInput` 等）；
 * 3. `close()` 被调过几次也记下来（断言游戏侧真的收了键盘）。
 *
 * 不模拟「值截断」这类平台行为：那是平台的事，mock 上假装做了反而会让测试
 * 以为截断是引擎保证的。截断由调用方自己按 `maxLength` 判。
 */

import type { KeyboardOptions, KeyboardService, Unsubscribe } from '../contract';

export interface MockKeyboard {
  readonly keyboard: KeyboardService;
  /** `open()` 收到的参数快照（按调用顺序） */
  readonly openCalls: readonly KeyboardOptions[];
  /** `close()` 被调用的次数 */
  readonly closeCount: number;
  /** 当前是否开着（open 之后、close/emitClose 之前） */
  readonly isOpen: boolean;
  emitInput(value: string): void;
  emitConfirm(value: string): void;
  /** 模拟「键盘被收起」（点空白 / 系统收回） */
  emitClose(value: string): void;
}

export const createMockKeyboard = (): MockKeyboard => {
  const inputListeners = new Set<(value: string) => void>();
  const confirmListeners = new Set<(value: string) => void>();
  const closeListeners = new Set<(value: string) => void>();

  const openCalls: KeyboardOptions[] = [];
  let closeCount = 0;
  let opened = false;
  let value = '';

  const emit = (set: Set<(value: string) => void>, v: string): void => {
    for (const cb of [...set]) cb(v);
  };

  const keyboard: KeyboardService = {
    open: (opts?: KeyboardOptions): void => {
      openCalls.push(opts ?? {});
      opened = true;
      value = typeof opts?.defaultValue === 'string' ? opts.defaultValue : '';
    },
    close: (): void => {
      closeCount += 1;
      if (!opened) return;
      opened = false;
      emit(closeListeners, value);
    },
    onInput: (cb: (v: string) => void): Unsubscribe => {
      inputListeners.add(cb);
      return () => {
        inputListeners.delete(cb);
      };
    },
    onConfirm: (cb: (v: string) => void): Unsubscribe => {
      confirmListeners.add(cb);
      return () => {
        confirmListeners.delete(cb);
      };
    },
    onClose: (cb: (v: string) => void): Unsubscribe => {
      closeListeners.add(cb);
      return () => {
        closeListeners.delete(cb);
      };
    },
  };

  return {
    keyboard,
    get openCalls(): readonly KeyboardOptions[] {
      return [...openCalls];
    },
    get closeCount(): number {
      return closeCount;
    },
    get isOpen(): boolean {
      return opened;
    },
    emitInput(v: string): void {
      value = v;
      emit(inputListeners, v);
    },
    emitConfirm(v: string): void {
      value = v;
      emit(confirmListeners, v);
    },
    emitClose(v: string): void {
      value = v;
      opened = false;
      emit(closeListeners, v);
    },
  };
};
