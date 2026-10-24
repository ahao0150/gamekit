/**
 * 通用组件：滑杆（slider，T18）。
 *
 * 纯绘制，**状态由游戏传**（`value` 0..1，游戏自己处理拖拽）：组件不知道「谁在拖」，
 * 也不碰 hit / press —— 那是交互层的事，组件只画当前值。
 *
 * 几何口径（写死，单测锁住具体数值）：
 * - `travel = 轨道长 - 滑块直径`；
 * - 填充长 = `value × travel`（从轨道起点到滑块左边缘，滑块再盖上去刚好接住）；
 * - 滑块中心 = `起点 + 滑块半径 + value × travel`。
 */

import type { DefinedComponent } from '../components';
import { boolProp, defineComponent, numberProp, stringProp } from '../components';
import type { StyleProps } from '../layout-spec';
import { fillRect } from '../builtin-draw';

const DEFAULT_LENGTH = 240;
const CROSS = 40; // 交叉轴厚度（滑块竖着放得下）
const DEFAULT_KNOB = 20;
const MIN_KNOB = 2;

const isVertical = (props: StyleProps): boolean => stringProp(props, 'direction', 'horizontal') === 'vertical';

/** value 钳到 0..1（NaN 当 0）。 */
const ratioOf = (props: StyleProps): number => {
  const raw = numberProp(props, 'value', 0);
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
};

export const slider: DefinedComponent = defineComponent('slider', {
  props: {
    value: 'number',
    knobSize: 'number',
    trackColor: 'string',
    fillColor: 'string',
    knobColor: 'string',
    disabled: 'boolean',
    direction: 'horizontal|vertical',
  },
  defaultSize: { w: DEFAULT_LENGTH, h: CROSS },
  measure: (_env, _box, props) =>
    isVertical(props) ? { w: CROSS, h: DEFAULT_LENGTH } : { w: DEFAULT_LENGTH, h: CROSS },
  draw: (ctx, box, props, deps) => {
    if (!(box.w > 0) || !(box.h > 0)) return;
    const vertical = isVertical(props);
    const disabled = boolProp(props, 'disabled');
    // 滑块直径不能超过轨道厚度，否则会画出框外（也对不齐交叉轴中心）
    const knob = Math.max(MIN_KNOB, Math.min(numberProp(props, 'knobSize', DEFAULT_KNOB), Math.min(box.w, box.h)));
    const radius = knob / 2;
    const travel = Math.max(0, (vertical ? box.h : box.w) - knob);
    const filled = ratioOf(props) * travel;
    const trackThickness = Math.max(2, knob * 0.35);

    const track = disabled ? deps.theme.disabled : stringProp(props, 'trackColor', deps.theme.gridLine);
    const fill = disabled ? deps.theme.disabled : stringProp(props, 'fillColor', deps.theme.primary);
    const knobColor = disabled ? deps.theme.disabled : stringProp(props, 'knobColor', deps.theme.light);

    if (vertical) {
      const cx = box.x + box.w / 2;
      fillRect(ctx, { x: cx - trackThickness / 2, y: box.y, w: trackThickness, h: box.h }, track);
      if (filled > 0) {
        fillRect(ctx, { x: cx - trackThickness / 2, y: box.y + box.h - filled, w: trackThickness, h: filled }, fill);
      }
      ctx.fillStyle = knobColor;
      ctx.beginPath();
      ctx.arc(cx, box.y + box.h - radius - filled, radius, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const cy = box.y + box.h / 2;
    fillRect(ctx, { x: box.x, y: cy - trackThickness / 2, w: box.w, h: trackThickness }, track);
    if (filled > 0) fillRect(ctx, { x: box.x, y: cy - trackThickness / 2, w: filled, h: trackThickness }, fill);
    ctx.fillStyle = knobColor;
    ctx.beginPath();
    ctx.arc(box.x + radius + filled, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const value = numberProp(props, 'value', 0);
    if (value < 0 || value > 1) issues.push(`value ${value} 超出 0..1，绘制时会被钳制`);
    const knob = numberProp(props, 'knobSize', DEFAULT_KNOB);
    if (!(knob > 0)) issues.push(`knobSize 必须大于 0，收到 ${knob}`);
    if (box.w <= 0 || box.h <= 0) issues.push(`slider 尺寸非法：${box.w}×${box.h}`);
    return issues;
  },
});
