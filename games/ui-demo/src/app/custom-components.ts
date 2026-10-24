/**
 * demo 自定义组件：证明 `defineComponent` 的注册流程是通的。
 *
 * 它们和内置组件走**同一套契约**（T7 的 `ComponentDef`）：
 * - `measure` 纯函数，不碰 canvas；
 * - `draw` 只读 props / deps，只画；
 * - `assert` 返回中文问题列表。
 *
 * 这里刻意用纯色块 + 文字（不引入任何美术）：T10 验证的是工具链，不是画面。
 */

import type { DefinedComponent } from '../../../../packages/runtime/src/core/ui/components';
import { defineComponent, stringProp } from '../../../../packages/runtime/src/core/ui/components';
import { drawCenteredText, fillRect } from '../../../../packages/runtime/src/core/ui/builtin-draw';

/** 可点目标：深墨外框 + 主色内块 + 命中数。点它 3 次进结算。 */
export const tapTarget: DefinedComponent = defineComponent('tapTarget', {
  props: { label: 'string' },
  defaultSize: { w: 180, h: 180 },
  measure: () => ({ w: 180, h: 180 }),
  draw: (ctx, box, props, deps) => {
    const inset = Math.min(box.w, box.h) * 0.08;
    fillRect(ctx, box, deps.theme.ink);
    fillRect(
      ctx,
      { x: box.x + inset, y: box.y + inset, w: box.w - inset * 2, h: box.h - inset * 2 },
      deps.theme.primary,
    );
    drawCenteredText(ctx, box, stringProp(props, 'label'), deps.theme.light, deps.theme.fontFamily);
  },
  assert: (box) => {
    const side = Math.min(box.w, box.h);
    return side < 96 ? [`tapTarget 边长 ${side.toFixed(1)}px < 96px，手指点不准`] : [];
  },
});

/** 结算计分面板：面板底 + 两行文字（成绩 / 评级）。 */export const scorePanel: DefinedComponent = defineComponent('scorePanel', {
  props: { label: 'string', grade: 'string' },
  defaultSize: { w: 320, h: 240 },
  // 没在 .ui 里指定尺寸时按视口比例兜底（MeasureEnv 的用处）
  measure: (env) => ({ w: env.viewport.width * 0.88, h: env.viewport.height * 0.28 }),
  draw: (ctx, box, props, deps) => {
    fillRect(ctx, box, deps.theme.panel);
    const lineH = box.h / 3;
    drawCenteredText(
      ctx,
      { x: box.x, y: box.y + lineH, w: box.w, h: lineH },
      stringProp(props, 'label'),
      deps.theme.light,
      deps.theme.fontFamily,
    );
    drawCenteredText(
      ctx,
      { x: box.x, y: box.y + lineH * 2, w: box.w, h: lineH },
      stringProp(props, 'grade'),
      deps.theme.light,
      deps.theme.fontFamily,
    );
  },
  assert: (box, props) => {
    const issues: string[] = [];
    if (box.h < 120) issues.push(`计分面板高 ${box.h.toFixed(1)}px < 120px，两行文字会挤在一起`);
    if (stringProp(props, 'label').length > 12) issues.push('计分面板 label 超过 12 字，会溢出面板');
    return issues;
  },
});
