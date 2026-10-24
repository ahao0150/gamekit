/**
 * 通用组件：进度条（纯绘制，无贴图）。
 *
 * 颜色一律从 `DrawDeps.theme` 取默认值（track=panel、fill=primary），
 * 游戏可用 `style trackColor=… fillColor=…` 覆盖——组件里不写死任何主题色。
 */

import type { DefinedComponent } from '../components';
import { boolProp, defineComponent, numberProp, stringProp } from '../components';
import type { StyleProps } from '../layout-spec';
import { fillRoundRect } from './draw-utils';

/** 水平默认尺寸。 */
const DEFAULT_W = 180;
const DEFAULT_H = 12;
/** 垂直默认尺寸（对调）。 */
const VERTICAL_W = 12;
const VERTICAL_H = 120;

const ratioOf = (props: StyleProps): number => {
  const max = numberProp(props, 'max', 100);
  const value = numberProp(props, 'value', 0);
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(1, value / max));
};

export const progress: DefinedComponent = defineComponent('progress', {
  props: {
    value: 'number',
    max: 'number',
    direction: 'horizontal|vertical',
    radius: 'number',
    trackColor: 'string',
    fillColor: 'string',
    showText: 'boolean',
    textSize: 'number',
  },
  defaultSize: { w: DEFAULT_W, h: DEFAULT_H },
  measure: (_env, _box, props) => {
    const vertical = stringProp(props, 'direction', 'horizontal') === 'vertical';
    return vertical ? { w: VERTICAL_W, h: VERTICAL_H } : { w: DEFAULT_W, h: DEFAULT_H };
  },
  draw: (ctx, box, props, deps) => {
    const ratio = ratioOf(props);
    const vertical = stringProp(props, 'direction', 'horizontal') === 'vertical';
    const radius = Math.max(0, numberProp(props, 'radius', 0));
    const track = stringProp(props, 'trackColor', deps.theme.panel);
    const fill = stringProp(props, 'fillColor', deps.theme.primary);

    fillRoundRect(ctx, box, radius, track);
    // 填充部分：horizontal 从左、vertical 从底部；比例已钳到 0..1
    const filled = vertical
      ? { x: box.x, y: box.y + box.h * (1 - ratio), w: box.w, h: box.h * ratio }
      : { x: box.x, y: box.y, w: box.w * ratio, h: box.h };
    if (filled.w > 0 && filled.h > 0) fillRoundRect(ctx, filled, radius, fill);

    if (!boolProp(props, 'showText')) return;
    const size = Math.max(8, Math.round(numberProp(props, 'textSize', Math.max(10, box.h * 0.6))));
    ctx.fillStyle = deps.theme.light;
    ctx.font = `${size}px ${deps.theme.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(ratio * 100)}%`, box.x + box.w / 2, box.y + box.h / 2);
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const max = numberProp(props, 'max', 100);
    const value = numberProp(props, 'value', 0);
    if (!(max > 0)) issues.push(`max 必须大于 0，收到 ${max}（进度条会退回 0%）`);
    if (value < 0 || value > max) issues.push(`value ${value} 超出 0..${max}，绘制时会被钳制`);
    if (box.w < 24 && box.h < 24) issues.push(`进度条 ${box.w}×${box.h}px 太小（两轴都 < 24px）`);
    return issues;
  },
});
