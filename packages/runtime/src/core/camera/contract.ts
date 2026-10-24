/**
 * 相机契约（世界 → 屏幕的唯一换算处）。
 *
 * 为什么进 core 而不是各游戏自己写：平台跳跃没相机不能玩，而「死区 + 平滑 + 前瞻 +
 * 边界钳制」这四件套一半的人会写错（尤其平滑必须做帧率无关换算，否则 30fps 与
 * 60fps 的手感不一样）。写一遍、测住，所有游戏共用。
 */

import type { Ctx2D } from '../../platform/contract';

export interface CameraViewport {
  readonly w: number;
  readonly h: number;
}

/** 世界边界（逻辑像素）。世界比视口小时，相机会在该轴居中。 */
export interface CameraBounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 死区：目标在这个框里移动时相机不动（逻辑像素）。 */
export interface CameraDeadzone {
  readonly w: number;
  readonly h: number;
}

export interface CameraConfig {
  readonly viewport: CameraViewport;
  readonly bounds?: CameraBounds;
  readonly deadzone?: CameraDeadzone;
  /**
   * 平滑系数 0–1（每帧逼近目标的比例，按 60fps 定义）。
   *
   * 内部换算：`k = 1 - (1 - smoothing) ** (dt * 60)`，所以不同帧率收敛速度一致。
   * 1 = 瞬时跟随（无平滑），0 = 完全不动。
   */
  readonly smoothing?: number;
  /** 前瞻：朝移动方向额外偏移的像素（默认 0） */
  readonly lookAhead?: number;
  /** 缩放（默认 1；非法值按 1 处理） */
  readonly zoom?: number;
}

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface Camera {
  /** 每帧更新：目标世界坐标 + 速度（前瞻用）+ dt（秒） */
  follow(target: WorldPoint, velocity: WorldPoint, dt: number): void;
  /**
   * 瞬时定位到目标：跳过平滑与死区，仍然做边界钳制。
   *
   * 用途：初始化、传送、切换场景。这些场景用 `follow` 会「从上一个位置滑过去」——
   * 平台跳跃开场镜头从世界中心滑到玩家，表现为「从屏幕右侧回弹矫正」，
   * 是 `snap` 缺失时的典型错误观感。
   */
  snap(target: WorldPoint): void;
  /** 应用世界→屏幕变换；返回 restore，必须配对调用 */
  apply(ctx: Ctx2D): () => void;
  worldToScreen(p: WorldPoint): ScreenPoint;
  screenToWorld(p: ScreenPoint): ScreenPoint;
  /** 相机抖动叠加（位置级，不需要改 ctx 变换栈） */
  shake(amount: number): void;
  /** 当前可见世界矩形（渲染剔除用；含抖动偏移） */
  readonly visible: CameraBounds;
  /** 相机中心（世界坐标，不含抖动） */
  readonly center: WorldPoint;
  /** 当前缩放 */
  readonly zoom: number;
}

export type CreateCamera = (config: CameraConfig) => Camera;
