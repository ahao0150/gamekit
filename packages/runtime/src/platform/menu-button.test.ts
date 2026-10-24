/**
 * 胶囊（menuButton）纯函数的契约测试（T47）。
 *
 * 钉住四件事：
 * 1. **坐标换算**：平台原始矩形以屏幕左上角为原点，画布有偏移时要减掉；
 * 2. **字段兜底**：`width/height` 缺失用 `right-left` / `bottom-top`；宽高 <= 0 → undefined
 *    （布局层不该拿到「零尺寸但存在」的胶囊去避让）；
 * 3. **物理像素兜底**：明显超出屏幕的矩形按 dpr 折回逻辑像素（抖音真机采样就是这种）；
 * 4. **构造期不许崩**：API 缺失 / 抛错 / 返回垃圾 → undefined，不抛异常。
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeMenuButtonRect,
  readMiniMenuButton,
  toMenuButtonRect,
} from './screen-contract';
import type { RawMenuButtonRect } from './screen-contract';

/** iPhone 上典型的胶囊：右上角、宽 87 高 32、顶 24。 */
const RAW: RawMenuButtonRect = { width: 87, height: 32, top: 24, right: 367, bottom: 56, left: 280 };

describe('toMenuButtonRect', () => {
  it('原始矩形（屏幕坐标）→ 画布坐标：x/y 取 left/top，宽高取 width/height', () => {
    expect(toMenuButtonRect(RAW)).toEqual({ x: 280, y: 24, w: 87, h: 32 });
  });

  it('画布有偏移时减掉（开发者工具 / 嵌套容器）', () => {
    expect(toMenuButtonRect(RAW, { left: 20, top: 10 })).toEqual({ x: 260, y: 14, w: 87, h: 32 });
  });

  it('width/height 缺失 → 用 right-left / bottom-top 退化', () => {
    const noSize = { ...RAW, width: 0, height: 0 };
    expect(toMenuButtonRect(noSize)).toEqual({ x: 280, y: 24, w: 87, h: 32 });
  });

  it('宽度字段坏掉 → 用 right-left 兜底；两条路都给不出正数 → undefined', () => {
    expect(toMenuButtonRect({ ...RAW, width: -10 })).toEqual({ x: 280, y: 24, w: 87, h: 32 });
    expect(toMenuButtonRect({ ...RAW, width: 0, height: 0, right: 280, bottom: 24 })).toBeUndefined();
  });

  it('偏移比原始值大 → 坐标钳到 0，不出现负数', () => {
    const rect = toMenuButtonRect(RAW, { left: 9999, top: 9999 });
    expect(rect).toEqual({ x: 0, y: 0, w: 87, h: 32 });
  });
});

describe('normalizeMenuButtonRect', () => {
  const screen = { width: 390, height: 844, dpr: 2 };

  it('合法逻辑矩形原样保留（不误伤）', () => {
    const rect = { x: 280, y: 24, w: 87, h: 32 };
    expect(normalizeMenuButtonRect(rect, screen)).toEqual(rect);
  });

  it('超出屏幕的（物理像素）按 dpr 折回逻辑像素', () => {
    // 抖音真机采样：{"width":85,"height":32,"top":6,"right":2192,"bottom":38,"left":2107}
    const physical = { x: 2107, y: 6, w: 85, h: 32 };
    const normalized = normalizeMenuButtonRect(physical, { width: 1096, height: 928, dpr: 2 });
    expect(normalized.x).toBeCloseTo(1053.5, 1);
    expect(normalized.w).toBeCloseTo(42.5, 1);
    expect(normalized.y).toBeCloseTo(3, 1);
    expect(normalized.h).toBeCloseTo(16, 1);
  });

  it('折完仍超出（dpr 记错）→ 钳进屏幕，不出现负宽高', () => {
    const huge = { x: 5000, y: 5000, w: 4000, h: 4000 };
    const normalized = normalizeMenuButtonRect(huge, screen);
    expect(normalized.x).toBeLessThanOrEqual(screen.width);
    expect(normalized.y).toBeLessThanOrEqual(screen.height);
    expect(normalized.w).toBeGreaterThanOrEqual(0);
    expect(normalized.h).toBeGreaterThanOrEqual(0);
    expect(normalized.x + normalized.w).toBeLessThanOrEqual(screen.width + 0.001);
  });

  it('dpr 非法时按 1 处理（不除 0、不产 NaN）', () => {
    const rect = { x: 10, y: 10, w: 20, h: 20 };
    for (const dpr of [0, -2, Number.NaN]) {
      const out = normalizeMenuButtonRect({ ...rect, x: 10000 }, { width: 390, height: 844, dpr });
      for (const value of Object.values(out)) expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('readMiniMenuButton（wx / tt 共用）', () => {
  const screen = { width: 390, height: 844, dpr: 2 };

  it('API 缺失 → undefined（老基础库不许崩）', () => {
    expect(readMiniMenuButton({}, undefined, screen)).toBeUndefined();
  });

  it('API 抛错 → undefined（吞掉，构造期不失败）', () => {
    const api = {
      getMenuButtonBoundingClientRect: (): RawMenuButtonRect => {
        throw new Error('base library too old');
      },
    };
    expect(readMiniMenuButton(api, undefined, screen)).toBeUndefined();
  });

  it('优先 getMenuButtonBoundingClientRect（微信同形）', () => {
    const api = {
      getMenuButtonBoundingClientRect: () => RAW,
      getMenuButtonLayout: () => ({ ...RAW, left: 0, top: 0, x: 0 }),
    };
    expect(readMiniMenuButton(api, undefined, screen)).toEqual({ x: 280, y: 24, w: 87, h: 32 });
  });

  it('没有 BoundingClientRect → 退到 getMenuButtonLayout（抖音名）', () => {
    const api = { getMenuButtonLayout: () => RAW };
    expect(readMiniMenuButton(api, undefined, screen)).toEqual({ x: 280, y: 24, w: 87, h: 32 });
  });

  it('画布对象带 getBoundingClientRect 时减掉偏移', () => {
    const canvas = { getBoundingClientRect: () => ({ left: 100, top: 50 }) };
    const api = { getMenuButtonBoundingClientRect: () => RAW };
    expect(readMiniMenuButton(api, canvas, screen)).toEqual({ x: 180, y: 0, w: 87, h: 32 });
  });

  it('画布对象的 getBoundingClientRect 抛错 → 按 (0,0) 处理，不崩', () => {
    const canvas = {
      getBoundingClientRect: () => {
        throw new Error('no layout');
      },
    };
    const api = { getMenuButtonBoundingClientRect: () => RAW };
    expect(readMiniMenuButton(api, canvas, screen)).toEqual({ x: 280, y: 24, w: 87, h: 32 });
  });
});
