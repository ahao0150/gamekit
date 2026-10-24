/**
 * 内置组件（一）：按钮 / 徽章 / 状态文字 / 暂停。
 *
 * 每个组件都遵守同一条边界：**只读 props 与 deps，不读游戏状态、不写全局**。
 * 素材缺失时一律回落纯色 —— 缺图不能白屏，也不能报错（美术分批到货是常态）。
 */

import type { ComponentDef, DefinedComponent } from './components';
import { boolProp, defineComponent, estimateTextWidth, stringProp } from './components';
import { drawCapsule, DEFAULT_CAPSULE } from './nine-slice';
import { drawCenteredText, drawIcon, drawTextAt, fillRect } from './builtin-draw';

/** 胶囊素材的 1x 高度（源图 126，2x）。 */
const BUTTON_H = DEFAULT_CAPSULE.h / 2;
/** 按钮文字左右留白。 */
const BUTTON_PAD_X = 24;
/** 按钮最小宽度（两个圆帽 + 一点中段）。 */
const BUTTON_MIN_W = 96;
/** 图标统一显示尺寸（逻辑像素）。 */
const ICON = 24;
/** 图标与文字的间距。 */
const ICON_GAP = 4;
/** 暂停按钮默认边长。 */
const PAUSE_SIZE = 44;

/** 按钮素材 key：按下态由动效层负责，组件只认 normal / disabled。 */
const buttonKey = (tone: string, disabled: boolean): string =>
  disabled ? `ui/btn-${tone}_disabled` : `ui/btn-${tone}_normal`;

/**
 * 胶囊按钮：底用三段切法（不是九宫格 —— 源图 336×126、帽宽 63，
 * 纵向没有可切片的空间，九宫格会直接拒绝），文字居中。
 */
const makeButton = (tone: 'primary' | 'secondary'): ComponentDef => ({
  props: { label: 'string', tone: 'primary|secondary', disabled: 'boolean' },
  defaultSize: { h: BUTTON_H },
  measure: (_env, _box, props) => {
    const label = stringProp(props, 'label');
    const textW = Math.ceil(estimateTextWidth(label, BUTTON_H * 0.36));
    return { w: Math.max(BUTTON_MIN_W, textW + BUTTON_PAD_X * 2), h: BUTTON_H };
  },
  draw: (ctx, box, props, deps) => {
    const disabled = boolProp(props, 'disabled');
    const activeTone = stringProp(props, 'tone', tone);
    const img = deps.assets.get(buttonKey(activeTone, disabled));
    const painted = img !== null && drawCapsule(ctx, img, box);
    if (!painted) fillRect(ctx, box, disabled ? deps.theme.disabled : deps.theme[tone]);
    drawCenteredText(ctx, box, stringProp(props, 'label'), deps.theme.light, deps.theme.fontFamily);
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const label = stringProp(props, 'label');
    if (label.length > 8) issues.push(`label '${label}' 有 ${label.length} 字，超过 8 字在胶囊按钮里会挤成一条`);
    if (box.w <= box.h) {
      issues.push(`按钮宽 ${box.w}px ≤ 高 ${box.h}px：胶囊两帽就要 ${box.h}px，中段拼不出来`);
    }
    return issues;
  },
});

/** 主按钮（tone 可由 style 覆盖）。 */
export const primaryButton: DefinedComponent = defineComponent('primaryButton', makeButton('primary'));
/** 次按钮。 */
export const secondaryButton: DefinedComponent = defineComponent('secondaryButton', makeButton('secondary'));

/** 金币徽章：图标 + 数值，整体按图标高对齐。 */
export const coinBadge: DefinedComponent = defineComponent('coinBadge', {
  props: { label: 'string', icon: 'string' },
  defaultSize: { h: ICON },
  measure: (_env, _box, props) => {
    const label = stringProp(props, 'label', '0');
    const font = ICON * 0.8;
    return { w: ICON + ICON_GAP + estimateTextWidth(label, font), h: ICON };
  },
  draw: (ctx, box, props, deps) => {
    const label = stringProp(props, 'label', '0');
    const color = deps.theme.ink;
    const img = deps.assets.get(stringProp(props, 'icon', 'icons/icon-coin'));
    const x = img === null ? box.x : box.x + ICON + ICON_GAP;
    if (img !== null) drawIcon(ctx, img, box.x, box.y + (box.h - ICON) / 2, ICON);
    const font = ICON * 0.8;
    drawTextAt(ctx, box, label, font, x, color, deps.theme.fontFamily);
  },
  assert: (_box, props) => {
    const label = stringProp(props, 'label', '0');
    return label.length > 10 ? [`金币数值 '${label}' 有 ${label.length} 字，徽章会撑出容器`] : [];
  },
});

/** 状态文字：一行说明 / 倒计时 / 收益，居中。 */
export const statusText: DefinedComponent = defineComponent('statusText', {
  props: { label: 'string', tone: 'ink|light' },
  defaultSize: { h: 24 },
  measure: (_env, _box, props) => {
    const label = stringProp(props, 'label');
    return { w: Math.ceil(estimateTextWidth(label, 24 * 0.36)), h: 24 };
  },
  draw: (ctx, box, props, deps) => {
    const color = stringProp(props, 'tone', 'ink') === 'light' ? deps.theme.light : deps.theme.ink;
    drawCenteredText(ctx, box, stringProp(props, 'label'), color, deps.theme.fontFamily);
  },
  assert: (_box, props) => {
    const issues: string[] = [];
    const label = stringProp(props, 'label');
    if (label.length === 0) issues.push('statusText 需要 label（否则这一行什么都不显示）');
    if (label.length > 24) issues.push(`label 有 ${label.length} 字，一行放不下 24 字以上，建议拆成多行`);
    return issues;
  },
});

/** 暂停按钮：正方形，两条竖杠（素材缺失也不影响可读性）。 */
export const pause: DefinedComponent = defineComponent('pause', {
  props: { tone: 'ink|light' },
  defaultSize: { w: PAUSE_SIZE, h: PAUSE_SIZE },
  measure: () => ({ w: PAUSE_SIZE, h: PAUSE_SIZE }),
  draw: (ctx, box, props, deps) => {
    const color = stringProp(props, 'tone', 'ink') === 'light' ? deps.theme.light : deps.theme.ink;
    const barW = Math.max(2, box.w * 0.12);
    const barH = box.h * 0.44;
    const gap = box.w * 0.16;
    const top = box.y + (box.h - barH) / 2;
    fillRect(ctx, { x: box.x + box.w / 2 - gap / 2 - barW, y: top, w: barW, h: barH }, color);
    fillRect(ctx, { x: box.x + box.w / 2 + gap / 2, y: top, w: barW, h: barH }, color);
  },
  assert: (box) => {
    const ratio = box.w / Math.max(1, box.h);
    return ratio < 0.75 || ratio > 1.33
      ? [`pause 建议正方形（当前 ${box.w}×${box.h}），两条竖杠会拉歪`]
      : [];
  },
});
