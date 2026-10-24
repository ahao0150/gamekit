import { describe, expect, it } from 'vitest';
import { createPhysicsWorld, DEFAULT_FIXED_STEP, DEFAULT_GRAVITY } from './index';
import type { BodyHandle } from './contract';

/** 建一个「地面 + 一个动态方块」的常用场景。 */
const scene = (): { world: ReturnType<typeof createPhysicsWorld>; ground: BodyHandle; box: BodyHandle } => {
  const world = createPhysicsWorld();
  const ground = world.addBody({ type: 'static', shape: { kind: 'box', w: 2000, h: 40 }, x: 0, y: 400 });
  const box = world.addBody({
    type: 'dynamic',
    shape: { kind: 'box', w: 24, h: 24 },
    x: 0,
    y: 300,
    fixedRotation: true,
    userData: 'box',
  });
  return { world, ground, box };
};

/** 推进 seconds 秒（按 60Hz 步进）。 */
const run = (world: ReturnType<typeof createPhysicsWorld>, seconds: number): void => {
  const steps = Math.round(seconds / DEFAULT_FIXED_STEP);
  for (let i = 0; i < steps; i += 1) world.step(DEFAULT_FIXED_STEP);
};

describe('重力与步进', () => {
  it('动态体在重力下下落（y 增大），速度随时间累积', () => {
    const world = createPhysicsWorld();
    const box = world.addBody({ type: 'dynamic', shape: { kind: 'box', w: 10, h: 10 }, x: 0, y: 0 });
    expect(world.poseOf(box)!.y).toBe(0);
    run(world, 0.25);
    const pose = world.poseOf(box)!;
    expect(pose.y).toBeGreaterThan(10);
    expect(pose.vy).toBeGreaterThan(0);
  });

  it('固定步长：同样 0.5 秒，不同 dt 的调用方式走到同一位置（差值 < 1px）', () => {
    const a = createPhysicsWorld();
    const b = createPhysicsWorld();
    const boxA = a.addBody({ type: 'dynamic', shape: { kind: 'box', w: 10, h: 10 }, x: 0, y: 0 });
    const boxB = b.addBody({ type: 'dynamic', shape: { kind: 'box', w: 10, h: 10 }, x: 0, y: 0 });
    // a：60 帧 × 1/60；b：30 帧 × 1/30
    for (let i = 0; i < 60; i += 1) a.step(1 / 60);
    for (let i = 0; i < 30; i += 1) b.step(1 / 30);
    expect(Math.abs(a.poseOf(boxA)!.y - b.poseOf(boxB)!.y)).toBeLessThan(1);
  });

  it('非法的 dt（0 / 负数 / NaN）被忽略，不崩', () => {
    const world = createPhysicsWorld();
    const box = world.addBody({ type: 'dynamic', shape: { kind: 'box', w: 10, h: 10 }, x: 0, y: 0 });
    world.step(0);
    world.step(-1);
    world.step(Number.NaN);
    expect(world.poseOf(box)!.y).toBe(0);
  });

  it('单帧超大 dt 不会一帧补算上百步（防螺旋/穿墙）', () => {
    const world = createPhysicsWorld();
    const box = world.addBody({ type: 'dynamic', shape: { kind: 'box', w: 10, h: 10 }, x: 0, y: 0 });
    world.step(10); // 卡顿了 10 秒
    // 每帧最多追 5 步：位移应远小于自由落体 10 秒
    expect(world.poseOf(box)!.y).toBeLessThan(200);
  });
});

describe('碰撞与地面', () => {
  it('静态地面接住动态方块（最终停在地面上，不再下落）', () => {
    const { world, box } = scene();
    run(world, 2);
    const pose = world.poseOf(box)!;
    const rest1 = pose.y;
    run(world, 0.5);
    const rest2 = world.poseOf(box)!.y;
    // 落在地面上：y ≈ 地面顶 380 - 半高 12 = 368 附近，且不再继续下沉
    expect(rest2).toBeGreaterThan(340);
    expect(rest2).toBeLessThan(380);
    expect(Math.abs(rest2 - rest1)).toBeLessThan(1);
    expect(Math.abs(world.poseOf(box)!.vy)).toBeLessThan(1);
  });

  it('碰撞事件回调带两侧句柄与法线，可取消订阅', () => {
    const { world, ground, box } = scene();
    const events: { a: number; b: number; nx: number; ny: number }[] = [];
    const off = world.onContact((event) => {
      events.push({ a: event.a.id, b: event.b.id, nx: event.normalX, ny: event.normalY });
    });
    run(world, 2);
    expect(events.length).toBeGreaterThan(0);
    const pair = events.find((e) => (e.a === box.id && e.b === ground.id) || (e.a === ground.id && e.b === box.id));
    expect(pair).toBeDefined();
    expect(Math.abs(pair!.nx) + Math.abs(pair!.ny)).toBeGreaterThan(0.9); // 单位法线
    off();
    const countBefore = events.length;
    run(world, 0.5);
    expect(events.length).toBe(countBefore); // 取消订阅后不再收到
  });

  it('userData 能带到快照里（判定要看「这是不是地面」）', () => {
    const { world, ground, box } = scene();
    run(world, 1);
    expect(world.poseOf(ground)!.userData).toBeUndefined();
    expect(world.poseOf(box)!.userData).toBe('box');
  });
});

