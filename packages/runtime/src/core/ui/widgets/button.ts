/**
 * 通用组件：三态按钮（normal / pressed / disabled）。
 *
 * 三态视觉**同时生效**（用户明确要求）：
 * - 贴图切换：`image` → `pressedImage` / `disabledImage`；
 * - 按下缩放：`pressedScale`（默认 0.96，围绕按钮中心）；
 * - 按下位移：`pressedOffsetY`（默认 2px）；
 * - 禁用透明度：`disabledOpacity`（默认 0.45）。
 * 贴图缺失时一律回落主题色（缺图不能白屏），文字照画。
 */

import type { DefinedComponent } from '../components';
import { defineComponent, numberProp, stringProp } from '../components';

/** 默认尺寸：用户指定 296×56（比内置业务件的胶囊按钮略大，通用件按 44px 触摸下限留余量）。 */
const DEFAULT_W = 296;
const DEFAULT_H = 56;

const colorOfState = (state: string, theme: { primary: string; disabled: string }): string =>
  state === 'disabled' ? theme.disabled : theme.primary;

export const button: DefinedComponent = defineComponent('button', {
  props: {
    state: 'normal|pressed|disabled',
    text: 'string',
    textSize: 'number',
    image: 'string',
    pressedImage: 'string',
    disabledImage: 'string',
    pressedScale: 'number',
    pressedOffsetY: 'number',
    disabledOpacity: 'number',
  },
  defaultSize: { w: DEFAULT_W, h: DEFAULT_H },
  measure: () => ({ w: DEFAULT_W, h: DEFAULT_H }),
  draw: (ctx, box, props, deps) => {
    const state = stringProp(props, 'state', 'normal');
    const pressed = state === 'pressed';
    const disabled = state === 'disabled';
    const scale = pressed ? Math.max(0, numberProp(props, 'pressedScale', 0.96)) : 1;
    const offsetY = pressed ? numberProp(props, 'pressedOffsetY', 2) : 0;
    const opacity = disabled ? Math.max(0, Math.min(1, numberProp(props, 'disabledOpacity', 0.45))) : 1;

    ctx.save();
    if (opacity !== 1) ctx.globalAlpha = opacity;
    if (scale !== 1) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
    }

    const target = { x: box.x, y: box.y + offsetY, w: box.w, h: box.h };
    const imageKey = disabled
      ? stringProp(props, 'disabledImage', stringProp(props, 'image', 'ui/button_disabled'))
      : pressed
        ? stringProp(props, 'pressedImage', stringProp(props, 'image', 'ui/button_pressed'))
        : stringProp(props, 'image', 'ui/button_normal');
    const img = deps.assets.get(imageKey);
    if (img !== null) {
      ctx.drawImage(img.native as CanvasImageSource, img.sx, img.sy, img.sw, img.sh, target.x, target.y, target.w, target.h);
    } else {
      ctx.fillStyle = colorOfState(state, deps.theme);
      ctx.fillRect(target.x, target.y, target.w, target.h);
    }

    const text = stringProp(props, 'text');
    if (text.length > 0) {
      const size = Math.max(8, Math.round(numberProp(props, 'textSize', Math.min(target.h * 0.36, 24))));
      ctx.fillStyle = deps.theme.light;
      ctx.font = `${size}px ${deps.theme.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, target.x + target.w / 2, target.y + target.h / 2, target.w * 0.92);
    }
    ctx.restore();
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const text = stringProp(props, 'text');
    if (text.length > 12) issues.push(`text '${text}' 有 ${text.length} 字，超过 12 字按钮会挤成一条`);
    if (box.w <= 0 || box.h <= 0) issues.push(`按钮尺寸非法：${box.w}×${box.h}`);
    const state = stringProp(props, 'state', 'normal');
    if (!['normal', 'pressed', 'disabled'].includes(state)) issues.push(`state 只能是 normal / pressed / disabled，收到 '${state}'`);
    return issues;
  },
});
