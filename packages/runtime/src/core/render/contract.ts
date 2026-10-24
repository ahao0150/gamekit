/**
 * 2D 绘制契约。
 *
 * 为什么是「薄封装」而不是一套 UI 框架：绘制逻辑本身简单（矩形、图、文字），
 * 复杂的是布局和状态，那两块已经分给了 `ui` 与业务层。这一层只做两件事：
 * 把 `CanvasRenderingContext2D` 的常用调用收成显式 API，以及在调用前断言
 * 参数合法（NaN / Infinity 的坐标是 Canvas 静默不画的头号元凶）。
 *
 * 为什么所有坐标都是逻辑像素：缩放由外壳统一 `setTransform(dpr,...)`，
 * 绘制层永远不知道 dpr。这样同一份代码三端结果一致。
 *
 * 为什么「只画不判」：渲染层不读游戏规则、不改状态。出现任何 `if (score > x)`
 * 就是越界，应该在业务层的状态里算好。
 */

import type { Ctx2D, GameImage } from '../../platform/contract';
import type { Rect, Slice9Insets, Vec2 } from '../ui/contract';

export type { Ctx2D, GameImage };

export interface TextStyle {
  /** 字号（逻辑像素），默认 16 */
  readonly size?: number;
  /** 字体族，默认 `'sans-serif'` */
  readonly family?: string;
  readonly weight?: 'normal' | 'bold';
  /** 水平对齐，默认 'left' */
  readonly align?: 'left' | 'center' | 'right';
  /** 垂直基线，默认 'top' */
  readonly baseline?: 'top' | 'middle' | 'bottom' | 'alphabetic';
  /** CSS 颜色，默认 '#000' */
  readonly color?: string;
  /** 多行行高（逻辑像素）；不传则按 size × 1.2 */
  readonly lineHeight?: number;
  /** 描边宽度；>0 时先描边后填充 */
  readonly strokeWidth?: number;
  readonly strokeColor?: string;
}

export interface ImageDrawOptions {
  /** 0..1，默认 1 */
  readonly alpha?: number;
  /** 水平/垂直翻转 */
  readonly flipX?: boolean;
  readonly flipY?: boolean;
  /** 九宫格切片：给定时按面板拉伸，不给则整图拉伸 */
  readonly slice9?: Slice9Insets;
  /** 旋转弧度，绕目标矩形中心 */
  readonly rotation?: number;
}

export interface RenderService {
  /** 拿到原始 ctx（只给平台层与调试用；业务层不该用） */
  readonly ctx: Ctx2D;

  /** 每帧开始：重置 transform、清屏 */
  beginFrame(clearColor?: string): void;
  /** 每帧结束：恢复状态（调试时画帧率等） */
  endFrame(): void;

  /** 纯色矩形 */
  fillRect(rect: Rect, color: string): void;
  /** 描边矩形 */
  strokeRect(rect: Rect, color: string, lineWidth?: number): void;

  /** 画图。`asset` 为 null 时静默跳过（资源没加载好是常态，不该崩） */
  image(asset: GameImage | null, rect: Rect, opts?: ImageDrawOptions): void;

  /** 画文字。单行；多行用 `textLines` */
  text(text: string, at: Vec2, style?: TextStyle): void;
  /** 画多行，逐行按 lineHeight 下移 */
  textLines(lines: readonly string[], at: Vec2, style?: TextStyle): void;

  line(from: Vec2, to: Vec2, color: string, lineWidth?: number): void;
  circle(center: Vec2, radius: number, color: string, filled?: boolean): void;

  /** 裁剪区域入栈/出栈（界面裁切用） */
  pushClip(rect: Rect): void;
  popClip(): void;

  /** 全局透明度 0..1（入栈，配 popAlpha 使用） */
  pushAlpha(alpha: number): void;
  popAlpha(): void;

  /** 纯色占位块：资源缺失时的统一降级画法 */
  placeholder(rect: Rect, label?: string): void;

  /** 文字宽度测量（供 ui 布局注入） */
  measureText(text: string, style?: TextStyle): number;
}

/**
 * 建绘制服务。
 *
 * `dpr` 是物理像素比：`beginFrame` 会用它把坐标系重置成
 * `setTransform(dpr,0,0,dpr,0,0)`，让绘制坐标始终是逻辑像素。
 * 不传按 1 处理（mock / 小游戏端本身就是逻辑像素坐标系）。
 */
export type CreateRender = (opts: {
  readonly ctx: Ctx2D;
  readonly dpr?: number;
}) => RenderService;
