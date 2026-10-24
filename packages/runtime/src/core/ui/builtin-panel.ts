/**
 * 内置组件（二）：车厢网格 / 信息面板 / 包裹卡片。
 *
 * `parcelGrid` 是这个文件里最关键的一个：它承接了《快递装车员》里那段
 * 「格子尺寸是宽度驱动」的真实逻辑 —— `cell = min(W*0.84/cols, H*0.32/rows)`。
 * 这段逻辑不能写进 `.ui`（百分比表达不了 min），只能归组件。
 */

import type { ComponentDef, DefinedComponent, UiData } from './components';
import { boolProp, defineComponent, estimateTextWidth, stringProp } from './components';
import { drawNineSlice } from './nine-slice';
import { drawCenteredText, fillRect } from './builtin-draw';
import type { StyleProps } from './layout-spec';

/** 网格占视口宽 / 高的比例（与游戏 `computeLayout` 一致）。 */
const GRID_OF_W = 0.84;
const GRID_OF_H = 0.32;
/** 默认网格（第一关 3×2）。 */
const DEFAULT_COLS = 3;
const DEFAULT_ROWS = 2;
/** 单格显示尺寸占格距的比例（留出格子之间的缝）。 */
const CELL_INSET = 0.96;
/** 格子太小就看不见包裹编号了。 */
const MIN_CELL = 12;
/** 九宫格源边距（2x 源像素，与游戏 render.ts 的 PANEL_BORDER / CARD_BORDER 一致）。 */
const PANEL_BORDER = 60;
const CARD_BORDER = 40;

/** 从 props / 数据快照读一个整数（props 优先，其次游戏数据，最后默认值）。 */
const intOf = (props: StyleProps, data: UiData | undefined, key: 'cols' | 'rows', fallback: number): number => {
  const fromProps = props[key];
  if (typeof fromProps === 'number' && Number.isFinite(fromProps)) return Math.round(fromProps);
  const fromData = data?.[key];
  if (typeof fromData === 'number' && Number.isFinite(fromData)) return Math.round(fromData);
  return fallback;
};

/**
 * 车厢网格。
 *
 * measure 实现游戏里的真实公式：`cell = min(W*0.84/cols, H*0.32/rows)`，
 * 返回 `{ w: cell*cols, h: cell*rows }`。`W/H` 是**视口**（不是父容器）——
 * 这就是「布局语言只管占位、内容尺寸归组件」的典型例子。
 */
export const parcelGrid: DefinedComponent = defineComponent('parcelGrid', {
  props: { cols: 'number', rows: 'number' },
  measure: (env, _box, props) => {
    const cols = Math.max(1, intOf(props, env.data, 'cols', DEFAULT_COLS));
    const rows = Math.max(1, intOf(props, env.data, 'rows', DEFAULT_ROWS));
    const cell = Math.min((env.viewport.width * GRID_OF_W) / cols, (env.viewport.height * GRID_OF_H) / rows);
    return { w: cell * cols, h: cell * rows };
  },
  draw: (ctx, box, props, deps) => {
    const cols = Math.max(1, intOf(props, deps.data, 'cols', DEFAULT_COLS));
    const rows = Math.max(1, intOf(props, deps.data, 'rows', DEFAULT_ROWS));
    const cellW = box.w / cols;
    const cellH = box.h / rows;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        fillRect(
          ctx,
          { x: box.x + x * cellW, y: box.y + y * cellH, w: cellW * CELL_INSET, h: cellH * CELL_INSET },
          deps.theme.gridLine,
        );
      }
    }
  },
  assert: (box, props) => {
    const issues: string[] = [];
    for (const key of ['cols', 'rows'] as const) {
      const raw = props[key];
      if (raw === undefined) continue;
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 12) {
        issues.push(`${key} 必须是 1..12 的整数，收到 '${String(raw)}'`);
      }
    }
    const cols = Math.max(1, intOf(props, undefined, 'cols', DEFAULT_COLS));
    const rows = Math.max(1, intOf(props, undefined, 'rows', DEFAULT_ROWS));
    const cell = Math.min(box.w / cols, box.h / rows);
    if (cell < MIN_CELL) {
      issues.push(`格子边长 ${cell.toFixed(1)}px < ${MIN_CELL}px，包裹编号会看不清（考虑减少 ${cols}×${rows} 或放大网格）`);
    }
    return issues;
  },
});

