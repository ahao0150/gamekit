/**
 * 通用组件：分割线（水平 / 垂直，厚度默认 1px）。
 *
 * 颜色默认走主题 gridLine；线在 box 内**居中**画（box 可以比线粗，便于布局占位）。
 */

import type { DefinedComponent } from '../components';
import { defineComponent, numberProp, stringProp } from '../components';
import { fillRect } from '../builtin-draw';

const DEFAULT_LENGTH = 200;

export const divider: DefinedComponent = defineComponent('divider', {
  props: { direction: 'horizontal|vertical', thickness: 'number', color: 'string' },
  defaultSize: { w: DEFAULT_LENGTH, h: 1 },
  measure: (_env, _box, props) => {
    const vertical = stringProp(props, 'direction', 'horizontal') === 'vertical';
    const thickness = Math.max(1, numberProp(props, 'thickness', 1));
    return vertical ? { w: thickness, h: DEFAULT_LENGTH } : { w: DEFAULT_LENGTH, h: thickness };
  },
  draw: (ctx, box, props, deps) => {
    const vertical = stringProp(props, 'direction', 'horizontal') === 'vertical';
    const thickness = Math.max(1, numberProp(props, 'thickness', 1));
    const color = stringProp(props, 'color', deps.theme.gridLine);
    if (vertical) {
      const x = box.x + (box.w - thickness) / 2;
      fillRect(ctx, { x, y: box.y, w: thickness, h: box.h }, color);
    } else {
      const y = box.y + (box.h - thickness) / 2;
      fillRect(ctx, { x: box.x, y, w: box.w, h: thickness }, color);
    }
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const thickness = numberProp(props, 'thickness', 1);
    if (!(thickness > 0)) issues.push(`thickness 必须大于 0，收到 ${thickness}`);
    const vertical = stringProp(props, 'direction', 'horizontal') === 'vertical';
    if (vertical && box.w < thickness) issues.push(`垂直分割线宽度 ${box.w}px < thickness ${thickness}px`);
    if (!vertical && box.h < thickness) issues.push(`水平分割线高度 ${box.h}px < thickness ${thickness}px`);
    return issues;
  },
});
