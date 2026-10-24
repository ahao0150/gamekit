/**
 * 2D 物理契约（薄封装）。
 *
 * 定位：**够用就行**，不做大框架。游戏拿它做三件事：
 * 1. 加刚体（地面/平台/角色/敌人）；
 * 2. 每帧推进（固定步长在内部对齐 1/60，外部只传 dt）；
 * 3. 读位姿快照（纯数据，渲染与判定都只读它，不碰物理引擎对象）。
 *
 * 为什么强调固定步长：物理用可变 dt 直接 step，会在不同帧率下走出不同结果
 * （30fps 与 120fps 的跳跃高度都不一样）。所以内部累积到 1/60 才 step 一次。
 *
 * 为什么快照是纯数据：渲染层不该 import planck；判定（踩怪、吃金币）也只用
 * 快照坐标 + 自己算，这样玩法逻辑可单测、不依赖物理引擎内部状态。
 */

/** 刚体句柄：游戏只拿它当不透明 id 用。 */
export interface BodyHandle {
  readonly id: number;
}

/** 形状：方块（w/h 是**整边**长度，不是半边长）或圆（r 是半径）。 */
export type ShapeDef =
  | { readonly kind: 'box'; readonly w: number; readonly h: number }
  | { readonly kind: 'circle'; readonly r: number };

export interface BodyDef {
  readonly type: 'static' | 'dynamic' | 'kinematic';
  readonly shape: ShapeDef;
  /** 世界坐标（像素，y 向下为正，与画布一致） */
  readonly x: number;
  readonly y: number;
  readonly friction?: number;
  readonly restitution?: number;
  readonly density?: number;
  /** 锁定旋转（角色/怪几乎都要开，否则会被撞得打转） */
  readonly fixedRotation?: boolean;
  /** 业务侧标识（如 'player' / 'enemy' / 'platform'），碰撞事件里带回来 */
  readonly userData?: unknown;
}

/** 单帧位姿快照（纯数据，可直接进渲染/判定）。 */
export interface BodyPose {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** 弧度 */
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
  readonly userData: unknown;
}

/** 碰撞事件：只给两侧句柄与法线，判定逻辑留给业务。 */
export interface ContactEvent {
  readonly a: BodyHandle;
  readonly b: BodyHandle;
  /** 从 a 指向 b 的单位法线（近似） */
  readonly normalX: number;
  readonly normalY: number;
}

export type ContactListener = (event: ContactEvent) => void;

export interface PhysicsWorld {
  /** 加一个刚体，返回句柄。 */
  addBody(def: BodyDef): BodyHandle;
  /** 推进：外部传 dt（秒），内部累积到 1/60 才真正 step。 */
  step(dt: number): void;
  /** 读所有刚体的位姿快照（渲染/判定用，纯数据）。 */
  snapshot(): readonly BodyPose[];
  /** 读单个刚体（找不到返回 null）。 */
  poseOf(handle: BodyHandle): BodyPose | null;
  /** 设置速度（kinematic 控制器的主要出口，单位 像素/秒）。 */
  setVelocity(handle: BodyHandle, vx: number, vy: number): void;
  /** 施加冲量（dynamic 体用，单位 像素·质量/秒）。 */
  applyImpulse(handle: BodyHandle, ix: number, iy: number): void;
  /** 直接摆位置（重生/传送用）。 */
  setPosition(handle: BodyHandle, x: number, y: number): void;
  /** 订阅碰撞开始事件，返回取消订阅函数。 */
  onContact(listener: ContactListener): () => void;
  /**
   * 休眠 / 唤醒（离屏剔除用）。
   *
   * 休眠的刚体不参与物理步进（planck 直接跳过），所以 100 个离屏实体几乎零成本；
   * 唤醒时它的位置/速度保持原样 —— 与「更新剔除要冻结状态」是同一件事的两半。
   */
  setActive(handle: BodyHandle, active: boolean): void;
  /** 是否处于激活状态（测试与 doctor 用）。 */
  isActive(handle: BodyHandle): boolean;
  /** 移除刚体（重复调用安全）。 */
  removeBody(handle: BodyHandle): void;
  /** 当前刚体数量（测试与 doctor 用）。 */
  readonly bodyCount: number;
}

export type CreatePhysicsWorld = (opts?: {
  readonly gravity?: { readonly x: number; readonly y: number };
  /** 内部固定步长（秒），默认 1/60 */
  readonly fixedStep?: number;
}) => PhysicsWorld;
