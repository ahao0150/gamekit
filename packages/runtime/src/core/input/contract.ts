/**
 * 输入归一化契约。
 *
 * 三个平台（web / 微信 / 抖音）的指针事件字段名不同，业务代码不该知道。
 * 这里统一收成两个语义事件：
 * - tap：按下抬起、位移小、时间短 → 点按；
 * - drag：位移超过阈值 → 拖拽，带 start / move / end 三段。
 *
 * 坐标一律是**设计坐标**（左上角原点），由 `mapping` 从屏幕逻辑坐标换算。
 * tap 判定位移也用设计坐标，保证不同 dpr / fit 策略下手感一致。
 */

import type { PlatformAdapter, PointerEvent, Unsubscribe } from '../../platform/contract';

export interface TapEvent {
  readonly id: number;
  /** 设计坐标 */
  readonly x: number;
  readonly y: number;
  /** 按下到抬起耗时（ms） */
  readonly duration: number;
}

export type DragPhase = 'start' | 'move' | 'end';

export interface DragEvent {
  readonly id: number;
  readonly phase: DragPhase;
  readonly x: number;
  readonly y: number;
  readonly startX: number;
  readonly startY: number;
  /** 相对起点的总位移（设计像素） */
  readonly dx: number;
  readonly dy: number;
}

/** 屏幕逻辑坐标 → 设计坐标：design = (screen - origin) / scale */
export interface DesignMapping {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly originX: number;
  readonly originY: number;
}

export interface InputOptions {
  /** tap 允许的最大位移（设计像素，严格小于），默认 12 */
  readonly tapMaxMove?: number;
  /** tap 允许的最长时长（ms，严格小于），默认 400 */
  readonly tapMaxDuration?: number;
  /** 不传则恒等映射（screen 已是设计坐标的场景） */
  readonly mapping?: DesignMapping;
}

export interface Input {
  /** 注册点按回调，返回退订函数 */
  onTap(cb: (e: TapEvent) => void): Unsubscribe;
  /** 注册拖拽回调，返回退订函数 */
  onDrag(cb: (e: DragEvent) => void): Unsubscribe;
  /** 不传 id = 是否有任一指针按下 */
  isDown(id?: number): boolean;
  /** 当前按下的指针数量（多点触摸用） */
  readonly downCount: number;
  /** 退订平台事件并清空监听 */
  dispose(): void;
  /** 喂入一条指针事件。测试与自定义输入源用；正常由平台 onPointer 驱动。 */
  handle(e: PointerEvent): void;
}

export type CreateInput = (platform: PlatformAdapter, opts?: InputOptions) => Input;

/** 纯函数：按 fit 策略计算设计坐标映射，不依赖 canvas。 */
export type CreateDesignMapping = (
  screen: { readonly width: number; readonly height: number },
  design: { readonly width: number; readonly height: number },
  fit?: 'height' | 'width' | 'contain',
) => DesignMapping;
