/**
 * 通用组件：九宫格面板。
 *
 * 切片逻辑**复用** `core/ui/nine-slice.ts`（不自己写切片）：四角固定、四边单向拉伸、
 * 中心双向拉伸。素材缺失 / 尺寸放不下切片时回落主题面板色，不白屏。
 */

import type { DefinedComponent } from '../components';
import { defineComponent, numberProp, stringProp } from '../components';
import { drawNineSlice } from '../nine-slice';
import { fillRect } from '../builtin-draw';

/** 默认九宫格边距（源像素，2x 图上量；与 kuaidi 面板同一口径）。 */
const DEFAULT_SLICE = 60;

export const panel: DefinedComponent = defineComponent('panel', {
  props: { image: 'string', slice: 'number', fillColor: 'string' },
  defaultSize: { w: 320, h: 200 },
  measure: () => ({ w: 320, h: 200 }),
  draw: (ctx, box, props, deps) => {
    const slice = Math.max(1, numberProp(props, 'slice', DEFAULT_SLICE));
    const img = deps.assets.get(stringProp(props, 'image', 'ui/panel'));
    const painted =
      img !== null && drawNineSlice(ctx, img, img.sx, img.sy, img.sw, img.sh, box.x, box.y, box.w, box.h, slice);
    if (!painted) fillRect(ctx, box, stringProp(props, 'fillColor', deps.theme.panel));
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const slice = Math.max(1, numberProp(props, 'slice', DEFAULT_SLICE));
    if (box.w < slice * 2) issues.push(`面板宽 ${box.w}px < 2×slice ${slice * 2}px，九宫格四角会挤压变形`);
    if (box.h < slice) issues.push(`面板高 ${box.h}px < slice ${slice}px，上下边会被压扁`);
    return issues;
  },
});
