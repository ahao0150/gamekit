/**
 * 2D 物理薄封装（planck）。目标：够用、可测、不被引擎细节绑住。
 *
 * 三条设计决定：
 * 1. **固定步长在内部**：外部传 dt，内部累积到 1/60 才 step。物理直接用可变 dt
 *    会在不同帧率下走出不同结果（跳跃高度都不一样），这是最难查的一类 bug。
 * 2. **快照是纯数据**：渲染与玩法判定只读 `BodyPose`，不 import planck。
 * 3. **坐标直接用像素、y 向下**：与画布、关卡数据一致，省掉一层单位换算
 *    （Box2D 惯例是「米、y 向上」，但这里只有我们自己用）。
 */

import { World, Vec2, Box, Circle, WorldManifold } from 'planck';
import type { Body as PlanckBody, Contact, Fixture } from 'planck';
import type {
  BodyDef,
  BodyHandle,
  BodyPose,
  ContactEvent,
  ContactListener,
  CreatePhysicsWorld,
  PhysicsWorld,
} from './contract';

/** 默认重力：像素/秒²（y 向下为正，与画布一致） */
export const DEFAULT_GRAVITY = { x: 0, y: 1800 } as const;
/** 固定步长：1/60 秒 */
export const DEFAULT_FIXED_STEP = 1 / 60;
/** 单帧最多追几步：防止卡顿后一次补算上百步（螺旋死亡） */
const MAX_STEPS_PER_FRAME = 5;

/**
 * 像素 ↔ 物理单位（米）的换算比例。
 * 
 * 为什么必须有：planck（Box2D）的常量是按「米」调的 —— maxTranslation = 2 单位/步。
 * 如果把像素直接当米用，一次跳跃的位移 620px/60 ≈ 10 单位/步会被钳到 2 单位/步，
 * 表现就是「跳跃只有 120px/s、怎么调速度都跳不高」。
 * 这里统一按 100px = 1m 换算：契约对外仍然是像素，内部才是米。
 */
export const PIXELS_PER_UNIT = 100;

const toUnits = (px: number): number => px / PIXELS_PER_UNIT;
const toPixels = (units: number): number => units * PIXELS_PER_UNIT;

/** 刚体上挂的标记：句柄 id（碰撞事件里用它反查 handle） */
const ID_KEY = 'mgBodyId';

const idOfFixture = (fixture: Fixture): number | null => {
  const value = fixture.getBody().getUserData();
  if (typeof value !== 'object' || value === null) return null;
  const id = (value as Record<string, unknown>)[ID_KEY];
  return typeof id === 'number' ? id : null;
};

