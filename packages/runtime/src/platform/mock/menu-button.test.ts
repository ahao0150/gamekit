/**
 * mock 平台的胶囊注入测试（T47）。
 *
 * mock 的用途就是「可编程」：离线验收要能造一台「右上角有胶囊」的假设备，
 * 才能测布局层有没有把 HUD 让开。
 */

import { describe, expect, it } from 'vitest';
import { createMockAdapter } from './index';

describe('mock 的 menuButton', () => {
  it('注入后 screen.menuButton 原样读到', () => {
    const adapter = createMockAdapter({
      screen: { width: 390, height: 844, dpr: 3 },
      menuButton: { x: 281, y: 26, w: 87, h: 32 },
    });
    expect(adapter.screen.menuButton).toEqual({ x: 281, y: 26, w: 87, h: 32 });
  });

  it('不注入 = 没有该 UI → undefined（等价于手机端 / web）', () => {
    const adapter = createMockAdapter();
    expect(adapter.screen.menuButton).toBeUndefined();
  });

  it('emitResize 改屏幕尺寸时胶囊跟着保留（真机上转屏胶囊还在）', () => {
    const adapter = createMockAdapter({ menuButton: { x: 281, y: 26, w: 87, h: 32 } });
    adapter.emitResize(844, 390, 3);
    expect(adapter.screen.width).toBe(844);
    expect(adapter.screen.orientation).toBe('landscape');
    expect(adapter.screen.menuButton).toEqual({ x: 281, y: 26, w: 87, h: 32 });
  });
});
