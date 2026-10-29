/**
 * 聊天输入条：**只画，不弹键盘**。
 *
 * 为什么不碰 platform（AGENTS §2 铁律 5）：弹键盘要 `platform.keyboard.open({ rect })`，
 * 那是游戏侧的调用，组件只负责把输入框画出来并告诉游戏「点哪儿算输入区」。
 * 这与现有 `input.ts` 一个路子（它也只画不弹，由游戏调 keyboard.open）。
 *
 * 两个可点区（输入框 / 发送键）靠 `composerHit(box, props, point)` 换算，
 * **几何与绘制共用 `composerParts(box, props)`** —— 与 `keypad` 的 `keypadHit` 同一先例，
 * 满足「画与点同源」。
 */

import type { Ctx2D } from '../../../platform/contract';
import type { Rect } from '../contract';
import type { DefinedComponent } from '../components';
import type { StyleProps } from '../layout-spec';
import { boolProp, defineComponent, numberProp, stringProp } from '../components';
import { fillRoundRect, roundPath } from './draw-utils';

const DEFAULT_SEND_W = 56;
const FIELD_GAP = 8;
const RADIUS = 8;
const DEFAULT_FONT = 15;
/** 光标闪烁周期（与 `input.ts` 同口径：从 Date.now() 推，不开定时器）。 */
const CURSOR_PERIOD_MS = 1000;

export interface ComposerParts {
  /** 输入框（吃掉发送键之外的宽度） */
  readonly field: Rect;
  /** 发送键（靠右，占满高度） */
  readonly send: Rect;
}

/**
 * 唯一几何真源：`draw()` 与 `composerHit()` 共用。
 *
 * 发送键宽度取 `sendWidth`（默认 56），在窄容器里最多占一半宽，
 * 避免 `box.w` 很小时输入框被挤成 0 宽（那样点哪儿都是「发送」）。
 */
export const composerParts = (box: Rect, props: StyleProps): ComposerParts => {
  const rawSend = numberProp(props, 'sendWidth', DEFAULT_SEND_W);
  const sendW = Math.max(0, Math.min(rawSend > 0 ? rawSend : DEFAULT_SEND_W, box.w / 2));
  const fieldW = Math.max(0, box.w - sendW - (sendW > 0 ? FIELD_GAP : 0));
  return {
    field: { x: box.x, y: box.y, w: fieldW, h: box.h },
    send: { x: box.x + box.w - sendW, y: box.y, w: sendW, h: box.h },
  };
};

const inside = (rect: Rect, point: { readonly x: number; readonly y: number }): boolean =>
  point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;

/** 点位 → 哪个可点区。容器外 → `null`（不就近归并）。 */
export const composerHit = (
  box: Rect,
  props: StyleProps,
  point: { readonly x: number; readonly y: number },
): 'input' | 'send' | null => {
  if (!inside(box, point)) return null;
  const parts = composerParts(box, props);
  if (inside(parts.send, point)) return 'send';
  if (inside(parts.field, point)) return 'input';
  return null;
};

const drawText = (
  ctx: Ctx2D,
  value: string,
  rect: Rect,
  size: number,
  color: string,
  family: string,
  align: CanvasTextAlign = 'left',
): void => {
  ctx.fillStyle = color;
  ctx.font = `${size}px ${family}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(value, align === 'center' ? rect.x + rect.w / 2 : rect.x, rect.y + rect.h / 2, rect.w);
};

export const chatComposer: DefinedComponent = defineComponent('chatComposer', {
  props: {
    value: 'string',
    placeholder: 'string',
    maxLength: 'number',
    sendText: 'string',
    sendWidth: 'number',
    focused: 'boolean',
    sending: 'boolean',
  },
  defaultSize: { w: 296, h: 56 },
  measure: (_env, box) => ({ w: box.w, h: box.h }),
  draw: (ctx, box, props, deps) => {
    if (!(box.w > 0) || !(box.h > 0)) return;
    const parts = composerParts(box, props);
    const font = DEFAULT_FONT;
    const value = stringProp(props, 'value', '');
    const focused = boolProp(props, 'focused', false);
    const sending = boolProp(props, 'sending', false);

    // 输入框：浅底 + 1px 边（聚焦时用主色边，这是唯一的焦点反馈）
    fillRoundRect(ctx, parts.field, RADIUS, deps.theme.panel);
    ctx.strokeStyle = focused ? deps.theme.primary : deps.theme.gridLine;
    ctx.lineWidth = 1;
    roundPath(ctx, parts.field, RADIUS);
    ctx.stroke();

    const padX = 12;
    const textRect: Rect = { x: parts.field.x + padX, y: parts.field.y, w: Math.max(0, parts.field.w - padX * 2), h: parts.field.h };
    if (value.length > 0) {
      drawText(ctx, value, textRect, font, deps.theme.light, deps.theme.fontFamily);
    } else {
      drawText(ctx, stringProp(props, 'placeholder', '说点什么…'), textRect, font, deps.theme.disabled, deps.theme.fontFamily);
    }
    // 光标：聚焦且没有发送中时闪（周期 1s，前半周期可见）
    if (focused && !sending) {
      const on = Math.floor(Date.now() / (CURSOR_PERIOD_MS / 2)) % 2 === 0;
      if (on) {
        const cursorX = textRect.x + (value.length > 0 ? Math.min(textRect.w, value.length * font * 0.55) : 0);
        ctx.fillStyle = deps.theme.primary;
        ctx.fillRect(Math.min(cursorX, textRect.x + textRect.w - 1), parts.field.y + parts.field.h * 0.25, 1, parts.field.h * 0.5);
      }
    }

    // 发送键
    const sendText = sending ? '发送中' : stringProp(props, 'sendText', '发送');
    ctx.save();
    if (sending) ctx.globalAlpha = 0.6;
    fillRoundRect(ctx, parts.send, RADIUS, deps.theme.primary);
    drawText(ctx, sendText, parts.send, font, deps.theme.light, deps.theme.fontFamily, 'center');
    ctx.restore();
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const sendW = numberProp(props, 'sendWidth', DEFAULT_SEND_W);
    if (!(sendW > 0)) issues.push(`sendWidth 必须大于 0，收到 ${sendW}`);
    if (box.w > 0 && sendW > box.w / 2) {
      issues.push(`sendWidth ${sendW}px 超过容器宽 ${Math.round(box.w)}px 的一半，输入框会被挤没（绘制时按一半钳制）`);
    }
    const maxLength = numberProp(props, 'maxLength', 0);
    if (maxLength > 0) {
      const value = stringProp(props, 'value', '');
      if (value.length > maxLength) {
        issues.push(`value 长度 ${value.length} 超过 maxLength ${maxLength}（输入时应当拦住，不要等渲染）`);
      }
    }
    return issues;
  },
});