describe('位姿、速度与生命周期', () => {
  it('snapshot 包含全部刚体，且 id 与 poseOf 一致', () => {
    const { world, ground, box } = scene();
    const snap = world.snapshot();
    expect(snap.length).toBe(2);
    const ids = snap.map((pose) => pose.id).sort((l, r) => l - r);
    expect(ids).toEqual([ground.id, box.id].sort((l, r) => l - r));
    expect(world.bodyCount).toBe(2);
  });

  it('setVelocity 对 kinematic 体生效：水平位移 = 速度 × 时间', () => {
    const world = createPhysicsWorld({ gravity: { x: 0, y: 0 } });
    const body = world.addBody({ type: 'kinematic', shape: { kind: 'box', w: 20, h: 20 }, x: 100, y: 100 });
    world.setVelocity(body, 120, 0); // 120 px/s
    run(world, 0.5);
    expect(world.poseOf(body)!.x).toBeCloseTo(160, 0); // 100 + 120×0.5
  });

  it('applyImpulse 让动态体获得速度', () => {
    const world = createPhysicsWorld({ gravity: { x: 0, y: 0 } });
    const body = world.addBody({ type: 'dynamic', shape: { kind: 'box', w: 20, h: 20 }, x: 0, y: 0, density: 1 });
    const before = world.poseOf(body)!.vx;
    world.applyImpulse(body, 5000, 0);
    world.step(DEFAULT_FIXED_STEP);
    expect(world.poseOf(body)!.vx).toBeGreaterThan(before);
  });

  it('setPosition 传送并清零速度（重生用）', () => {
    const world = createPhysicsWorld();
    const body = world.addBody({ type: 'dynamic', shape: { kind: 'box', w: 10, h: 10 }, x: 0, y: 0 });
    run(world, 0.5);
    world.setPosition(body, 500, 100);
    const pose = world.poseOf(body)!;
    expect(pose.x).toBe(500);
    expect(pose.y).toBe(100);
    expect(pose.vx).toBe(0);
    expect(pose.vy).toBe(0);
  });

  it('removeBody 之后快照里没有它；重复删除不抛错', () => {
    const { world, box } = scene();
    world.removeBody(box);
    expect(world.bodyCount).toBe(1);
    expect(world.snapshot().some((pose) => pose.id === box.id)).toBe(false);
    expect(world.poseOf(box)).toBeNull();
    expect(() => world.removeBody(box)).not.toThrow();
  });

  it('未知句柄的操作是空操作（不抛错）', () => {
    const world = createPhysicsWorld();
    const ghost = { id: 9999 };
    expect(world.poseOf(ghost)).toBeNull();
    expect(() => world.setVelocity(ghost, 1, 1)).not.toThrow();
    expect(() => world.setPosition(ghost, 1, 1)).not.toThrow();
    expect(() => world.applyImpulse(ghost, 1, 1)).not.toThrow();
    expect(() => world.removeBody(ghost)).not.toThrow();
  });

  it('圆形刚体也能落在地面上', () => {
    const world = createPhysicsWorld();
    world.addBody({ type: 'static', shape: { kind: 'box', w: 1000, h: 40 }, x: 0, y: 400 });
    const ball = world.addBody({ type: 'dynamic', shape: { kind: 'circle', r: 12 }, x: 0, y: 200, restitution: 0 });
    run(world, 2);
    const pose = world.poseOf(ball)!;
    expect(pose.y).toBeGreaterThan(340);
    expect(pose.y).toBeLessThan(390);
  });

  it('默认参数：重力与固定步长是对外声明的那组值', () => {
    expect(DEFAULT_GRAVITY).toEqual({ x: 0, y: 1800 });
    expect(DEFAULT_FIXED_STEP).toBeCloseTo(1 / 60, 12);
  });
});
describe('休眠（配合离屏剔除）', () => {
  it('休眠的动态体在重力下完全不动，唤醒后开始下落', () => {
    const world = createPhysicsWorld();
    const body = world.addBody({ type: 'dynamic', shape: { kind: 'box', w: 10, h: 10 }, x: 0, y: 0 });
    world.setActive(body, false);
    expect(world.isActive(body)).toBe(false);
    const before = world.poseOf(body)!.y;
    run(world, 1);
    // 状态冻结：位置一点都不变（不是慢慢变，是完全不变）
    expect(world.poseOf(body)!.y).toBe(before);
    world.setActive(body, true);
    expect(world.isActive(body)).toBe(true);
    run(world, 0.5);
    expect(world.poseOf(body)!.y).toBeGreaterThan(before + 50);
  });

  it('休眠的 kinematic 体不响应 setVelocity（冻结）', () => {
    const world = createPhysicsWorld({ gravity: { x: 0, y: 0 } });
    const body = world.addBody({ type: 'kinematic', shape: { kind: 'box', w: 10, h: 10 }, x: 0, y: 0 });
    world.setActive(body, false);
    world.setVelocity(body, 100, 0);
    run(world, 0.5);
    expect(world.poseOf(body)!.x).toBe(0);
    world.setActive(body, true);
    world.setVelocity(body, 100, 0);
    run(world, 0.5);
    expect(world.poseOf(body)!.x).toBeGreaterThan(40);
  });
});