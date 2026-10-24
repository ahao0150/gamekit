/**
 * 通用组件：文本（左 / 中 / 右对齐，超宽省略号）。
 *
 * 宽度估算用 `estimateTextWidth`（布局期不许碰 canvas，绘制期也复用同一口径）——
 * 「测得下」和「画得下」必须是一套算法，这是文字溢出的经典来源。
 */

import type { DefinedComponent } from '../components';
import { defineComponent, estimateTextWidth, numberProp, stringProp } from '../components';

const DEFAULT_FONT = 16;
const ELLIPSIS = '…';

/** 超宽时逐字裁剪并加省略号（估算宽 <= maxWidth）。 */
const ellipsize = (text: string, font: number, maxWidth: number): string => {
  if (maxWidth <= 0) return text;
  if (estimateTextWidth(text, font) <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 0 && estimateTextWidth(`${chars.join('')}${ELLIPSIS}`, font) > maxWidth) {
    chars.pop();
  }
  return chars.length === 0 ? '' : `${chars.join('')}${ELLIPSIS}`;
};

export const label: DefinedComponent = defineComponent('label', {
  props: {
    text: 'string',
    fontSize: 'number',
    color: 'string',
    align: 'left|center|right',
    maxWidth: 'number',
  },
  defaultSize: { w: 120, h: 20 },
  measure: (_env, _box, props) => {
    const font = Math.max(1, numberProp(props, 'fontSize', DEFAULT_FONT));
    const maxWidth = numberProp(props, 'maxWidth', 0);
    const raw = estimateTextWidth(stringProp(props, 'text'), font);
    const w = maxWidth > 0 ? Math.min(raw, maxWidth) : raw;
    return { w: Math.max(1, Math.ceil(w)), h: Math.max(1, Math.ceil(font * 1.2)) };
  },
  draw: (ctx, box, props, deps) => {
    const text = stringProp(props, 'text');
    if (text.length === 0) return;
    const font = Math.max(1, numberProp(props, 'fontSize', DEFAULT_FONT));
    const maxWidth = numberProp(props, 'maxWidth', box.w);
    const shown = ellipsize(text, font, maxWidth);
    if (shown.length === 0) return;
    const rawAlign = stringProp(props, 'align', 'left');
    const align: CanvasTextAlign = rawAlign === 'center' ? 'center' : rawAlign === 'right' ? 'right' : 'left';
    const x = align === 'center' ? box.x + box.w / 2 : align === 'right' ? box.x + box.w : box.x;
    ctx.fillStyle = stringProp(props, 'color', deps.theme.light);
    ctx.font = `${font}px ${deps.theme.fontFamily}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(shown, x, box.y + box.h / 2, maxWidth > 0 ? maxWidth : box.w);
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const font = numberProp(props, 'fontSize', DEFAULT_FONT);
    if (!(font > 0)) issues.push(`fontSize 必须大于 0，收到 ${font}`);
    if (box.h < font) issues.push(`label 高 ${box.h}px < 字号 ${font}px，文字会被裁切`);
    return issues;
  },
});
