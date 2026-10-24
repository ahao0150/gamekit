/**
 * web 软键盘契约测试（node 里没有 document，所以注入假 DOM）。
 *
 * 断言的是「真 DOM 上会发生什么」，而不是「函数被调过」：
 * - 输入框被**真的创建并挂到 host**、`focus()` 被调；
 * - `input` / `Enter` / `blur` 三条事件真的转发到 onInput / onConfirm / onClose；
 * - 位置用的是 `画布视口位置 + 逻辑 rect`（画布居中偏移时不许丢偏移）；
 * - `open / close` 都通知了 `notifyViewport`（软键盘改视口，画布必须重排）。
 */

import { describe, expect, it, vi } from 'vitest';
import type { KeyboardOptions } from '../contract';
import type { CanvasBox } from './env';
import {
  computeInputBox,
  createWebKeyboard,
  normalizeFontSize,
} from './keyboard';
import type { WebKeyboardDeps } from './keyboard';

interface FakeInput {
  value: string;
  maxLength: number;
  readonly style: { cssText: string };
  readonly attrs: Record<string, string>;
  readonly listeners: Record<string, Array<(ev: unknown) => void>>;
  focused: boolean;
  removed: boolean;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  removeEventListener(type: string, fn: (ev: unknown) => void): void;
  focus(): void;
  blur(): void;
  remove(): void;
  fire(type: string, ev?: unknown): void;
}

