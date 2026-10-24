/**
 * 通用组件：滚动条（scrollbar，T20，纯绘制）。
 *
 * 状态由游戏传：`value`（当前滚动位置比例）与 `viewport`（可视内容比例）。
 * 几何口径（精确，单测断具体数值）：
 * - 轨道长 = 竖 box.h / 横 box.w；竖贴右、横贴底；
 * - 滑块长 = `viewport × 轨道长`；
 * - 滑块位置 = `value × (轨道长 - 滑块长)`；
 * - `viewport >= 1`（内容装得下）时**不画**——没有滚动就不该有滚动条。
 *
 * `opacity` 由游戏 tween 改（自动淡出），组件只照画。
 */

import type { DefinedComponent } from '../components';
import { defineComponent, numberProp, stringProp } from '../components';
import type { StyleProps } from '../layout-spec';
import { fillRoundRect } from './draw-utils';

const DEFAULT_THICKNESS = 4;
const DEFAULT_RADIUS = 2;

const isVertical = (props: StyleProps): boolean => stringProp(props, 'direction', 'vertical') === 'vertical';

/** 读一个比例参数并钳到 0..1（NaN 回落 fallback）。 */
const ratioOf = (props: StyleProps, key: string, fallback: number): number => {
  const raw = numberProp(props, key, fallback);
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : fallback;
};

export const scrollbar: DefinedComponent = defineComponent('scrollbar', {
  props: {
    value: 'number',
    viewport: 'number',
    direction: 'vertical|horizontal',
    thickness: 'number',
    radius: 'number',
    trackColor: 'string',
    thumbColor: 'string',
    opacity: 'number',
  },
  defaultSize: { w: DEFAULT_THICKNESS, h: 200 },
  measure: (_env, box, props) => {
    const thickness = Math.max(1, numberProp(props, 'thickness', DEFAULT_THICKNESS));
    return isVertical(props) ? { w: thickness, h: box.h } : { w: box.w, h: thickness };
  },
  draw: (ctx, box, props, deps) => {
    if (!(box.w > 0) || !(box.h > 0)) return;
    const viewport = ratioOf(props, 'viewport', 1);
    if (viewport >= 1 || viewport <= 0) return; // 装得下 / 非法：没有滚动条
    const opacity = ratioOf(props, 'opacity', 1);
    if (!(opacity > 0)) return; // tween 淡到 0 时不留残影

    const vertical = isVertical(props);
    const limit = vertical ? box.w : box.h;
    const thickness = Math.max(1, Math.min(numberProp(props, 'thickness', DEFAULT_THICKNESS), limit));
    const radius = Math.max(0, numberProp(props, 'radius', Math.min(DEFAULT_RADIUS, thickness / 2)));
    const trackColor = stringProp(props, 'trackColor', deps.theme.gridLine);
    const thumbColor = stringProp(props, 'thumbColor', deps.theme.primary);
    const value = ratioOf(props, 'value', 0);

    ctx.save();
    ctx.globalAlpha = opacity;
    if (vertical) {
      const track = { x: box.x + box.w - thickness, y: box.y, w: thickness, h: box.h };
      fillRoundRect(ctx, track, radius, trackColor);
      const length = viewport * box.h;
      const pos = value * (box.h - length);
      fillRoundRect(ctx, { x: track.x, y: box.y + pos, w: thickness, h: length }, radius, thumbColor);
    } else {
      const track = { x: box.x, y: box.y + box.h - thickness, w: box.w, h: thickness };
      fillRoundRect(ctx, track, radius, trackColor);
      const length = viewport * box.w;
      const pos = value * (box.w - length);
      fillRoundRect(ctx, { x: box.x + pos, y: track.y, w: length, h: thickness }, radius, thumbColor);
    }
    ctx.restore();
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const value = numberProp(props, 'value', 0);
    if (value < 0 || value > 1) issues.push(`value ${value} 超出 0..1，绘制时会被钳制`);
    const viewport = numberProp(props, 'viewport', 1);
    if (viewport < 0 || viewport > 1) issues.push(`viewport ${viewport} 超出 0..1，绘制时会被钳制`);
    if (box.w <= 0 || box.h <= 0) issues.push(`scrollbar 尺寸非法：${box.w}×${box.h}`);
    return issues;
  },
});
