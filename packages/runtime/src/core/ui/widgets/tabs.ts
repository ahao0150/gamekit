/**
 * 通用组件：标签栏（tabs，T19）。
 *
 * 数据驱动：标签文字从 `deps.data.tabs` 拿，props 只放标量（`active` 下标）。
 * 绘制：横向等分标签 + 居中文字 + 选中项下方指示条（**指示条宽 = 单个标签宽**）。
 */

import type { DefinedComponent } from '../components';
import { defineComponent, numberProp, stringProp } from '../components';
import { fillRect } from '../builtin-draw';
import { readIndex, readStringList } from './data-read';

const DEFAULT_ITEM_H = 40;
const DEFAULT_INDICATOR = 3;

export const tabs: DefinedComponent = defineComponent('tabs', {
  props: {
    active: 'number',
    itemH: 'number',
    activeColor: 'string',
    color: 'string',
    indicatorH: 'number',
  },
  defaultSize: { w: 296, h: DEFAULT_ITEM_H },
  measure: (_env, box, props) => ({ w: box.w, h: Math.max(1, numberProp(props, 'itemH', DEFAULT_ITEM_H)) }),
  draw: (ctx, box, props, deps) => {
    if (!(box.w > 0) || !(box.h > 0)) return;
    const labels = readStringList(deps.data, 'tabs');
    if (labels.length === 0) return;
    const itemH = Math.min(Math.max(1, numberProp(props, 'itemH', DEFAULT_ITEM_H)), box.h);
    const activeColor = stringProp(props, 'activeColor', deps.theme.primary);
    const color = stringProp(props, 'color', deps.theme.light);
    const indicatorH = Math.max(1, Math.min(numberProp(props, 'indicatorH', DEFAULT_INDICATOR), itemH));
    const tabW = box.w / labels.length;
    const active = readIndex(props, 'active', labels.length);

    ctx.font = `${Math.max(8, Math.round(itemH * 0.42))}px ${deps.theme.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    labels.forEach((text, index) => {
      if (text.length === 0) return;
      ctx.fillStyle = index === active ? activeColor : color;
      ctx.fillText(text, box.x + tabW * index + tabW / 2, box.y + itemH / 2, tabW * 0.92);
    });

    // 指示条：宽 = 标签宽，贴在当前标签底部
    fillRect(ctx, { x: box.x + active * tabW, y: box.y + itemH - indicatorH, w: tabW, h: indicatorH }, activeColor);
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const itemH = numberProp(props, 'itemH', DEFAULT_ITEM_H);
    if (!(itemH > 0)) issues.push(`itemH 必须大于 0，收到 ${itemH}`);
    if (box.w <= 0 || box.h <= 0) issues.push(`tabs 尺寸非法：${box.w}×${box.h}`);
    return issues;
  },
});
