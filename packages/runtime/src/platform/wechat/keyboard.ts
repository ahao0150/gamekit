/**
 * 微信端软键盘：`wx.showKeyboard` + `onKeyboardInput` / `onKeyboardConfirm` /
 * `onKeyboardComplete`。
 *
 * 为什么小游戏端不能自己画键盘：中文输入法的候选词、拼音中间态、系统选词、
 * 粘贴、光标移动全都在系统输入法里，画不出来也猜不到。平台给了 showKeyboard，
 * 就用它，业务侧只面对 `KeyboardService` 四个方法。
 *
 * 三个真点（改之前先读）：
 * 1. **位置参数（rect / textSize）在这里被忽略**，那是 web 专用：web 要自己造
 *    `<input>` 盖在画布上，而小游戏的键盘由系统弹出，位置由输入法决定。
 *    「同一个契约、平台各自解释」是适配层的本分，不是不一致。
 * 2. **`onKeyboardComplete` 是「收起」的唯一可靠信号**（点空白、点完成、
 *    系统收回都会来一条），基础库 2.13.0 起才有 → 按可选调用。
 * 3. **显式 `hideKeyboard()` 不保证回 complete**（部分机型不回），所以 `close()`
 *    自己发一次「关闭」，用 `opened` 标志防重复：谁先回到 false，谁负责发。
 */

import type { KeyboardOptions, KeyboardService, Unsubscribe } from '../contract';
import { normalizeKeyboardOptions } from '../keyboard-utils';
import type { WxApi } from './api';

export const createWechatKeyboard = (api: WxApi): KeyboardService | null => {
  // 老基础库 / 极简宿主可能没有键盘 API。**构造期不能因为可选能力崩**：
  // 返回 null 表示「本机没有这个能力」，适配器据此不挂 keyboard、能力位也不报 true。
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

  // 平台回调只注册一次（微信的 on* 允许重复注册，但 off* 要同一个引用，
  // 注册一次最省心），数据路由到动态订阅集合。
  api.onKeyboardInput((res) => {
    if (!opened) return;
    value = res.value;
    emit(inputListeners, value);
  });
  api.onKeyboardConfirm((res) => {
    if (!opened) return;
    value = res.value;
    emit(confirmListeners, value);
  });
  // 老基础库没有 onKeyboardComplete：用可选调用，缺了就不装。
  api.onKeyboardComplete?.((res) => {
    if (!opened) return;
    opened = false;
    value = res.value;
    emit(closeListeners, value);
  });

  return {
    open: (opts?: KeyboardOptions): void => {
      const norm = normalizeKeyboardOptions(opts);
      // 重复 open = 先收再开：不置 opened 会让收起的 complete 抢先发一次 close
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
        // -1 表示「不限制」：微信的 maxLength 不允许负值，不传即用系统默认（140）
        ...(norm.maxLength >= 0 ? { maxLength: norm.maxLength } : {}),
      });
    },
    close: (): void => {
      if (!opened) return;
      opened = false;
      api.hideKeyboard();
      // 部分机型 hideKeyboard 不回 complete，这里自己发一次（上面的标志保证不重复）
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
