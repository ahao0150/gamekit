/**
 * 通用组件：复选框（checkbox，T18）。
 *
 * 纯绘制 + 状态由游戏传（`checked`）。对勾用 **path 描边**画（不是字符 ✓）：
 * 字符对勾在不同机型字体的粗细/基线不一致，path 才能保证三端一样。
 */

import type { DefinedComponent } from '../components';
import { boolProp, defineComponent, numberProp, stringProp } from '../components';
import type { Rect } from '../contract';
import { fillRoundRect } from './draw-utils';

const DEFAULT_SIZE = 24;
const DEFAULT_RADIUS = 4;

/** 正方形框（box 可能不是方形，取短边居中）。 */
const boxSquare = (box: Rect): Rect => {
  const side = Math.min(box.w, box.h);
  return { x: box.x + (box.w - side) / 2, y: box.y + (box.h - side) / 2, w: side, h: side };
};

export const checkbox: DefinedComponent = defineComponent('checkbox', {
  props: {
    checked: 'boolean',
    size: 'number',
    checkColor: 'string',
    bgColor: 'string',
    radius: 'number',
  },
  defaultSize: { w: DEFAULT_SIZE, h: DEFAULT_SIZE },
  measure: (_env, _box, props) => {
    const size = Math.max(1, numberProp(props, 'size', DEFAULT_SIZE));
    return { w: size, h: size };
  },
  draw: (ctx, box, props, deps) => {
    if (!(box.w > 0) || !(box.h > 0)) return;
    const square = boxSquare(box);
    fillRoundRect(ctx, square, Math.max(0, numberProp(props, 'radius', DEFAULT_RADIUS)), stringProp(props, 'bgColor', deps.theme.primary));
    if (!boolProp(props, 'checked')) return;

    // 对勾：三个点的描边路径（左短右长），粗细随框大小走
    const color = stringProp(props, 'checkColor', deps.theme.light);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, square.w * 0.12);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(square.x + square.w * 0.24, square.y + square.h * 0.54);
    ctx.lineTo(square.x + square.w * 0.42, square.y + square.h * 0.72);
    ctx.lineTo(square.x + square.w * 0.76, square.y + square.h * 0.3);
    ctx.stroke();
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const size = numberProp(props, 'size', DEFAULT_SIZE);
    if (!(size > 0)) issues.push(`size 必须大于 0，收到 ${size}`);
    if (box.w < 8 || box.h < 8) issues.push(`checkbox ${box.w}×${box.h}px 太小，对勾会糊成一团`);
    return issues;
  },
});
