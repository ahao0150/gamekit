/**
 * 扩展机制契约。
 *
 * core 只提供「最小必需能力」，其他一切（物理、粒子、寻路、录屏、回放……）
 * 都以 System（系统）的形式挂进游戏循环。
 *
 * 这条设计保证三件事：
 * 1. 不用某个扩展的游戏，那个扩展的代码不会进包（按需 import + tree-shake）；
 * 2. 换实现（物理用 planck 还是 box2d）不需要动 core 和业务代码；
 * 3. core 永远不知道这些扩展存在，也就永远不会被它们污染。
 */

import type { Ctx2D } from '../platform/contract';

/**
 * 更新与渲染顺序。数值小的先执行。
 * 业务与扩展用这些档位「插队」，不要自己发明阶段。
 */
export const ORDER = {
  input: 0,
  physics: 100,
  gameplay: 200,
  animation: 300,
  ui: 400,
  render: 1000,
} as const;

export type OrderKey = keyof typeof ORDER;

/** 游戏实例的最小视图，供 System 使用，避免 System 反向依赖完整 Game 类型。 */
export interface GameLike {
  use(system: System): void;
  readonly systems: readonly System[];
}

/**
 * 一个可插拔系统。
 *
 * 生命周期：init（挂载时） → update（每个固定步长） → render（每帧） → destroy（卸载时）。
 * update 里不许碰 canvas；render 里不许改状态。
 */
export interface System {
  readonly name: string;
  readonly order: number;
  init?(game: GameLike): void;
  /** 固定步长更新，dt 单位为秒 */
  update?(dt: number): void;
  /** 每帧渲染，alpha 为插值系数 0..1（用于渲染插值消除抖动） */
  render?(ctx: Ctx2D, alpha: number): void;
  destroy?(): void;
}

// ---------------------------------------------------------------------------
// 物理扩展契约
//
// 物理不进 core。core 只定义这份契约，具体实现由独立包提供（如 @mg/physics-planck）。
// 物理只负责产出 transform（x / y / angle）与碰撞事件，不负责画。
// 渲染层自己去 world 读状态来画 —— 这样换物理实现，渲染一行不用改。
// ---------------------------------------------------------------------------

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export type ShapeDef =
  | { readonly kind: 'circle'; readonly radius: number }
  | { readonly kind: 'rect'; readonly halfWidth: number; readonly halfHeight: number }
  | { readonly kind: 'polygon'; readonly points: readonly Vec2[] };

export interface BodyDef {
  /** 业务侧稳定 id，物理内部用它索引 */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly type: 'static' | 'dynamic' | 'kinematic';
  readonly shape: ShapeDef;
  readonly density?: number;
  readonly friction?: number;
  readonly restitution?: number;
  /** 是否锁定旋转（横板角色常用） */
  readonly fixedRotation?: boolean;
  /** 碰撞分组，同 group 内按规则过滤 */
  readonly group?: number;
}

export interface BodyState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** 弧度 */
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
  readonly awake: boolean;
}

export interface ContactEvent {
  readonly a: string;
  readonly b: string;
  readonly phase: 'begin' | 'end';
}

export interface RayHit {
  readonly id: string;
  readonly point: Vec2;
  readonly normal: Vec2;
  /** 0..1，命中点占射线长度的比例 */
  readonly fraction: number;
}

/** 物理世界。所有实现都必须满足这份契约。 */
export interface PhysicsWorld {
  createBody(def: BodyDef): void;
  removeBody(id: string): void;
  getBody(id: string): BodyState | null;
  /** 一次性冲量（跳跃、击退） */
  applyImpulse(id: string, ix: number, iy: number): void;
  setVelocity(id: string, vx: number, vy: number): void;
  /** 推进一拍。由 PhysicsModule.system.update 调用，业务不要直接调。 */
  step(dt: number): void;
  /** 射线：拾取、视野、地面探测 */
  rayCast(from: Vec2, to: Vec2): RayHit | null;
  /** 取走本拍产生的碰撞事件（取完清空，避免堆积） */
  drainContacts(): readonly ContactEvent[];
}

export interface PhysicsOptions {
  readonly gravity: Vec2;
  /** 固定步长，默认 1/60 秒 */
  readonly step?: number;
  /** 单帧最多补步数，防掉帧雪崩，默认 3 */
  readonly maxSubSteps?: number;
}

export interface PhysicsModule {
  readonly system: System;
  readonly world: PhysicsWorld;
}

/**
 * 物理实现的工厂契约。举例：
 *
 *   import { createPlanckPhysics } from '@mg/physics-planck';
 *   const physics = createPlanckPhysics({ gravity: { x: 0, y: 900 } });
 *   game.use(physics.system);
 *
 * core 与业务代码都不知道底层是 planck 还是 box2d。
 */
export type PhysicsFactory = (opts: PhysicsOptions) => PhysicsModule;
