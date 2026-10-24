/**
 * web 平台的系统软键盘：造一个真 `<input>` 盖在画布上。
 *
 * 为什么不能自己画键盘：中文输入法、系统选词、粘贴、光标移动全都要系统来；
 * 小游戏端更是只能调 wx / tt 的 showKeyboard。
 *
 * 四个真坑（改之前先读，每条都是「看起来能跑、真机上不行」）：
 * 1. **iOS Safari 要求输入框「真实可见」才弹键盘**。`display:none` / `visibility:hidden`
 *    一定不弹；`opacity:0` 多数版本也不弹。所以这里用 `opacity: 0.01` ——
 *    有尺寸、在视口内、可聚焦，但肉眼看不见；视觉统一由画布上的组件负责。
 *    真机若发现某些 iOS 版本仍不弹，把 `opacity` 调到 1 即可：其余样式（透明底、
 *    透明字、透明光标）已经是「看不见」的，调上去不会丑。
 * 2. **iOS 上 font-size < 16px 会触发页面自动放大**。输入框字号必须 ≥16，
 *    不能直接把组件的 `textSize`（可能是 20 以上，也可能更小）透传下去。
 * 3. **软键盘弹起会改视口高度**，`window.innerHeight` 变了但画布尺寸不会自己重算，
 *    结果就是输入框被键盘挡住、布局也没重排。所以 open / close 都要回调
 *    `notifyViewport`，让适配器重走 `applyBox()` + 通知 `onResize` 订阅者。
 * 4. **画布位置会变**（dpr / fit / 转屏 / 地址栏收起），所以输入框位置不能只算一次：
 *    窗口 resize 与每次 open 都要重算。位置来源只有一个 ——
 *    `canvas.getBoundingClientRect()` + 逻辑 rect，见 `computeInputBox`。
 */

import type { KeyboardOptions, KeyboardRect, KeyboardService, Unsubscribe } from '../contract';
import { normalizeDefaultValue, normalizeMaxLength } from '../keyboard-utils';
import type { CanvasBox } from './env';
import { readCanvasBox } from './env';

/** 没有给 rect 时的兜底尺寸（逻辑像素） */
const FALLBACK_W = 280;
const FALLBACK_H = 48;
/** iOS 输入框最小字号：小于 16px 会触发页面自动缩放 */
const MIN_FONT_SIZE = 16;

/** 输入框在视口中的 CSS 位置与尺寸。 */
export interface InputBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const isFiniteRect = (rect: KeyboardRect | undefined): rect is KeyboardRect =>
  rect !== undefined &&
  Number.isFinite(rect.x) &&
  Number.isFinite(rect.y) &&
  Number.isFinite(rect.w) &&
  Number.isFinite(rect.h);

/**
 * 逻辑 rect（相对画布左上角）→ 输入框在视口中的 CSS 位置。
 *
 * 纯函数：画布在页面里居中 / 有偏移时，不减 `canvasBox.left/top` 输入框就会整体偏，
 * 这是「点到了但输入框在别处」的经典来源，所以单独抽出来让测试钉死。
 */
export const computeInputBox = (canvasBox: CanvasBox, rect?: KeyboardRect): InputBox => {
  if (isFiniteRect(rect) && rect.w > 0 && rect.h > 0) {
    return {
      left: canvasBox.left + rect.x,
      top: canvasBox.top + rect.y,
      width: rect.w,
      height: rect.h,
    };
  }
  // 兜底：画布顶部居中。只在调用方没给 rect 时发生，不是常态。
  const width = Math.min(FALLBACK_W, Math.max(1, canvasBox.width));
  return {
    left: canvasBox.left + Math.max(0, (canvasBox.width - width) / 2),
    top: canvasBox.top,
    width,
    height: FALLBACK_H,
  };
};

/** maxLength 归一在 keyboard-utils.ts（三端同一口径），这里只做字号。 */
export { normalizeMaxLength } from '../keyboard-utils';

/** 输入框字号：不得低于 16（iOS 自动缩放），无值按框高推算。 */
export const normalizeFontSize = (textSize: number | undefined, boxHeight: number): number => {
  const base =
    typeof textSize === 'number' && Number.isFinite(textSize) && textSize > 0
      ? textSize
      : Math.min(Math.max(boxHeight * 0.36, MIN_FONT_SIZE), 24);
  return Math.max(MIN_FONT_SIZE, Math.round(base));
};

/** 本模块用到的 DOM 最小面：真 DOM 满足它，单测可以塞假对象（node 里没有 document）。 */
export interface WebKeyboardDeps {
  readonly createInput: () => HTMLInputElement;
  readonly host: () => HTMLElement;
  readonly canvasBox: () => CanvasBox;
  /** 订阅视口变化（用于重新定位输入框），返回退订函数。 */
  readonly onResize: (cb: () => void) => Unsubscribe;
}

const defaultDeps = (canvas: HTMLCanvasElement): WebKeyboardDeps => ({
  createInput: () => document.createElement('input'),
  host: () => document.body ?? document.documentElement,
  canvasBox: () => readCanvasBox(canvas),
  onResize: (cb: () => void): Unsubscribe => {
    window.addEventListener('resize', cb);
    return () => window.removeEventListener('resize', cb);
  },
});

