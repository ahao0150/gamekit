/**
 * 通用组件：轻提示（toast）。
 *
 * 位置**不归组件管**：toast 出现在屏幕哪里由 `.ui` 的 overlay region + `align/justify center`
 * 决定（布局语言的事），组件只负责「这块长什么样」。
 *
 * 淡入淡出由游戏用 tween 改 `opacity`，组件每帧照画当前值——组件里不做动画，
 * 这样动画时长 / 曲线归游戏，组件保持纯绘制（AGENTS 铁律 4）。
 */

import type { DefinedComponent } from '../components';
import { defineComponent, estimateTextWidth, numberProp, stringProp } from '../components';
import type { StyleProps } from '../layout-spec';
import { drawIcon } from '../builtin-draw';
import { fillRoundRect } from './draw-utils';

/** 固定高度（toast 是一行短提示，高度不随内容变）。 */
const HEIGHT = 44;
/** 左右内边距。 */
const PADDING_X = 16;
/** 图标边长与图标/文字间距。 */
const ICON_SIZE = 24;
const ICON_GAP = 8;
const DEFAULT_FONT = 16;
const DEFAULT_RADIUS = 8;

const fontSizeOf = (props: StyleProps): number => Math.max(1, numberProp(props, 'textSize', DEFAULT_FONT));
const iconKeyOf = (props: StyleProps): string => stringProp(props, 'icon', '');

/**
 * 内容宽：文字估算宽 + 左右 padding +（有 icon 时）图标宽 + 间距。
 *
 * 注意 `icon` 只按「写了 key」加宽，**不查 assets**：measure 是纯函数（布局期拿不到资源，
 * 也不该依赖资源加载时序）。素材真缺失时 draw 会画占位方块，宽度口径保持一致。
 */
const contentWidth = (props: StyleProps): number => {
  const textW = estimateTextWidth(stringProp(props, 'text', ''), fontSizeOf(props));
  const iconW = iconKeyOf(props).length > 0 ? ICON_SIZE + ICON_GAP : 0;
  return Math.ceil(PADDING_X * 2 + textW + iconW);
};

export const toast: DefinedComponent = defineComponent('toast', {
  props: {
    text: 'string',
    textSize: 'number',
    icon: 'string',
    opacity: 'number',
    bgColor: 'string',
    textColor: 'string',
    radius: 'number',
  },
  defaultSize: { w: 200, h: HEIGHT },
  measure: (_env, _box, props) => ({ w: Math.max(1, contentWidth(props)), h: HEIGHT }),
  draw: (ctx, box, props, deps) => {
    if (!(box.w > 0) || !(box.h > 0)) return;
    const opacity = Math.max(0, Math.min(1, numberProp(props, 'opacity', 1)));
    if (!(opacity > 0)) return; // 完全透明：不画（tween 到 0 时不该留下任何东西）
    ctx.save();
    ctx.globalAlpha = opacity;
    fillRoundRect(ctx, box, Math.max(0, numberProp(props, 'radius', DEFAULT_RADIUS)), stringProp(props, 'bgColor', deps.theme.ink));

    const font = fontSizeOf(props);
    let textX = box.x + PADDING_X;
    let textW = box.w - PADDING_X * 2;
    if (iconKeyOf(props).length > 0) {
      const img = deps.assets.get(iconKeyOf(props));
      const iconY = box.y + (box.h - ICON_SIZE) / 2;
      if (img !== null && img.width > 0 && img.height > 0) {
        drawIcon(ctx, img, box.x + PADDING_X, iconY, ICON_SIZE);
      } else {
        // 素材缺失：占位方块，保持「左图标右文字」的布局不塌
        ctx.fillStyle = deps.theme.gridLine;
        ctx.fillRect(box.x + PADDING_X, iconY, ICON_SIZE, ICON_SIZE);
      }
      textX += ICON_SIZE + ICON_GAP;
      textW -= ICON_SIZE + ICON_GAP;
    }

    const text = stringProp(props, 'text', '');
    if (text.length > 0 && textW > 0) {
      ctx.fillStyle = stringProp(props, 'textColor', deps.theme.light);
      ctx.font = `${font}px ${deps.theme.fontFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, textX, box.y + box.h / 2, textW);
    }
    ctx.restore();
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const font = numberProp(props, 'textSize', DEFAULT_FONT);
    if (!(font > 0)) issues.push(`textSize 必须大于 0，收到 ${font}`);
    const opacity = numberProp(props, 'opacity', 1);
    if (opacity < 0 || opacity > 1) issues.push(`opacity ${opacity} 超出 0..1，绘制时会被钳制`);
    if (stringProp(props, 'text', '').length === 0 && iconKeyOf(props).length === 0) {
      issues.push('text 和 icon 都为空，toast 会是一个空框');
    }
    if (box.h < font) issues.push(`toast 高 ${box.h}px < 字号 ${font}px，文字会被裁切`);
    if (box.w < PADDING_X * 2) issues.push(`toast 宽 ${box.w}px 小于左右内边距之和 ${PADDING_X * 2}px`);
    return issues;
  },
});
