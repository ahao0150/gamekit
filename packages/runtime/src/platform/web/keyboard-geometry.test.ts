/**
 * web 软键盘的几何 / 字号纯函数测试（不碰 DOM，所以和 DOM 行为测试分开放）。
 *
 * 这两条是「看得见、点得到」的前提：
 * 1. 输入框位置 = 画布在视口中的位置 + 逻辑 rect —— 画布居中时丢了偏移，
 *    用户点画布上的输入框，真 input 却在别处，iOS 上表现为「点了没反应」；
 * 2. 字号不得低于 16 —— 小于它 iOS Safari 会自动放大整个页面。
 */

import { describe, expect, it } from 'vitest';
import type { CanvasBox } from './env';
import { computeInputBox, normalizeFontSize } from './keyboard';

const box: CanvasBox = { left: 10, top: 20, width: 390, height: 844 };

describe('computeInputBox（纯函数）', () => {
  it('逻辑 rect + 画布偏移 = 视口坐标（画布居中时偏移不能丢）', () => {
    expect(computeInputBox(box, { x: 30, y: 100, w: 280, h: 48 })).toEqual({
      left: 40,
      top: 120,
      width: 280,
      height: 48,
    });
  });

  it('没有 rect → 画布顶部居中兜底（不抛错、不放到 0,0）', () => {
    expect(computeInputBox(box)).toEqual({ left: 65, top: 20, width: 280, height: 48 });
  });

  it('rect 宽高为 0 / 负数 → 走兜底（0 尺寸的输入框在 iOS 上不弹键盘）', () => {
    expect(computeInputBox(box, { x: 30, y: 100, w: 0, h: 48 }).width).toBe(280);
    expect(computeInputBox(box, { x: 30, y: 100, w: -10, h: 48 }).width).toBe(280);
  });

  it('rect 含 NaN → 走兜底（不产出 NaN 的 left）', () => {
    const out = computeInputBox(box, { x: Number.NaN, y: 1, w: 10, h: 10 });
    expect(Number.isFinite(out.left)).toBe(true);
    expect(out.width).toBe(280);
  });

  it('画布比兜底宽度还窄时不越界（宽 = 画布宽）', () => {
    const narrow: CanvasBox = { left: 0, top: 0, width: 200, height: 600 };
    expect(computeInputBox(narrow).width).toBe(200);
    expect(computeInputBox(narrow).left).toBe(0);
  });
});

describe('normalizeFontSize（iOS 自动缩放的坑）', () => {
  it('textSize 小于 16 → 钳到 16', () => {
    expect(normalizeFontSize(10, 48)).toBe(16);
    expect(normalizeFontSize(12, 20)).toBe(16);
  });

  it('textSize 为 0 / 负数 → 视为「没给」，按框高推算', () => {
    expect(normalizeFontSize(0, 48)).toBe(17);
    expect(normalizeFontSize(-3, 48)).toBe(17);
  });

  it('给了合法 textSize 就用它（取整）', () => {
    expect(normalizeFontSize(21.6, 48)).toBe(22);
  });

  it('没给 → 按框高推算，但也不低于 16', () => {
    expect(normalizeFontSize(undefined, 48)).toBe(17); // 48*0.36=17.28
    expect(normalizeFontSize(undefined, 20)).toBe(16); // 20*0.36=7.2 → 16
  });
});
