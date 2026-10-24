/**
 * 通用组件：开关（switch，T18）。
 *
 * 纯绘制 + 状态由游戏传（`on`）：点击后改什么值、要不要动画，都是游戏的事。
 * 几何：圆角轨道铺满 box，滑块是半径 `(h - 2×pad) / 2` 的圆——开在右、关在左。
 *
 * 注：注册名是 `switch`（`.ui` 里写 `put switch`），但 JS 里 `switch` 是保留字，
 * 所以导出变量叫 `switchToggle`。
 */

import type { DefinedComponent } from '../components';
import { boolProp, defineComponent, numberProp, stringProp } from '../components';
import { fillRoundRect } from './draw-utils';

const DEFAULT_W = 52;
const DEFAULT_H = 30;
/** 滑块与轨道边缘的留白（同时决定滑块半径）。 */
const PAD = 3;

export const switchToggle: DefinedComponent = defineComponent('switch', {
  props: {
    on: 'boolean',
    knobColor: 'string',
    trackOnColor: 'string',
    trackOffColor: 'string',
    width: 'number',
    height: 'number',
  },
  defaultSize: { w: DEFAULT_W, h: DEFAULT_H },
  measure: (_env, _box, props) => ({
    w: Math.max(1, numberProp(props, 'width', DEFAULT_W)),
    h: Math.max(1, numberProp(props, 'height', DEFAULT_H)),
  }),
  draw: (ctx, box, props, deps) => {
    if (!(box.w > 0) || !(box.h > 0)) return;
    const on = boolProp(props, 'on');
    const track = on ? stringProp(props, 'trackOnColor', deps.theme.primary) : stringProp(props, 'trackOffColor', deps.theme.gridLine);
    const knob = stringProp(props, 'knobColor', deps.theme.light);
    // 轨道是「胶囊」：半径 = 短边一半
    fillRoundRect(ctx, box, Math.min(box.w, box.h) / 2, track);

    const pad = Math.max(0, Math.min(PAD, Math.min(box.w, box.h) / 2 - 1));
    const radius = Math.max(1, (box.h - pad * 2) / 2);
    const cy = box.y + box.h / 2;
    const cx = on ? box.x + box.w - pad - radius : box.x + pad + radius;
    ctx.fillStyle = knob;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const width = numberProp(props, 'width', DEFAULT_W);
    const height = numberProp(props, 'height', DEFAULT_H);
    if (!(width > 0) || !(height > 0)) issues.push(`width / height 必须大于 0，收到 ${width}×${height}`);
    if (box.h < 12) issues.push(`switch 高 ${box.h}px < 12px，滑块会贴边`);
    return issues;
  },
});
