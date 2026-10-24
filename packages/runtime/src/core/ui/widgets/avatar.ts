/**
 * 通用组件：头像（圆形真裁切 / 圆角矩形裁切）。
 *
 * 圆形必须**真裁切**：`save → beginPath/arc → clip → drawImage/fill → restore`。
 * 只画一个圆底色不算裁切——图片会露在圆外（这是头像组件最常见的假实现）。
 */

import type { DefinedComponent } from '../components';
import { defineComponent, numberProp, stringProp } from '../components';
import { roundPath } from './draw-utils';

const DEFAULT_SIDE = 64;
const DEFAULT_RADIUS = 12;

export const avatar: DefinedComponent = defineComponent('avatar', {
  props: { image: 'string', shape: 'circle|rounded', radius: 'number' },
  defaultSize: { w: DEFAULT_SIDE, h: DEFAULT_SIDE },
  measure: () => ({ w: DEFAULT_SIDE, h: DEFAULT_SIDE }),
  draw: (ctx, box, props, deps) => {
    const shape = stringProp(props, 'shape', 'circle');
    const radius = Math.max(0, numberProp(props, 'radius', DEFAULT_RADIUS));

    ctx.save();
    if (shape === 'circle') {
      const r = Math.min(box.w, box.h) / 2;
      ctx.beginPath();
      ctx.arc(box.x + box.w / 2, box.y + box.h / 2, r, 0, Math.PI * 2);
      ctx.closePath();
    } else {
      roundPath(ctx, box, radius);
    }
    ctx.clip();

    const img = deps.assets.get(stringProp(props, 'image', 'ui/avatar'));
    if (img !== null) {
      ctx.drawImage(img.native as CanvasImageSource, img.sx, img.sy, img.sw, img.sh, box.x, box.y, box.w, box.h);
    } else {
      ctx.fillStyle = deps.theme.panel;
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    ctx.restore();
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const radius = numberProp(props, 'radius', DEFAULT_RADIUS);
    if (radius < 0) issues.push(`radius 不能为负，收到 ${radius}`);
    if (box.w < 16 || box.h < 16) issues.push(`头像 ${box.w}×${box.h}px 太小（小于 16px 看不清）`);
    return issues;
  },
});
