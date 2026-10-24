/**
 * 通用组件：图标（等比缩放到 box 内居中）。
 *
 * 素材缺失时画一个主题色占位方块——「回落不崩」且仍然证明「这里有东西」。
 */

import type { DefinedComponent } from '../components';
import { defineComponent, numberProp, stringProp } from '../components';

const DEFAULT_SIZE = 32;

export const icon: DefinedComponent = defineComponent('icon', {
  props: { image: 'string', size: 'number' },
  defaultSize: { w: DEFAULT_SIZE, h: DEFAULT_SIZE },
  measure: (_env, _box, props) => {
    const size = Math.max(1, numberProp(props, 'size', DEFAULT_SIZE));
    return { w: size, h: size };
  },
  draw: (ctx, box, props, deps) => {
    const img = deps.assets.get(stringProp(props, 'image', 'ui/icon'));
    if (img === null || img.width <= 0 || img.height <= 0) {
      // 占位：取 box 内居中的正方形（不是铺满，保持「图标」的语义）
      const side = Math.min(box.w, box.h);
      ctx.fillStyle = deps.theme.gridLine;
      ctx.fillRect(box.x + (box.w - side) / 2, box.y + (box.h - side) / 2, side, side);
      return;
    }
    // 等比缩放并居中（contain，不拉伸）
    const scale = Math.min(box.w / img.width, box.h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = box.x + (box.w - dw) / 2;
    const dy = box.y + (box.h - dh) / 2;
    ctx.drawImage(img.native as CanvasImageSource, img.sx, img.sy, img.sw, img.sh, dx, dy, dw, dh);
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const size = numberProp(props, 'size', DEFAULT_SIZE);
    if (!(size > 0)) issues.push(`size 必须大于 0，收到 ${size}`);
    if (box.w <= 0 || box.h <= 0) issues.push(`icon 尺寸非法：${box.w}×${box.h}`);
    return issues;
  },
});