const makeInput = (): FakeInput => {
  const attrs: Record<string, string> = {};
  const listeners: Record<string, Array<(ev: unknown) => void>> = {};
  const input: FakeInput = {
    value: '',
    maxLength: 0,
    style: { cssText: '' },
    attrs,
    listeners,
    focused: false,
    removed: false,
    setAttribute(name: string, value: string): void {
      attrs[name] = value;
    },
    addEventListener(type: string, fn: (ev: unknown) => void): void {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener(type: string, fn: (ev: unknown) => void): void {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
    },
    focus(): void {
      input.focused = true;
    },
    blur(): void {
      input.focused = false;
      for (const fn of [...(listeners.blur ?? [])]) fn({});
    },
    remove(): void {
      input.removed = true;
    },
    fire(type: string, ev?: unknown): void {
      for (const fn of [...(listeners[type] ?? [])]) fn(ev ?? {});
    },
  };
  return input;
};

interface FakeHost {
  readonly appended: unknown[];
  appendChild(el: unknown): void;
}

/** 一套假 DOM + 可改的画布位置 + 可触发的 resize。 */
const makeDom = (box: CanvasBox = { left: 10, top: 20, width: 390, height: 844 }) => {
  const input = makeInput();
  const host: FakeHost = {
    appended: [],
    appendChild(el: unknown): void {
      host.appended.push(el);
    },
  };
  let canvasBox = box;
  const resizeHandlers: Array<() => void> = [];
  const deps: WebKeyboardDeps = {
    createInput: () => input as unknown as HTMLInputElement,
    host: () => host as unknown as HTMLElement,
    canvasBox: () => canvasBox,
    onResize: (cb) => {
      resizeHandlers.push(cb);
      return () => {
        const at = resizeHandlers.indexOf(cb);
        if (at >= 0) resizeHandlers.splice(at, 1);
      };
    },
  };
  return {
    input,
    host,
    deps,
    setCanvasBox(next: CanvasBox): void {
      canvasBox = next;
    },
    fireResize(): void {
      for (const cb of [...resizeHandlers]) cb();
    },
    resizeHandlerCount: (): number => resizeHandlers.length,
  };
};

const canvas = {} as HTMLCanvasElement;

/** 从 cssText 里读某条样式（断言位置用，不整串比对，避免样式顺序变就红）。 */
const styleOf = (cssText: string, key: string): string => {
  const hit = cssText.split(';').find((part) => part.startsWith(`${key}:`));
  return hit === undefined ? '' : hit.slice(key.length + 1);
};

describe('createWebKeyboard', () => {
  it('open：创建 input 挂到 host、调 focus、按 rect 定位（含画布偏移）', () => {
    const dom = makeDom();
    const kb = createWebKeyboard(canvas, undefined, dom.deps);
    kb.open({ rect: { x: 30, y: 100, w: 280, h: 48 }, textSize: 20 });

    expect(dom.host.appended).toHaveLength(1);
    expect(dom.host.appended[0]).toBe(dom.input);
    expect(dom.input.focused).toBe(true);
    expect(styleOf(dom.input.style.cssText, 'left')).toBe('40px');
    expect(styleOf(dom.input.style.cssText, 'top')).toBe('120px');
    expect(styleOf(dom.input.style.cssText, 'width')).toBe('280px');
    expect(styleOf(dom.input.style.cssText, 'height')).toBe('48px');
    // 位置来自「画布视口位置 + rect」，不是 rect 本身
    expect(styleOf(dom.input.style.cssText, 'left')).not.toBe('30px');
  });

  it('open：输入框必须「真实可见」（opacity 不是 0、不是 display:none）', () => {
    const dom = makeDom();
    const kb = createWebKeyboard(canvas, undefined, dom.deps);
    kb.open();
    const css = dom.input.style.cssText;
    expect(styleOf(css, 'opacity')).toBe('0.01');
    expect(css).not.toContain('display:none');
    expect(css).not.toContain('visibility:hidden');
    expect(styleOf(css, 'position')).toBe('fixed');
    // 字号不得低于 16，否则 iOS 会放大页面
    expect(Number.parseInt(styleOf(css, 'font-size'), 10)).toBeGreaterThanOrEqual(16);
  });

  it('open：maxLength / confirmType / defaultValue 透传', () => {
    const dom = makeDom();
    const kb = createWebKeyboard(canvas, undefined, dom.deps);
    kb.open({ maxLength: 8, confirmType: 'search', defaultValue: '你好' });
    expect(dom.input.maxLength).toBe(8);
    expect(dom.input.attrs.enterkeyhint).toBe('search');
    expect(dom.input.value).toBe('你好');
  });

  it('open：maxLength 0 / 负数 / 缺省 的归一（0 = 一个字符都不许输，负数 = 不限制）', () => {
    const cases: Array<[number | undefined, number]> = [
      [0, 0],
      [-5, -1],
      [undefined, -1],
      [Number.NaN, -1],
      [12.9, 12],
    ];
    for (const [raw, expected] of cases) {
      const dom = makeDom();
      const kb = createWebKeyboard(canvas, undefined, dom.deps);
      kb.open({ maxLength: raw });
      expect(dom.input.maxLength).toBe(expected);
    }
  });

  it('input 事件 → onInput 收到当前值', () => {
    const dom = makeDom();
    const kb = createWebKeyboard(canvas, undefined, dom.deps);
    const got: string[] = [];
    kb.onInput((v) => got.push(v));
    kb.open();
    dom.input.value = '你好';
    dom.input.fire('input');
    expect(got).toEqual(['你好']);
  });

  it('Enter → onConfirm；再 blur 会额外发 onClose（系统收起键盘）', () => {
    const dom = makeDom();
    const kb = createWebKeyboard(canvas, undefined, dom.deps);
    const confirms: string[] = [];
    const closes: string[] = [];
    kb.onConfirm((v) => confirms.push(v));
    kb.onClose((v) => closes.push(v));
    kb.open();
    dom.input.value = 'abc';
    dom.input.fire('input');
    dom.input.fire('keydown', { key: 'Enter' });
    expect(confirms).toEqual(['abc']);
    expect(closes).toEqual([]);
    dom.input.blur();
    expect(closes).toEqual(['abc']);
  });

  it('blur（用户点空白）→ onClose 且元素从 DOM 移除；再次 blur 不重复回调', () => {
    const dom = makeDom();
    const kb = createWebKeyboard(canvas, undefined, dom.deps);
    const closes: string[] = [];
    kb.onClose((v) => closes.push(v));
    kb.open();
    dom.input.value = 'x';
    dom.input.fire('input');
    dom.input.blur();
    expect(dom.input.removed).toBe(true);
    expect(closes).toEqual(['x']);
    // 再 blur 一次（系统可能补发）：已经关了，不许再回调
    dom.input.blur();
    expect(closes).toEqual(['x']);
  });

  it('close() → onClose 带最后的值 + 元素移除 + notifyViewport', () => {
    const dom = makeDom();
    const notify = vi.fn();
    const kb = createWebKeyboard(canvas, notify, dom.deps);
    const closes: string[] = [];
    kb.onClose((v) => closes.push(v));
    kb.open({ defaultValue: 'seed' });
    dom.input.value = 'typed';
    dom.input.fire('input');
    kb.close();
    expect(closes).toEqual(['typed']);
    expect(dom.input.removed).toBe(true);
    // open 一次 + close 一次 = 两次（软键盘弹起/收起都改视口）
    expect(notify).toHaveBeenCalledTimes(2);
    // close 之后再 close 不重复回调
    kb.close();
    expect(closes).toEqual(['typed']);
  });

  it('重复 open：先卸下旧框再挂回去，不会两个输入框抢焦点', () => {
    const dom = makeDom();
    const kb = createWebKeyboard(canvas, undefined, dom.deps);
    kb.open();
    kb.open();
    expect(dom.host.appended).toHaveLength(2);
    // 旧框确实卸下过（remove() 被调用），否则视口里会有两个 input 抢焦点
    expect(dom.input.removed).toBe(true);
    expect(dom.input.focused).toBe(true);
  });

  it('退订之后不再收到 onInput', () => {
    const dom = makeDom();
    const kb = createWebKeyboard(canvas, undefined, dom.deps);
    const got: string[] = [];
    const off = kb.onInput((v) => got.push(v));
    kb.open();
    dom.input.value = 'a';
    dom.input.fire('input');
    off();
    dom.input.value = 'b';
    dom.input.fire('input');
    expect(got).toEqual(['a']);
  });

  it('窗口 resize：按最后一次的 rect 重新定位（不退回兜底位置）', () => {
    const dom = makeDom();
    const kb = createWebKeyboard(canvas, undefined, dom.deps);
    kb.open({ rect: { x: 30, y: 100, w: 280, h: 48 } });
    expect(styleOf(dom.input.style.cssText, 'left')).toBe('40px');
    // 画布整体右移 30：输入框要跟着走
    dom.setCanvasBox({ left: 40, top: 20, width: 390, height: 844 });
    dom.fireResize();
    expect(styleOf(dom.input.style.cssText, 'left')).toBe('70px');
    expect(styleOf(dom.input.style.cssText, 'width')).toBe('280px');
  });

  it('没 open 时 resize 不动（不白算位置）', () => {
    const dom = makeDom();
    const kb = createWebKeyboard(canvas, undefined, dom.deps);
    dom.fireResize();
    expect(dom.input.style.cssText).toBe('');
    kb.close(); // 没开过就 close 不崩
    expect(dom.input.removed).toBe(false);
  });

  it('rect / textSize 都是可选的：不传也能开（兜底位置 + 默认字号）', () => {
    const dom = makeDom();
    const kb = createWebKeyboard(canvas, undefined, dom.deps);
    const opts: KeyboardOptions = {};
    kb.open(opts);
    expect(styleOf(dom.input.style.cssText, 'left')).toBe('65px');
    expect(dom.input.focused).toBe(true);
  });
});
