/**
 * 通用组件：分段控件（segmented，T19）。
 *
 * 数据驱动：分段文字从 `deps.data.segments` 拿，props 只放标量（`active` 下标）。
 * 绘制：圆角底板 + 选中项的圆角高亮块 + 文字。选中块与底板用同一套等分几何。
 */

import type { DefinedComponent } from '../components';
import { defineComponent, numberProp, stringProp } from '../components';
import type { Rect } from '../contract';
import { fillRoundRect } from './draw-utils';
import { readIndex, readStringList } from './data-read';

const DEFAULT_ITEM_H = 32;
const DEFAULT_RADIUS = 6;
/** 高亮块相对底板的内缩（视觉上「嵌在里面」）。 */
const INSET = 2;

export const segmented: DefinedComponent = defineComponent('segmented', {
  props: {
    active: 'number',
    itemH: 'number',
    radius: 'number',
    activeColor: 'string',
    itemColor: 'string',
    textColor: 'string',
  },
  defaultSize: { w: 296, h: DEFAULT_ITEM_H },
  measure: (_env, box, props) => ({ w: box.w, h: Math.max(1, numberProp(props, 'itemH', DEFAULT_ITEM_H)) }),
  draw: (ctx, box, props, deps) => {
    if (!(box.w > 0) || !(box.h > 0)) return;
    const segments = readStringList(deps.data, 'segments');
    if (segments.length === 0) return;
    const itemH = Math.min(Math.max(1, numberProp(props, 'itemH', DEFAULT_ITEM_H)), box.h);
    const body: Rect = { x: box.x, y: box.y + (box.h - itemH) / 2, w: box.w, h: itemH };
    const radius = Math.max(0, numberProp(props, 'radius', DEFAULT_RADIUS));
    const active = readIndex(props, 'active', segments.length);
    const segW = body.w / segments.length;

    fillRoundRect(ctx, body, radius, stringProp(props, 'itemColor', deps.theme.panel));
    // 内缩不能超过格子一半，否则窄格子会画成负宽
    const inset = Math.min(INSET, segW / 4, body.h / 4);
    const highlight: Rect = {
      x: body.x + active * segW + inset,
      y: body.y + inset,
      w: Math.max(1, segW - inset * 2),
      h: Math.max(1, body.h - inset * 2),
    };
    fillRoundRect(ctx, highlight, Math.max(0, radius - inset), stringProp(props, 'activeColor', deps.theme.primary));

    ctx.fillStyle = stringProp(props, 'textColor', deps.theme.light);
    ctx.font = `${Math.max(8, Math.round(itemH * 0.42))}px ${deps.theme.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    segments.forEach((text, index) => {
      if (text.length === 0) return;
      ctx.fillText(text, body.x + segW * index + segW / 2, body.y + body.h / 2, segW * 0.9);
    });
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const itemH = numberProp(props, 'itemH', DEFAULT_ITEM_H);
    if (!(itemH > 0)) issues.push(`itemH 必须大于 0，收到 ${itemH}`);
    if (box.w <= 0 || box.h <= 0) issues.push(`segmented 尺寸非法：${box.w}×${box.h}`);
    return issues;
  },
});
