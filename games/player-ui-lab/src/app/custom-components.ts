/**
 * 设计稿的 9 个顶层组件（`put` 名 = SVG 的 `data-name`，一对一）。
 *
 * 两条纪律：
 * 1. **几何只来自 `parts.ts`**：draw 里不出现任何坐标算术，全部 `xxxPartsOf(box)`。
 *    设计稿的内部件（进度轨道、时间行、三键）因此和单元测试共用同一份算式。
 * 2. **颜色只来自 `theme`**：本文件没有十六进制色值，换主题只动 `theme.ts`。
 *
 * 绘制件在 `component-paint.ts`（同目录），这里只做声明，便于对照设计稿逐个核对。
 */

import { defineComponent } from './deps';
import type { Ctx2D, DefinedComponent, DrawDeps, Rect, StyleProps } from './deps';
import {
  drawAlbumCover, drawIconButton, drawPlayButton, drawProgressBar, readString,
} from './component-paint';
import { controlsRowPartsOf, PRIMARY_CONTROLS, SECONDARY_CONTROLS, TIME_W, TRACK_GAP } from './parts';
import { drawText } from './paint';
import { playerTheme } from './theme';

const fixedSize = (w: number, h: number) => ({ defaultSize: { w, h }, measure: () => ({ w, h }) });

/** 顶部返回键（44×44 玻璃圆键，图标 = 左箭头）。 */
export const backBtn = defineComponent('backBtn', {
  ...fixedSize(44, 44),
  draw: (ctx: Ctx2D, box: Rect, _props: StyleProps, deps: DrawDeps) => drawIconButton(ctx, box, 'back', deps),
});

/** 顶部更多键（44×44 玻璃圆键，图标 = 三点）。 */
export const moreBtn = defineComponent('moreBtn', {
  ...fixedSize(44, 44),
  draw: (ctx: Ctx2D, box: Rect, _props: StyleProps, deps: DrawDeps) => drawIconButton(ctx, box, 'more', deps),
});

/** 顶部标题（12px、字距 1.2、居中、次级文字色）。 */
export const headerTitle = defineComponent('headerTitle', {
  props: { text: 'string' },
  ...fixedSize(230, 20),
  draw: (ctx: Ctx2D, box: Rect, props: StyleProps, deps: DrawDeps) => {
    const theme = playerTheme(deps.theme);
    drawText(ctx, box, readString(props, 'text', '正在播放 · NOW PLAYING'), {
      size: 12, color: theme.gridLine, align: 'center', letterSpacing: 1.2, fontFamily: theme.fontFamily,
    });
  },
});

/** 封面（318×318，全部渐变绘制，零素材）。 */
export const albumCover = defineComponent('albumCover', {
  ...fixedSize(318, 318),
  draw: (ctx: Ctx2D, box: Rect, _props: StyleProps, deps: DrawDeps) => drawAlbumCover(ctx, box, deps),
});

/** 曲名（28px 主文字色）。 */
export const songTitle = defineComponent('songTitle', {
  props: { text: 'string' },
  ...fixedSize(318, 40),
  draw: (ctx: Ctx2D, box: Rect, props: StyleProps, deps: DrawDeps) => {
    const theme = playerTheme(deps.theme);
    drawText(ctx, box, readString(props, 'text', '晚风告白'), {
      size: 28, color: theme.light, align: 'left', letterSpacing: 0.5, fontFamily: theme.fontFamily,
    });
  },
});

/** 歌手（14px 次级文字色）。 */
export const artistName = defineComponent('artistName', {
  props: { text: 'string' },
  ...fixedSize(318, 20),
  draw: (ctx: Ctx2D, box: Rect, props: StyleProps, deps: DrawDeps) => {
    const theme = playerTheme(deps.theme);
    drawText(ctx, box, readString(props, 'text', '林晚 · 专辑《归途》'), {
      size: 14, color: theme.gridLine, align: 'left', fontFamily: theme.fontFamily,
    });
  },
});

/** 进度条（44 = 18 轨道 + 8 间距 + 18 时间行）。 */
export const progressBar = defineComponent('progressBar', {
  props: { progress: 'number' },
  ...fixedSize(318, 44),
  draw: (ctx: Ctx2D, box: Rect, props: StyleProps, deps: DrawDeps) => drawProgressBar(ctx, box, props, deps),
});

/** 主控三键（52 / 84 / 52，间距 32，居中）。 */
export const primaryControls = defineComponent('primaryControls', {
  ...fixedSize(334, 84),
  draw: (ctx: Ctx2D, box: Rect, _props: StyleProps, deps: DrawDeps) => {
    const [prev, play, next] = controlsRowPartsOf(box, PRIMARY_CONTROLS);
    if (prev === undefined || play === undefined || next === undefined) return;
    drawIconButton(ctx, prev, 'prev', deps);
    drawPlayButton(ctx, play, deps);
    drawIconButton(ctx, next, 'next', deps);
  },
});

/** 次级三键（44 × 3，两端分开：循环 / 喜欢 / 列表）。 */
export const secondaryRow = defineComponent('secondaryRow', {
  ...fixedSize(334, 44),
  draw: (ctx: Ctx2D, box: Rect, _props: StyleProps, deps: DrawDeps) => {
    const [repeat, like, list] = controlsRowPartsOf(box, SECONDARY_CONTROLS);
    if (repeat === undefined || like === undefined || list === undefined) return;
    drawIconButton(ctx, repeat, 'repeat', deps);
    drawIconButton(ctx, like, 'like', deps);
    drawIconButton(ctx, list, 'list', deps);
  },
});

/** 组件清单：注册表按这个顺序注册（顺序只影响「未知组件」报错的名单顺序）。 */
export const PLAYER_COMPONENTS: readonly DefinedComponent[] = [
  backBtn, headerTitle, moreBtn, albumCover, songTitle, artistName, progressBar, primaryControls, secondaryRow,
];

export { TIME_W, TRACK_GAP };