/**
 * 造一个 web 键盘服务。
 *
 * @param canvas 上屏画布（输入框按它的视口位置摆放）
 * @param notifyViewport open / close 时回调，让适配器重算画布并通知 onResize
 * @param deps 注入点，生产代码不传（默认走真 DOM）
 */
export const createWebKeyboard = (
  canvas: HTMLCanvasElement,
  notifyViewport?: () => void,
  deps?: WebKeyboardDeps,
): KeyboardService => {
  const dom = deps ?? defaultDeps(canvas);

  const inputListeners = new Set<(value: string) => void>();
  const confirmListeners = new Set<(value: string) => void>();
  const closeListeners = new Set<(value: string) => void>();

  let input: HTMLInputElement | null = null;
  /** 键盘当前是否开着（开着才有「关闭」语义，避免 blur 重复回调） */
  let opened = false;
  let value = '';
  /** 最后一次 open 的位置参数：窗口 resize 时要按同一份 rect 重定位，不能用兜底值 */
  let lastRect: KeyboardRect | undefined;
  let lastTextSize: number | undefined;

  const emit = (set: Set<(value: string) => void>, v: string): void => {
    for (const cb of [...set]) cb(v);
  };

  /** 位置重算：每次 open 与窗口 resize 都走同一条路。 */
  const place = (rect: KeyboardRect | undefined, textSize: number | undefined): void => {
    if (input === null) return;
    const box = computeInputBox(dom.canvasBox(), rect);
    const size = normalizeFontSize(textSize, box.height);
    input.style.cssText = [
      'position:fixed',
      `left:${box.left}px`,
      `top:${box.top}px`,
      `width:${box.width}px`,
      `height:${box.height}px`,
      // 透明 + 极低不透明度：iOS 要求「真实可见」才弹键盘，但视觉交给画布
      'opacity:0.01',
      'background:transparent',
      'border:0',
      'padding:0',
      'margin:0',
      'outline:none',
      'color:transparent',
      '-webkit-text-fill-color:transparent',
      'caret-color:transparent',
      'text-align:center',
      'box-sizing:border-box',
      // ≥16px：小于它 iOS 会自动放大页面
      `font-size:${size}px`,
      'z-index:9999',
    ].join(';');
  };

  const ensureInput = (): HTMLInputElement => {
    if (input !== null) return input;
    const el = dom.createInput();
    el.setAttribute('type', 'text');
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('spellcheck', 'false');
    el.addEventListener('input', () => {
      if (input === null) return;
      value = input.value;
      emit(inputListeners, value);
    });
    el.addEventListener('keydown', (ev: Event) => {
      // Enter 即确认；不 preventDefault —— 让系统自己收起键盘（会走 blur → onClose）
      if ((ev as KeyboardEvent).key === 'Enter') emit(confirmListeners, value);
    });
    el.addEventListener('blur', () => {
      // 用户点空白 / 系统收起键盘：唯一需要通知「关闭」的地方
      if (!opened) return;
      opened = false;
      input?.remove();
      emit(closeListeners, value);
      notifyViewport?.();
    });
    input = el;
    return el;
  };

  // 窗口 resize（转屏 / 地址栏 / 软键盘）时重新定位：画布位置变了输入框要跟着走
  dom.onResize(() => {
    if (!opened) return;
    place(lastRect, lastTextSize);
  });

  return {
    open: (opts?: KeyboardOptions): void => {
      const el = ensureInput();
      // 重复 open = 先收再开，避免两个输入框抢焦点的中间态
      if (opened) {
        opened = false;
        el.remove();
      }
      value = normalizeDefaultValue(opts?.defaultValue);
      el.value = value;
      el.maxLength = normalizeMaxLength(opts?.maxLength);
      const confirmType = opts?.confirmType;
      if (confirmType !== undefined) el.setAttribute('enterkeyhint', confirmType);
      lastRect = opts?.rect;
      lastTextSize = opts?.textSize;
      place(lastRect, lastTextSize);
      dom.host().appendChild(el);
      opened = true;
      el.focus();
      // 软键盘弹起会改视口高度，画布得重排，否则输入框会被键盘挡住
      notifyViewport?.();
    },
    close: (): void => {
      if (input === null || !opened) return;
      const el = input;
      // 先落 opened：blur 回调里有同样的判断，否则会重复发一次 onClose
      opened = false;
      el.blur();
      el.remove();
      emit(closeListeners, value);
      notifyViewport?.();
    },
    onInput: (cb: (value: string) => void): Unsubscribe => {
      inputListeners.add(cb);
      return () => {
        inputListeners.delete(cb);
      };
    },
    onConfirm: (cb: (value: string) => void): Unsubscribe => {
      confirmListeners.add(cb);
      return () => {
        confirmListeners.delete(cb);
      };
    },
    onClose: (cb: (value: string) => void): Unsubscribe => {
      closeListeners.add(cb);
      return () => {
        closeListeners.delete(cb);
      };
    },
  };
};
