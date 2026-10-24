/**
 * web 端「没有胶囊」的契约测试（T47）。
 *
 * 浏览器里没有系统浮层按钮，所以 web 的 `ScreenInfo` **不该有** `menuButton` 字段
 * （不是「有但为 0」——布局层按「字段在不在」判断要不要避让）。
 *
 * 这里直接测产出 screen 的那个函数 `placeCanvas`：它是 web 适配器
 * `applyBox()` 的唯一出口，返回什么 screen 就是什么。
 */

import { describe, expect, it } from 'vitest';
import { placeCanvas } from './env';

/** 只实现 placeCanvas 用到的成员：style / getContext / getBoundingClientRect / addEventListener。 */
const fakeCanvas = (): HTMLCanvasElement => {
  const ctx = { setTransform: (): void => undefined };
  return {
    width: 0,
    height: 0,
    style: {} as CSSStyleDeclaration,
    getContext: (): unknown => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }),
  } as unknown as HTMLCanvasElement;
};

interface FakeDom {
  readonly window: unknown;
  readonly document: unknown;
}

const withFakeDom = (run: () => void): void => {
  const globalScope = globalThis as unknown as { window?: unknown; document?: unknown };
  const previous = { window: globalScope.window, document: globalScope.document };
  const probe = {
    style: {} as CSSStyleDeclaration,
    remove: (): void => undefined,
  };
  const dom: FakeDom = {
    window: {
      devicePixelRatio: 2,
      innerWidth: 390,
      innerHeight: 844,
      getComputedStyle: () => ({
        paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px',
      }),
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
    },
    document: {
      body: { appendChild: (): void => undefined },
      documentElement: { appendChild: (): void => undefined },
      createElement: () => probe,
      querySelector: () => null,
    },
  };
  globalScope.window = dom.window;
  globalScope.document = dom.document;
  try {
    run();
  } finally {
    globalScope.window = previous.window;
    globalScope.document = previous.document;
  }
};

describe('web 端 ScreenInfo 没有胶囊', () => {
  it('placeCanvas 产出的 screen 不含 menuButton 字段（不是有值但为 0）', () => {
    withFakeDom(() => {
      const screen = placeCanvas(fakeCanvas(), { width: 390, height: 844 }, 'fill');
      expect('menuButton' in screen).toBe(false);
      expect(screen.menuButton).toBeUndefined();
      expect(screen.width).toBe(390);
    });
  });

  it('contain 适配下同样没有胶囊（留边也不该被当成胶囊）', () => {
    withFakeDom(() => {
      const screen = placeCanvas(fakeCanvas(), { width: 390, height: 844 }, 'contain');
      expect(screen.menuButton).toBeUndefined();
      expect(screen.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    });
  });
});
