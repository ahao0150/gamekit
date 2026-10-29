/**
 * 设计稿（`experiments/svg-first/design/player-390.svg`）的 token → `ComponentTheme` 映射。
 *
 * 为什么多出 4 个字段：引擎的 `ComponentTheme` 只有 7 个色位（ink / light / primary /
 * secondary / panel / gridLine / disabled），设计稿还用到方章红与「已喜欢」暖红，外加
 * 背景末段色与最低层文字色。这 4 个在 `PlayerTheme` 上扩展，组件通过 `playerTheme()`
 * 收窄取用 —— **组件里不出现任何十六进制色值**，换主题只改这一个文件。
 */

import type { ComponentTheme } from './deps';

export interface PlayerTheme extends ComponentTheme {
  /** 方章底色（设计稿 `--color-seal`）。 */
  readonly seal: string;
  /** 「已喜欢」的暖红（设计稿 `--color-danger`）。 */
  readonly danger: string;
  /** 背景渐变末端 / 封面渐变末端（设计稿 `--color-bg-soft`）。 */
  readonly bgSoft: string;
  /** 进度渐变起点（设计稿 `--color-accent` 的 jade 原色，比 `primary` 深一档）。 */
  readonly jade: string;
  /** 封面渐变首色（设计稿 `coverGrad` 的提亮端）。 */
  readonly coverHi: string;
  /** 封面渐变中段（设计稿 `coverGrad` 的中间停靠点）。 */
  readonly coverMid: string;
}

/** 设计稿 token 表（SPEC.md ②）按语义落到 8 色位 + 4 个扩展位。 */
export const PLAYER_THEME: PlayerTheme = {
  fontFamily: '"Microsoft YaHei", "Noto Sans SC", "PingFang SC", sans-serif',
  ink: '#16261f',       // --color-bg-deep：整屏底、顶部压暗、播放三角
  light: '#fffaf0',     // --color-text：曲名、主图标、播放键中心
  primary: '#4a8570',   // --color-accent 亮端：进度已播、声波
  secondary: '#b4935d', // --color-accent-hi / gold：进度头、播放键外环、循环箭头
  panel: '#233e36',     // --color-bg：背景渐变中段
  gridLine: '#d6c9ae',  // --color-text-2 / line：歌手、时间、次级图标
  disabled: '#7c8071',  // --color-text-3 / muted：总时长
  seal: '#a64e36',      // --color-seal
  danger: '#c9704f',    // --color-danger
  bgSoft: '#1b2f28',    // --color-bg-soft
  jade: '#315e4d',      // --color-accent 起点
  coverHi: '#63a48c',   // coverGrad 首色
  coverMid: '#356a57',  // coverGrad 中段
};

/**
 * `DrawDeps.theme` 的类型是 `ComponentTheme`，扩展位在这里补回。
 * 拿不到扩展位的调用方（别的游戏的主题）会回落到引擎自带语义位，不会崩。
 */
export const playerTheme = (theme: ComponentTheme): PlayerTheme => {
  const extra = theme as Partial<PlayerTheme>;
  return {
    ...theme,
    seal: extra.seal ?? theme.primary,
    danger: extra.danger ?? theme.secondary,
    bgSoft: extra.bgSoft ?? theme.panel,
    jade: extra.jade ?? theme.primary,
    coverHi: extra.coverHi ?? theme.primary,
    coverMid: extra.coverMid ?? theme.panel,
  };
};
