/**
 * web 画布尺寸 / 坐标系契约测试（Node，无 DOM）。
 *
 * 重点守卫「屏幕适配」那个真实 bug：backing store = CSS × dpr，但绘制坐标是逻辑像素，
 * 所以设完 backing 必须建立 setTransform(dpr,0,0,dpr,0,0)。
 * 少了这一步，高 dpr 屏上画面会缩到左上角 1/dpr²、点击整体错位。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyCanvasSize, computeCanvasBox, parseSafeAreaInsets, readSafeAreaInsets, wrapCanvas } from './env';

/** 记录 setTransform 调用的假画布（只需要 width/height/getContext）。 */
function fakeCanvas(): {
  canvas: HTMLCanvasElement;
  calls: number[][];
} {
  const calls: number[][] = [];
  const ctx = {
    setTransform: (...a: number[]): void => {
      calls.push(a);
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: (): unknown => ctx,
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

describe('applyCanvasSize', () => {
  it('backing = CSS × dpr', () => {
    const { canvas } = fakeCanvas();
    applyCanvasSize(canvas, 390, 844, 2);
    expect(canvas.width).toBe(780);
    expect(canvas.height).toBe(1688);
  });

  it('设完 backing 建立 dpr 变换（高 dpr 屏不错位的根因守卫）', () => {
    const { canvas, calls } = fakeCanvas();
    applyCanvasSize(canvas, 390, 844, 2);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('dpr=1 时建立 identity 变换，仍会调用（重置被 canvas.width 赋值清掉的状态）', () => {
    const { canvas, calls } = fakeCanvas();
    applyCanvasSize(canvas, 320, 480, 1);
    expect(canvas.width).toBe(320);
    expect(calls[0]).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('非整数 dpr 也按原值缩放（1.25 倍屏不取整）', () => {
    const { canvas, calls } = fakeCanvas();
    applyCanvasSize(canvas, 390, 844, 1.25);
    expect(canvas.width).toBe(488); // round(487.5)
    expect(calls[0]).toEqual([1.25, 0, 0, 1.25, 0, 0]);
  });
});

describe('computeCanvasBox', () => {
  it('contain：短边贴住视口，画布完整可见', () => {
    // 视口 390×746，设计 390×844 → 高度受限，scale = 746/844
    const box = computeCanvasBox({ width: 390, height: 844 }, 'contain', {
      width: 390,
      height: 746,
    });
    expect(box.height).toBeCloseTo(746);
    expect(box.width).toBeCloseTo((390 * 746) / 844);
  });

  it('fit=height：贴住视口高，宽按设计比例', () => {
    const box = computeCanvasBox({ width: 390, height: 844 }, 'height', {
      width: 1200,
      height: 844,
    });
    expect(box.height).toBeCloseTo(844);
    expect(box.width).toBeCloseTo(390);
  });

  it('视口为 0 时不产出 NaN/负尺寸', () => {
    const box = computeCanvasBox({ width: 390, height: 844 }, 'contain', {
      width: 0,
      height: 0,
    });
    expect(Number.isFinite(box.width)).toBe(true);
    expect(Number.isFinite(box.height)).toBe(true);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  // fill 存在的理由：contain 只要设计比例和视口比例不一致就必然留边，而且
  // 留边方向随设备变 —— 设备更宽时左右留、设备更长时上下留。
  // 下面三条把这两种方向都钉住：fill 必须**完全等于视口**，不留任何边。
  it('fill：画布等于视口，设备比设计宽时也不留左右边', () => {
    // iPhone SE 375×667（比例 1.779）比设计 390×844（2.164）宽
    const box = computeCanvasBox({ width: 390, height: 844 }, 'fill', {
      width: 375,
      height: 667,
    });
    expect(box.width).toBe(375);
    expect(box.height).toBe(667);
  });

  it('fill：设备比设计长时也不留上下边', () => {
    // 安卓 360×800（比例 2.222）比设计 2.164 长
    const box = computeCanvasBox({ width: 390, height: 844 }, 'fill', {
      width: 360,
      height: 800,
    });
    expect(box.width).toBe(360);
    expect(box.height).toBe(800);
  });

  it('fill：横屏也铺满（不看 design 的朝向）', () => {
    const box = computeCanvasBox({ width: 390, height: 844 }, 'fill', {
      width: 844,
      height: 390,
    });
    expect(box.width).toBe(844);
    expect(box.height).toBe(390);
  });
});

// 安全区：web 用 env(safe-area-inset-*) 读，解析这一步是纯函数，可以在 Node 里钉死。
// 方向不能串位（top/right/bottom/left），任何情况不产出 NaN / 负数 —— 与 wx/tt 同一条规矩。
describe('parseSafeAreaInsets', () => {
  it('四个方向分别解析（top / right / bottom / left 不串位）', () => {
    expect(
      parseSafeAreaInsets({ top: '47px', right: '1px', bottom: '34px', left: '44px' }),
    ).toEqual({ top: 47, right: 1, bottom: 34, left: 44 });
  });

  it('空串 / 非数字 → 0（浏览器不支持 env() 时整条声明失效）', () => {
    expect(parseSafeAreaInsets({ top: '', right: 'auto', bottom: 'NaN', left: '  ' })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('负值钳成 0（安全区绝不给布局负内缩）', () => {
    expect(
      parseSafeAreaInsets({ top: '-10px', right: '-1px', bottom: '-0.5px', left: '-2px' }),
    ).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

describe('readSafeAreaInsets（隐藏探针）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('造探针 → 读 computedStyle → 移除探针，四值映射正确', () => {
    let removed = 0;
    const el = { style: { cssText: '' }, remove: () => { removed += 1; } };
    vi.stubGlobal('document', {
      createElement: () => el,
      body: { appendChild: () => undefined },
      documentElement: { appendChild: () => undefined },
    });
    vi.stubGlobal('window', {
      getComputedStyle: () => ({
        paddingTop: '47px',
        paddingRight: '0px',
        paddingBottom: '34px',
        paddingLeft: '44px',
      }),
    });
    expect(readSafeAreaInsets()).toEqual({ top: 47, right: 0, bottom: 34, left: 44 });
    expect(removed).toBe(1); // 探针用完必须移除，不能往 DOM 里堆
  });

  it('body 还没就绪时挂到 documentElement 上（早启动也能读）', () => {
    let appendedTo = '';
    const el = { style: { cssText: '' }, remove: () => undefined };
    vi.stubGlobal('document', {
      createElement: () => el,
      body: null,
      documentElement: { appendChild: () => { appendedTo = 'documentElement'; } },
    });
    vi.stubGlobal('window', {
      getComputedStyle: () => ({
        paddingTop: '0px',
        paddingRight: '0px',
        paddingBottom: '0px',
        paddingLeft: '0px',
      }),
    });
    expect(readSafeAreaInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(appendedTo).toBe('documentElement');
  });
});

// T30：离屏画布的「元素 → 契约」包装。document 创建那一段只能在真浏览器里验
// （verify-platform 会跑），这里把包装本身的行为钉死。
describe('wrapCanvas', () => {
  it('width / height 是元素的 backing 尺寸，native 是元素本身', () => {
    const el = { width: 780, height: 1688, getContext: (): null => null } as unknown as HTMLCanvasElement;
    const wrapped = wrapCanvas(el);
    expect(wrapped.width).toBe(780);
    expect(wrapped.height).toBe(1688);
    expect(wrapped.native).toBe(el);
  });

  it('getContext 把类型透传给元素', () => {
    const calls: string[] = [];
    const el = {
      width: 10,
      height: 10,
      getContext: (type: string): null => {
        calls.push(type);
        return null;
      },
    } as unknown as HTMLCanvasElement;
    const wrapped = wrapCanvas(el);
    expect(wrapped.getContext('2d')).toBeNull();
    expect(calls).toEqual(['2d']);
  });
});
