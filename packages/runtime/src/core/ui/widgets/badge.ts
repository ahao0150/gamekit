/**
 * 通用组件：角标 / 红点。
 *
 * 位置固定：相对组件自身 box 的**右上角内缩 2px**（组件 box 由布局给，
 * 游戏把它放在谁旁边，角标就贴在谁右上角）。
 * - `text` 为空 → 纯圆点（圆用 arc + fill 画）；
 * - `text` 非空 → 胶囊底 + 文字。
 * 颜色默认走主题 primary，可用 `color` 覆盖（主题里没有「红」，默认取主色）。
 */

import type { DefinedComponent } from '../components';
import { defineComponent, estimateTextWidth, numberProp, stringProp } from '../components';
import { fillRoundRect } from './draw-utils';

/** 角标离 box 右上角的内缩距离。 */
const INSET = 2;
const DEFAULT_DOT = 10;

export const badge: DefinedComponent = defineComponent('badge', {
  props: { text: 'string', dotSize: 'number', color: 'string' },
  defaultSize: { w: 24, h: 24 },
  measure: (_env, _box, props) => {
    const text = stringProp(props, 'text');
    const dot = Math.max(2, numberProp(props, 'dotSize', DEFAULT_DOT));
    if (text.length === 0) return { w: dot, h: dot };
    const font = Math.max(8, dot * 0.8);
    return { w: Math.ceil(estimateTextWidth(text, font) + 8), h: Math.ceil(dot * 1.4) };
  },
  draw: (ctx, box, props, deps) => {
    const color = stringProp(props, 'color', deps.theme.primary);
    const text = stringProp(props, 'text');
    const dot = Math.max(2, numberProp(props, 'dotSize', DEFAULT_DOT));

    if (text.length === 0) {
      // 纯圆点：圆心在「右上角内缩 2px」后自己的中心
      const cx = box.x + box.w - INSET - dot / 2;
      const cy = box.y + INSET + dot / 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, dot / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      return;
    }

    const font = Math.max(8, Math.round(dot * 0.8));
    const w = Math.max(dot, estimateTextWidth(text, font) + 8);
    const h = Math.max(dot, font + 4);
    const rect = { x: box.x + box.w - INSET - w, y: box.y + INSET, w, h };
    fillRoundRect(ctx, rect, h / 2, color);
    ctx.fillStyle = deps.theme.light;
    ctx.font = `${font}px ${deps.theme.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, rect.x + rect.w / 2, rect.y + rect.h / 2);
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const dot = numberProp(props, 'dotSize', DEFAULT_DOT);
    if (!(dot > 0)) issues.push(`dotSize 必须大于 0，收到 ${dot}`);
    if (box.w < dot || box.h < dot) issues.push(`badge 的 box ${box.w}×${box.h}px 小于 dotSize ${dot}px，角标会超出盒子`);
    return issues;
  },
});