/** 信息面板：九宫格底 + 可选标题。 */
export const infoPanel: DefinedComponent = defineComponent('infoPanel', {
  props: { label: 'string' },
  defaultSize: { w: 351, h: 110 },
  // 0.9 视口宽 × 0.13 视口高（与旧布局的 info 带一致）
  measure: (env) => ({ w: env.viewport.width * 0.9, h: env.viewport.height * 0.13 }),
  draw: (ctx, box, props, deps) => {
    const img = deps.assets.get('panel/panel-info');
    const painted = img !== null
      && drawNineSlice(ctx, img, img.sx, img.sy, img.sw, img.sh, box.x, box.y, box.w, box.h, PANEL_BORDER);
    if (!painted) fillRect(ctx, box, deps.theme.panel);
    drawCenteredText(ctx, box, stringProp(props, 'label'), deps.theme.light, deps.theme.fontFamily);
  },
  assert: (box) => {
    const issues: string[] = [];
    if (box.w < PANEL_BORDER * 2) issues.push(`面板宽 ${box.w}px < 2×源边距 ${PANEL_BORDER * 2}px，九宫格四角会挤压变形`);
    if (box.h < PANEL_BORDER) issues.push(`面板高 ${box.h}px < 源边距 ${PANEL_BORDER}px，上下边会被压扁`);
    return issues;
  },
});

/**
 * 包裹卡片：九宫格底 + 编号。
 *
 * `card0` / `card1` 共用同一套定义，只有默认编号不同 —— 名字对应 `.ui` 里
 * `put card0` / `put card1`（第一关两个包裹）。
 */
const makeCard = (index: number): ComponentDef => ({
  props: { label: 'string', selected: 'boolean' },
  defaultSize: { w: 168, h: 68 },
  // 0.43 视口宽 × 0.08 视口高（旧布局的卡片带比例）
  measure: (env) => ({ w: env.viewport.width * 0.43, h: env.viewport.height * 0.08 }),
  draw: (ctx, box, props, deps) => {
    const selected = boolProp(props, 'selected');
    const img = deps.assets.get(selected ? 'card/card-parcel_selected' : 'card/card-parcel_normal');
    const painted = img !== null
      && drawNineSlice(ctx, img, img.sx, img.sy, img.sw, img.sh, box.x, box.y, box.w, box.h, CARD_BORDER);
    if (!painted) fillRect(ctx, box, deps.theme.panel);
    drawCenteredText(ctx, box, stringProp(props, 'label', String(index + 1)), deps.theme.light, deps.theme.fontFamily);
  },
  assert: (box, props) => {
    const issues: string[] = [];
    if (box.h < CARD_BORDER) issues.push(`卡片高 ${box.h}px < 源边距 ${CARD_BORDER}px，九宫格边会被压扁`);
    const label = stringProp(props, 'label', String(index + 1));
    const font = Math.min(box.h * 0.36, box.w / Math.max(1, label.length));
    if (estimateTextWidth(label, font) > box.w * 0.96) issues.push(`卡片文字 '${label}' 放不下（估算宽 ${estimateTextWidth(label, font).toFixed(1)}px > ${(box.w * 0.96).toFixed(1)}px）`);
    return issues;
  },
});

export const card0: DefinedComponent = defineComponent('card0', makeCard(0));
export const card1: DefinedComponent = defineComponent('card1', makeCard(1));
