/**
 * 组件总览（gallery）的数据：21 个通用组件各一条，每条给「能看出形态」的最小参数。
 *
 * 为什么数据放这里、绘制放 `render.ts`：AGENTS 铁律「数据/逻辑/渲染三分」——
 * 这个文件只有字面量，一个函数都没有；怎么画由渲染层按 `ComponentDef.draw` 调。
 *
 * 每条自带 `size`：组件默认尺寸差得远（进度条 180×12、键盘 296×174），
 * 直接塞进同一行会被拉变形。`size` 是「组件按自己的设计尺寸画」的声明，
 * 渲染层只负责把它居中放进行内可用区域。
 *
 * 数据驱动型组件（tabs / segmented / keypad / carousel / list）从 `DrawDeps.data`
 * 取内容，装不进 `StyleProps`（只能是 string/number/boolean），所以每条可以带
 * 私有 `data`：渲染层绘制这一项时会用 `entry.data` **整体替换** data 快照。
 * 这同时也是隔离手段 —— 行内的 `list` 绝不能读到 gallery 自己的 19 项（会无限递归）。
 */

import type { StyleProps, UiData } from './deps';

/** 一条总览项。 */
export interface GalleryEntry {
  /** 注册表里的组件名（必须已注册） */
  readonly name: string;
  /** 绘制参数（`StyleProps`：string / number / boolean） */
  readonly props: StyleProps;
  /** 组件私有数据（`tabs` 的标签、`keypad` 的键值等）；不带就用渲染层的 data */
  readonly data?: UiData;
  /** 组件按自己的设计尺寸画，渲染层负责居中 */
  readonly size: { readonly w: number; readonly h: number };
}

/**
 * 21 个通用组件，按「静态控件 → 输入控件 → 容器类」排。
 *
 * 全部走纯色回落（demo 不引美术）：`panel` / `icon` / `avatar` 缺素材时各自回落
 * 主题色块，正好能看出「有东西被画出来」。
 */
export const GALLERY_ENTRIES: readonly GalleryEntry[] = [
  // ---- 静态 / 展示类 ----
  { name: 'progress', props: { value: 65, max: 100, radius: 7 }, size: { w: 200, h: 14 } },
  { name: 'button', props: { text: '按钮', state: 'normal' }, size: { w: 160, h: 44 } },
  { name: 'panel', props: { fillColor: '#2b4a52' }, size: { w: 160, h: 60 } },
  { name: 'label', props: { text: '标签文本', fontSize: 16, align: 'center' }, size: { w: 150, h: 26 } },
  { name: 'icon', props: { size: 36 }, size: { w: 40, h: 40 } },
  { name: 'badge', props: { text: '9' }, size: { w: 32, h: 32 } },
  { name: 'divider', props: { direction: 'horizontal', thickness: 2 }, size: { w: 180, h: 2 } },
  { name: 'avatar', props: { shape: 'circle' }, size: { w: 48, h: 48 } },
  { name: 'toast', props: { text: '保存成功', textSize: 13 }, size: { w: 170, h: 36 } },
  { name: 'scrollbar', props: { value: 0.4, viewport: 0.6, thickness: 8, radius: 4 }, size: { w: 8, h: 64 } },

  // ---- 输入 / 状态类 ----
  { name: 'slider', props: { value: 0.6, knobSize: 18 }, size: { w: 190, h: 24 } },
  { name: 'switch', props: { on: true, width: 56, height: 32 }, size: { w: 56, h: 32 } },
  { name: 'checkbox', props: { checked: true, size: 30 }, size: { w: 30, h: 30 } },
  { name: 'radio', props: { checked: true, size: 30 }, size: { w: 30, h: 30 } },

  // ---- 数据驱动 / 容器类 ----
  { name: 'tabs', props: { active: 1, itemH: 38 }, data: { tabs: ['推荐', '关注', '最新'] }, size: { w: 220, h: 38 } },
  {
    name: 'segmented',
    props: { active: 0, itemH: 36 },
    data: { segments: ['日', '周', '月'] },
    size: { w: 220, h: 36 },
  },
  { name: 'keypad', props: { cols: 3, keyH: 30, gap: 6 }, data: { keys: ['1', '2', '3', '4', '5', '6'] }, size: { w: 200, h: 66 } },
  { name: 'carousel', props: { index: 1, indicator: true }, data: { pages: ['第一页', '第二页', '第三页'] }, size: { w: 200, h: 72 } },
  {
    name: 'list',
    props: { itemH: 18, gap: 2, divider: true },
    data: { items: ['列表项 A', '列表项 B', '列表项 C'] },
    size: { w: 200, h: 58 },
  },
  // T35：网格与滑动容器（T31 的两个组件，之前只在离线 .ui 里验过）
  {
    name: 'grid',
    props: { cols: 3, cellH: 22, gapX: 4, gapY: 4, virtual: true },
    data: { items: ['A', 'B', 'C', 'D', 'E', 'F'] },
    size: { w: 200, h: 76 },
  },
  { name: 'scroll', props: { bgColor: '#2b4a52' }, size: { w: 200, h: 60 } },
];

/** 总览行高（逻辑像素）：比最高的组件（键盘 66）再留一点呼吸。 */
export const GALLERY_ITEM_H = 88;

/** 总览内容总高（含项间距）。 */
export const galleryContentHeight = (): number => GALLERY_ENTRIES.length * GALLERY_ITEM_H;
