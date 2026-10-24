/**
 * ui 布局测试用的数据矩阵（纯字面量，无逻辑）。
 *
 * 单独成文件的原因：
 * 1. 单文件 ≤300 行的铁律——矩阵放测试里会撑爆测试文件；
 * 2. 数据与断言分离，下一款游戏要复用时直接 import 矩阵。
 */

import type { WidgetProps } from './contract';

/** 一种屏型（逻辑像素宽高）。 */
export interface ScreenCase {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/** 一个待布局的 widget。 */
export interface WidgetCase {
  readonly name: string;
  readonly props: WidgetProps;
}

/** 屏型矩阵：≥10 种，含 19.5:9 与 4:3（横竖都算）。 */
export const SCREENS: readonly ScreenCase[] = [
  { name: '16:9 1280×720', width: 1280, height: 720 },
  { name: '19.5:9 竖屏 390×844', width: 390, height: 844 },
  { name: '19.5:9 横屏 844×390', width: 844, height: 390 },
  { name: '4:3 横屏 1024×768', width: 1024, height: 768 },
  { name: '4:3 竖屏 768×1024', width: 768, height: 1024 },
  { name: '16:10 1280×800', width: 1280, height: 800 },
  { name: '21:9 2560×1080', width: 2560, height: 1080 },
  { name: '9:16 360×640', width: 360, height: 640 },
  { name: '平板 2048×2732', width: 2048, height: 2732 },
  { name: '小屏 320×480', width: 320, height: 480 },
  { name: '方屏 600×600', width: 600, height: 600 },
  { name: '超宽 1000×300', width: 1000, height: 300 },
];

/** widget 矩阵：固定 / 比例 / 四边拉伸 + min/max 夹取 + anchor×pivot 组合。 */
export const WIDGETS: readonly WidgetCase[] = [
  {
    name: '顶栏（比例宽度）',
    props: { anchor: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0 }, size: { kind: 'ratio', w: 0.9, h: 0.08 } },
  },
  {
    name: '底部主按钮（固定尺寸）',
    props: {
      anchor: { x: 0.5, y: 1 },
      pivot: { x: 0.5, y: 1 },
      offset: { x: 0, y: -16 },
      size: { kind: 'fixed', w: 200, h: 56 },
    },
  },
  {
    name: '左上角图标（anchor 0,0）',
    props: {
      anchor: { x: 0, y: 0 },
      pivot: { x: 0, y: 0 },
      offset: { x: 16, y: 16 },
      size: { kind: 'fixed', w: 48, h: 48 },
    },
  },
  {
    name: '右上角角标（anchor 1,0）',
    props: {
      anchor: { x: 1, y: 0 },
      pivot: { x: 1, y: 0 },
      offset: { x: -16, y: 16 },
      size: { kind: 'fixed', w: 64, h: 32 },
    },
  },
  {
    name: '全屏遮罩（比例 1,1）',
    props: { anchor: { x: 0.5, y: 0.5 }, pivot: { x: 0.5, y: 0.5 }, size: { kind: 'ratio', w: 1, h: 1 } },
  },
  {
    name: '居中弹窗（min/max 夹取）',
    props: {
      anchor: { x: 0.5, y: 0.5 },
      pivot: { x: 0.5, y: 0.5 },
      size: { kind: 'ratio', w: 0.8, h: 0.5 },
      minSize: { x: 240, y: 120 },
      maxSize: { x: 560, y: 400 },
    },
  },
  {
    name: '四边拉伸面板（margin 8）',
    props: {
      anchor: { x: 0.5, y: 0.5 },
      pivot: { x: 0.5, y: 0.5 },
      margin: { top: 8, right: 8, bottom: 8, left: 8 },
    },
  },
  {
    name: '安全区面板（margin 非对称）',
    props: {
      anchor: { x: 0.5, y: 0.5 },
      pivot: { x: 0.5, y: 0.5 },
      margin: { top: 44, right: 16, bottom: 34, left: 16 },
    },
  },
  {
    name: '底部进度条（比例 + offset）',
    props: {
      anchor: { x: 0, y: 1 },
      pivot: { x: 0, y: 1 },
      offset: { x: 24, y: -24 },
      size: { kind: 'ratio', w: 0.6, h: 0.02 },
    },
  },
  {
    name: '最小尺寸角标（minSize 放大）',
    props: {
      anchor: { x: 0.5, y: 0.5 },
      pivot: { x: 0.5, y: 0.5 },
      size: { kind: 'fixed', w: 80, h: 40 },
      minSize: { x: 300, y: 200 },
    },
  },
  {
    name: '最大尺寸按钮（maxSize 收小）',
    props: {
      anchor: { x: 0.5, y: 1 },
      pivot: { x: 0.5, y: 1 },
      offset: { x: 0, y: -8 },
      size: { kind: 'fixed', w: 900, h: 700 },
      maxSize: { x: 200, y: 80 },
    },
  },
  {
    name: '右下角比例块（anchor/pivot 1,1）',
    props: { anchor: { x: 1, y: 1 }, pivot: { x: 1, y: 1 }, size: { kind: 'ratio', w: 0.25, h: 0.2 } },
  },
];
