/**
 * 通用组件：数字键盘（keypad，T19）。
 *
 * 数据驱动：键位文字从 `deps.data.keys` 拿（`del` / `ok` 就是普通字符串，直接当文字画）。
 * 网格几何与命中判定**共用** `keypad-hit.ts`，避免「画的和点的不一致」。
 */

import type { DefinedComponent } from '../components';
import { defineComponent, numberProp, stringProp } from '../components';
import type { StyleProps } from '../layout-spec';
import { fillRoundRect } from './draw-utils';
import { readStringList } from './data-read';
import { keypadCell, keypadMetrics } from './keypad-hit';
import type { KeypadOptions } from './keypad-hit';

const DEFAULT_COLS = 3;
const DEFAULT_KEY_H = 52;
const DEFAULT_GAP = 6;
const DEFAULT_RADIUS = 6;

/** 网格参数（props + 数据）。 */
const optionsOf = (props: StyleProps, keys: readonly string[]): KeypadOptions => ({
  cols: numberProp(props, 'cols', DEFAULT_COLS),
  keyH: numberProp(props, 'keyH', DEFAULT_KEY_H),
  gap: numberProp(props, 'gap', DEFAULT_GAP),
  keys,
});

export const keypad: DefinedComponent = defineComponent('keypad', {
  props: {
    cols: 'number',
    keyH: 'number',
    gap: 'number',
    keyColor: 'string',
    textColor: 'string',
    radius: 'number',
  },
  defaultSize: { w: 296, h: 174 },
  measure: (env, box, props) => {
    const keys = readStringList(env.data, 'keys');
    const m = keypadMetrics(box, optionsOf(props, keys));
    return { w: box.w, h: m.rows * m.keyH + (m.rows - 1) * m.gap };
  },
  draw: (ctx, box, props, deps) => {
    if (!(box.w > 0) || !(box.h > 0)) return;
    const keys = readStringList(deps.data, 'keys');
    if (keys.length === 0) return;
    const opts = optionsOf(props, keys);
    const m = keypadMetrics(box, opts);
    if (!(m.keyW > 0)) return;
    const radius = Math.max(0, numberProp(props, 'radius', DEFAULT_RADIUS));
    const keyColor = stringProp(props, 'keyColor', deps.theme.panel);
    const textColor = stringProp(props, 'textColor', deps.theme.light);

    keys.forEach((key, index) => {
      const cell = keypadCell(box, opts, index);
      fillRoundRect(ctx, cell, radius, keyColor);
      if (key.length === 0) return;
      ctx.fillStyle = textColor;
      ctx.font = `${Math.max(8, Math.round(cell.h * 0.42))}px ${deps.theme.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(key, cell.x + cell.w / 2, cell.y + cell.h / 2, cell.w * 0.9);
    });
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const cols = numberProp(props, 'cols', DEFAULT_COLS);
    if (!(cols >= 1)) issues.push(`cols 必须 ≥ 1，收到 ${cols}`);
    const gap = numberProp(props, 'gap', DEFAULT_GAP);
    if (gap < 0) issues.push(`gap 不能是负数，收到 ${gap}`);
    if (box.w <= 0 || box.h <= 0) issues.push(`keypad 尺寸非法：${box.w}×${box.h}`);
    return issues;
  },
});
