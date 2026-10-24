/**
 * 通用组件：输入框（T34）。
 *
 * 边界（写死，别扩散）：
 * 1. **组件只画，不弹键盘**。唤起系统键盘是游戏侧的事（`platform.keyboard.open()`），
 *    组件拿 `focused` 决定要不要画光标 —— 这样同一份 `.ui` 在三端画得一样，
 *    而「怎么弹键盘」由平台层各自实现。
 * 2. **光标用 `Date.now()` 算闪烁**，不开 `setInterval`：组件每帧都会被调用，
 *    定时器只会多一个全局可变状态，还会在暂停 / 切后台时继续跑。
 * 3. **超长文字按宽度截断并补省略号**，maxLength 是**输入上限**（先按码点截，
 *    不会把 emoji 拆成两半），二者都要过。
 *
 * 那个从 `Date.now()` 推出来的闪烁，与帧率无关：500ms 一个周期，
 * 所以同一时刻无论画几帧，光标状态一致（可测）。
 */

import type { Ctx2D } from '../../../platform/contract';
import type { Rect } from '../contract';
import type { ComponentTheme, DefinedComponent } from '../components';
import type { StyleProps } from '../layout-spec';
import { boolProp, defineComponent, estimateTextWidth, numberProp, stringProp } from '../components';
import { fillRoundRect, roundPath } from './draw-utils';

const DEFAULT_W = 280;
const DEFAULT_H = 48;
/** 左右内边距 */
const PAD_X = 12;
/** 默认最大输入长度 */
const DEFAULT_MAX_LENGTH = 20;
/** 光标闪烁周期（ms） */
const BLINK_MS = 500;

/**
 * 按「先码点截断、再按宽度截断」的顺序收文字。
 *
 * 为什么用 `[...text]` 而不是 `text.slice`：`slice` 会把 emoji / 部分汉字拆成
 * 半个代理对，画出来是一个方框。按码点切才安全。
 */
export const fitText = (text: string, maxLength: number, maxWidth: number, font: number): string => {
  const chars = [...text];
  const capped = maxLength >= 0 ? chars.slice(0, Math.floor(maxLength)) : chars;
  if (capped.length === 0) return '';
  const joined = capped.join('');
  if (maxWidth <= 0) return '';
  if (estimateTextWidth(joined, font) <= maxWidth) return joined;
  let keep = capped.length;
  while (keep > 0 && estimateTextWidth(`${capped.slice(0, keep).join('')}…`, font) > maxWidth) {
    keep -= 1;
  }
  return keep > 0 ? `${capped.slice(0, keep).join('')}…` : '';
};

/** 光标当前该不该亮（500ms 一亮一灭，与帧率无关）。 */
export const cursorVisibleAt = (now: number): boolean => Math.floor(now / BLINK_MS) % 2 === 0;

/** 边框：圆角路径 + 描边 1px（比「内缩一格再填」省一次填充，也不会糊边）。 */
const strokeRoundRect = (ctx: Ctx2D, rect: Rect, radius: number, color: string): void => {
  if (!(rect.w > 0) || !(rect.h > 0)) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  roundPath(ctx, rect, radius);
  ctx.stroke();
};

export const input: DefinedComponent = defineComponent('input', {
  props: {
    value: 'string',
    placeholder: 'string',
    maxLength: 'number',
    textSize: 'number',
    bgColor: 'string',
    borderColor: 'string',
    radius: 'number',
    focused: 'boolean',
  },
  defaultSize: { w: DEFAULT_W, h: DEFAULT_H },
  // 高度固定（输入框有标准触摸高度），宽度跟随外层给的可用框
  measure: (_env, box) => ({ w: box.w > 0 ? box.w : DEFAULT_W, h: DEFAULT_H }),
  draw: (ctx, box, props, deps) => {
    if (!(box.w > 0) || !(box.h > 0)) return;
    const theme: ComponentTheme = deps.theme;
    const focused = boolProp(props, 'focused', false);
    const radius = Math.max(0, numberProp(props, 'radius', 8));
    const value = stringProp(props, 'value');
    const placeholder = stringProp(props, 'placeholder');
    const maxLength = numberProp(props, 'maxLength', DEFAULT_MAX_LENGTH);
    const font = Math.max(
      8,
      Math.round(numberProp(props, 'textSize', Math.min(box.h * 0.36, 22))),
    );

    // 整体裁到自己的框：超长文字与光标都不许溢出（和 list / grid 同一条规矩）
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();

    fillRoundRect(ctx, box, radius, stringProp(props, 'bgColor', theme.panel));
    if (focused) {
      strokeRoundRect(ctx, box, radius, stringProp(props, 'borderColor', theme.primary));
    }

    const textW = Math.max(0, box.w - PAD_X * 2 - (focused ? 4 : 0));
    const shown = value.length > 0 ? fitText(value, maxLength, textW, font) : '';
    const isPlaceholder = shown.length === 0;
    const text = isPlaceholder ? fitText(placeholder, -1, textW, font) : shown;

    ctx.fillStyle = isPlaceholder ? theme.disabled : theme.light;
    ctx.font = `${font}px ${theme.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const textX = box.x + PAD_X;
    const centerY = box.y + box.h / 2;
    if (text.length > 0) ctx.fillText(text, textX, centerY, textW);

    // 光标画在文字末尾；空值（只剩 placeholder）时画在最左，和系统输入框一致
    if (focused && cursorVisibleAt(Date.now())) {
      const cursorX = textX + (isPlaceholder ? 0 : estimateTextWidth(text, font));
      ctx.fillStyle = theme.light;
      ctx.fillRect(cursorX + 1, box.y + box.h * 0.25, 2, box.h * 0.5);
    }
    ctx.restore();
  },
  assert: (box, props: StyleProps) => {
    const issues: string[] = [];
    const maxLength = numberProp(props, 'maxLength', DEFAULT_MAX_LENGTH);
    const radius = numberProp(props, 'radius', 8);
    if (!(maxLength >= 1)) {
      issues.push(`maxLength 至少为 1，收到 ${maxLength}（0 或负数会让输入框永远为空）`);
    }
    if (radius < 0) issues.push(`radius 不能是负数，收到 ${radius}（绘制时按 0 处理）`);
    if (box.h < 24) issues.push(`输入框高 ${box.h}px 小于 24px，触摸目标太小`);
    return issues;
  },
});
