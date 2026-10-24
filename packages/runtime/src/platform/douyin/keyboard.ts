/**
 * 抖音端软键盘：`tt.showKeyboard` + `onKeyboardInput` / `onKeyboardConfirm` /
 * `onKeyboardComplete`（后者部分版本没有）。
 *
 * 与微信的实现**刻意分开写**（本仓库 platform 层的既定做法：差异要留在代码里，
 * 不要揉进 if 藏起来）。真实差异只有一条，但它是会漏事件的：
 *
 * **抖音部分版本的 `tt.onKeyboardComplete` 不存在**（微信基础库 2.13.0+ 一定有）。
 * 缺了它，「用户点空白收起键盘」就没有任何回调，游戏界面会停在「光标闪烁但键盘
 * 已经没了」的样子。所以这里分两条路：
 * - 有 complete：与微信完全同形（收起回调是唯一信号源）；
 * - 没有 complete：把 `onKeyboardConfirm` 当作「确认即收起」——抖音点确认键后
 *   系统会自动收键盘，此时补发一次 onClose。点空白收起仍拿不到回调，
 *   游戏侧要自己按「点了别处」把 focused 置 false（这条写进了 docs）。
 *
 * 另外与微信同形：位置参数（rect / textSize）被忽略，那是 web 专用；
 * 显式 hideKeyboard 不保证回 complete，所以 close() 自己发一次 close。
 */

import type { KeyboardOptions, KeyboardService, Unsubscribe } from '../contract';
import { normalizeKeyboardOptions } from '../keyboard-utils';
import type { TtApi } from './api';

export const createDouyinKeyboard = (api: TtApi): KeyboardService | null => {
  // 与微信同一条规矩：构造期不因缺少可选能力而崩，缺 API 就如实返回 null。
  if (typeof api.showKeyboard !== 'function' || typeof api.onKeyboardInput !== 'function') {
    return null;
  }

  const inputListeners = new Set<(value: string) => void>();
  const confirmListeners = new Set<(value: string) => void>();
  const closeListeners = new Set<(value: string) => void>();

  let value = '';
  let opened = false;

  const emit = (set: Set<(value: string) => void>, v: string): void => {
    for (const cb of [...set]) cb(v);
  };

  /** 抖音版本差异：有没有 onKeyboardComplete */
  const hasComplete = typeof api.onKeyboardComplete === 'function';

  api.onKeyboardInput((res) => {
    if (!opened) return;
    value = res.value;
    emit(inputListeners, value);
  });
  api.onKeyboardConfirm((res) => {
    if (!opened) return;
    value = res.value;
    emit(confirmListeners, value);
    // 没有 complete 时的兜底：确认键之后系统会自动收键盘，这里补一条 close
    if (!hasComplete) {
      opened = false;
      emit(closeListeners, value);
    }
  });
  api.onKeyboardComplete?.((res) => {
    if (!opened) return;
    opened = false;
    value = res.value;
    emit(closeListeners, value);
  });

  return {
    open: (opts?: KeyboardOptions): void => {
      const norm = normalizeKeyboardOptions(opts);
      if (opened) {
        opened = false;
        api.hideKeyboard();
      }
      value = norm.defaultValue;
      opened = true;
      api.showKeyboard({
        defaultValue: value,
        confirmType: norm.confirmType,
        multiple: false,
        confirmHold: false,
        ...(norm.maxLength >= 0 ? { maxLength: norm.maxLength } : {}),
      });
    },
    close: (): void => {
      if (!opened) return;
      opened = false;
      api.hideKeyboard();
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
};
