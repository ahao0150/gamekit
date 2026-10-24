/**
 * 通用组件：单选框（radio，T18）。
 *
 * 纯绘制 + 状态由游戏传（`checked`，同组互斥的「谁选中」是游戏的数据，不是组件的）。
 * 形态：外圈实心圆 + 选中时内层实心圆（两次 `arc`）。
 */

import type { DefinedComponent } from '../components';
import { boolProp, defineComponent, numberProp, stringProp } from '../components';

const DEFAULT_SIZE = 24;

export const radio: DefinedComponent = defineComponent('radio', {
  props: {
    checked: 'boolean',
    size: 'number',
    color: 'string',
    bgColor: 'string',
  },
  defaultSize: { w: DEFAULT_SIZE, h: DEFAULT_SIZE },
  measure: (_env, _box, props) => {
    const size = Math.max(1, numberProp(props, 'size', DEFAULT_SIZE));
    return { w: size, h: size };
  },
  draw: (ctx, box, props, deps) => {
    if (!(box.w > 0) || !(box.h > 0)) return;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const radius = Math.min(box.w, box.h) / 2;
    // 外圈：底盘圆
    ctx.fillStyle = stringProp(props, 'bgColor', deps.theme.panel);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    if (!boolProp(props, 'checked')) return;
    // 内点：选中标记（半径 45%，比外圈小一圈，留出「环」的观感）
    ctx.fillStyle = stringProp(props, 'color', deps.theme.primary);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, radius * 0.45), 0, Math.PI * 2);
    ctx.fill();
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const size = numberProp(props, 'size', DEFAULT_SIZE);
    if (!(size > 0)) issues.push(`size 必须大于 0，收到 ${size}`);
    if (box.w < 8 || box.h < 8) issues.push(`radio ${box.w}×${box.h}px 太小，内点会看不出来`);
    return issues;
  },
});