export const createPhysicsWorld: CreatePhysicsWorld = (opts = {}) => {
  const gravity = opts.gravity ?? DEFAULT_GRAVITY;
  const fixedStep = opts.fixedStep !== undefined && opts.fixedStep > 0 ? opts.fixedStep : DEFAULT_FIXED_STEP;
  // 重力也要换算：不换算的话 1800 会被当成 1800 m/s²（60 步就把速度顶到上万 px/s）
  const world = new World({ gravity: new Vec2(toUnits(gravity.x), toUnits(gravity.y)) });

  const bodies = new Map<number, PlanckBody>();
  const poseData = new Map<number, BodyPose>();
  const listeners = new Set<ContactListener>();
  /** 复用的世界流形（避免每次碰撞都分配） */
  const manifold = new WorldManifold();
  let nextId = 1;
  let accumulator = 0;

  const handleOf = (id: number): BodyHandle => ({ id });

  const requireBody = (handle: BodyHandle): PlanckBody | null => bodies.get(handle.id) ?? null;

  const writePose = (id: number, body: PlanckBody): BodyPose => {
    const position = body.getPosition();
    const velocity = body.getLinearVelocity();
    const stored = poseData.get(id);
    const userData = body.getUserData();
    const pose: BodyPose = {
      id,
      x: toPixels(position.x),
      y: toPixels(position.y),
      angle: body.getAngle(),
      vx: toPixels(velocity.x),
      vy: toPixels(velocity.y),
      userData: userData !== null && typeof userData === 'object'
        ? (userData as Record<string, unknown>)['userData']
        : undefined,
    };
    if (stored === undefined || stored.x !== pose.x || stored.y !== pose.y
      || stored.angle !== pose.angle || stored.vx !== pose.vx || stored.vy !== pose.vy) {
      poseData.set(id, pose);
      return pose;
    }
    return stored;
  };

  world.on('begin-contact', (contact: Contact) => {
    if (listeners.size === 0) return;
    const idA = idOfFixture(contact.getFixtureA());
    const idB = idOfFixture(contact.getFixtureB());
    if (idA === null || idB === null) return;
    // 法线：a → b。planck 的世界流形复用同一个对象，这里立刻取出两个分量。
    const worldManifold = contact.getWorldManifold(manifold);
    const normal = worldManifold?.normal ?? { x: 0, y: 0 };
    const event: ContactEvent = {
      a: handleOf(idA),
      b: handleOf(idB),
      normalX: normal.x,
      normalY: normal.y,
    };
    for (const listener of listeners) listener(event);
  });

  const api: PhysicsWorld = {
    addBody(def: BodyDef): BodyHandle {
      const id = nextId;
      nextId += 1;
      const body = world.createBody({
        type: def.type,
        position: new Vec2(toUnits(def.x), toUnits(def.y)),
        fixedRotation: def.fixedRotation ?? def.type !== 'dynamic',
      });
      const shape = def.shape.kind === 'box'
        // Box 要半边长（box2d 惯例），契约里是整边长度
        ? Box(toUnits(def.shape.w) / 2, toUnits(def.shape.h) / 2)
        : Circle(toUnits(def.shape.r));
      body.createFixture(shape, {
        friction: def.friction ?? 0.4,
        restitution: def.restitution ?? 0,
        density: def.density ?? 1,
      });
      body.setUserData({ [ID_KEY]: id, userData: def.userData });
      bodies.set(id, body);
      writePose(id, body);
      return handleOf(id);
    },

    step(dt: number): void {
      if (!Number.isFinite(dt) || dt <= 0) return;
      accumulator += dt;
      let steps = 0;
      while (accumulator >= fixedStep && steps < MAX_STEPS_PER_FRAME) {
        world.step(fixedStep, 8, 3);
        accumulator -= fixedStep;
        steps += 1;
      }
      // 追不上就丢掉积压（宁可慢动作，也不要一帧补算上百步导致瞬移穿墙）
      if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
    },

    snapshot(): readonly BodyPose[] {
      const out: BodyPose[] = [];
      for (const [id, body] of bodies) out.push(writePose(id, body));
      return out;
    },

    poseOf(handle: BodyHandle): BodyPose | null {
      const body = requireBody(handle);
      return body === null ? null : writePose(handle.id, body);
    },

    setVelocity(handle: BodyHandle, vx: number, vy: number): void {
      requireBody(handle)?.setLinearVelocity(new Vec2(toUnits(vx), toUnits(vy)));
    },

    applyImpulse(handle: BodyHandle, ix: number, iy: number): void {
      const body = requireBody(handle);
      if (body === null) return;
      // 作用在质心：不给 point 时 planck 默认按质心处理
      body.applyLinearImpulse(new Vec2(toUnits(ix), toUnits(iy)), body.getWorldCenter(), true);
    },

    setPosition(handle: BodyHandle, x: number, y: number): void {
      const body = requireBody(handle);
      if (body === null) return;
      body.setPosition(new Vec2(toUnits(x), toUnits(y)));
      body.setLinearVelocity(new Vec2(0, 0));
      writePose(handle.id, body);
    },

    onContact(listener: ContactListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setActive(handle: BodyHandle, active: boolean): void {
      requireBody(handle)?.setActive(active);
    },

    isActive(handle: BodyHandle): boolean {
      return requireBody(handle)?.isActive() ?? false;
    },

    removeBody(handle: BodyHandle): void {
      const body = bodies.get(handle.id);
      if (body === undefined) return;
      world.destroyBody(body);
      bodies.delete(handle.id);
      poseData.delete(handle.id);
    },

    get bodyCount(): number {
      return bodies.size;
    },
  };

  return api;
};

export type {
  BodyDef, BodyHandle, BodyPose, ContactEvent, ContactListener, PhysicsWorld, ShapeDef,
} from './contract';
