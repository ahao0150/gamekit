import { describe, expect, it } from 'vitest';
import type { Ctx2D } from '../../platform/contract';
import { createCamera } from './index';

/** 假画布：记录 save/restore/scale/translate 的顺序。 */
const spyCtx = (): { ctx: Ctx2D; ops: string[] } => {
  const ops: string[] = [];
  const ctx = {
    save: () => ops.push('save'),
    restore: () => ops.push('restore'),
    scale: (x: number, y: number) => ops.push(`scale(${x},${y})`),
    translate: (x: number, y: number) => ops.push(`translate(${x},${y})`),
  } as unknown as Ctx2D;
  return { ctx, ops };
};

/** 按固定 dt 跑若干秒。 */
const run = (
  camera: ReturnType<typeof createCamera>,
  target: { x: number; y: number },
  velocity: { x: number; y: number },
  seconds: number,
  fps: number,
): void => {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i += 1) camera.follow(target, velocity, 1 / fps);
};

describe('平滑：帧率无关', () => {
  it('同样 0.5 秒，60fps（30 帧）与 30fps（15 帧）收敛到同一位置（差 < 0.5px）', () => {
    const a = createCamera({ viewport: { w: 390, h: 844 }, smoothing: 0.12 });
    const b = createCamera({ viewport: { w: 390, h: 844 }, smoothing: 0.12 });
    const target = { x: 1000, y: 0 };
    run(a, target, { x: 0, y: 0 }, 0.5, 60);
    run(b, target, { x: 0, y: 0 }, 0.5, 30);
    expect(Math.abs(a.center.x - b.center.x)).toBeLessThan(0.5);
    // 并且确实往目标走了（不是两边都没动）
    expect(a.center.x).toBeGreaterThan(100);
  });

  it('smoothing=1 是瞬时跟随（一帧到位）', () => {
    const camera = createCamera({ viewport: { w: 390, h: 844 }, smoothing: 1 });
    camera.follow({ x: 640, y: 0 }, { x: 0, y: 0 }, 1 / 60);
    expect(camera.center.x).toBeCloseTo(640, 6);
  });

  it('smoothing=0 时相机完全不动', () => {
    const camera = createCamera({ viewport: { w: 390, h: 844 }, smoothing: 0 });
    run(camera, { x: 800, y: 0 }, { x: 100, y: 0 }, 1, 60);
    expect(camera.center.x).toBe(0);
  });
});

describe('死区', () => {
  it('目标在死区内移动 → 相机完全不动（逐帧 0 变化）', () => {
    const camera = createCamera({ viewport: { w: 390, h: 844 }, deadzone: { w: 120, h: 200 }, smoothing: 1 });
    const before = camera.center.x;
    for (let i = 0; i < 30; i += 1) {
      camera.follow({ x: 50, y: 0 }, { x: 0, y: 0 }, 1 / 60); // 在 ±60 死区内
      expect(camera.center.x).toBe(before);
    }
  });

  it('越过死区边缘 → 相机被推出去，推出距离 = 超出距离', () => {
    const camera = createCamera({ viewport: { w: 390, h: 844 }, deadzone: { w: 120, h: 0 }, smoothing: 1 });
    expect(camera.center.x).toBe(0);
    camera.follow({ x: 100, y: 0 }, { x: 0, y: 0 }, 1 / 60); // 超出 100-60 = 40
    expect(camera.center.x).toBeCloseTo(40, 6);
    camera.follow({ x: -100, y: 0 }, { x: 0, y: 0 }, 1 / 60); // 反向同样
    expect(camera.center.x).toBeCloseTo(-40, 6);
  });

  it('纵向死区很大时纵向固定（竖屏平台跳跃）', () => {
    const camera = createCamera({ viewport: { w: 390, h: 844 }, deadzone: { w: 120, h: 100000 }, smoothing: 1 });
    const y = camera.center.y;
    run(camera, { x: 0, y: 999 }, { x: 0, y: 0 }, 0.5, 60);
    expect(camera.center.y).toBe(y);
  });
});

describe('边界钳制', () => {
  it('走到世界最左 → 可见区左边缘贴住 bounds.x，不露世界外', () => {
    const camera = createCamera({
      viewport: { w: 390, h: 844 },
      bounds: { x: 0, y: 0, w: 2000, h: 844 },
      smoothing: 1,
    });
    camera.follow({ x: -500, y: 0 }, { x: -100, y: 0 }, 1 / 60);
    expect(camera.visible.x).toBeCloseTo(0, 6);
    expect(camera.center.x).toBeCloseTo(195, 6); // visibleW/2
  });

  it('走到世界最右 → 可见区右边缘贴住 bounds 右边界', () => {
    const camera = createCamera({
      viewport: { w: 390, h: 844 },
      bounds: { x: 0, y: 0, w: 2000, h: 844 },
      smoothing: 1,
    });
    camera.follow({ x: 99999, y: 0 }, { x: 100, y: 0 }, 1 / 60);
    expect(camera.visible.x + camera.visible.w).toBeCloseTo(2000, 6);
  });

  it('世界比视口窄 → 该轴居中且固定（不会乱飘）', () => {
    const camera = createCamera({
      viewport: { w: 390, h: 844 },
      bounds: { x: 0, y: 0, w: 300, h: 2000 },
      smoothing: 1,
    });
    expect(camera.center.x).toBeCloseTo(150, 6); // 300/2
    camera.follow({ x: 0, y: 0 }, { x: 0, y: 0 }, 1 / 60);
    expect(camera.center.x).toBeCloseTo(150, 6);
    // 纵向世界更长 → 纵向会跟随
    camera.follow({ x: 0, y: 1500 }, { x: 0, y: 0 }, 1 / 60);
    expect(camera.center.y).toBeCloseTo(1500, 6);
  });

  it('不传 bounds → 不做钳制（可以跟到很远）', () => {
    const camera = createCamera({ viewport: { w: 390, h: 844 }, smoothing: 1 });
    camera.follow({ x: 5000, y: 3000 }, { x: 0, y: 0 }, 1 / 60);
    expect(camera.center.x).toBeCloseTo(5000, 6);
    expect(camera.center.y).toBeCloseTo(3000, 6);
  });
});

describe('坐标换算', () => {
  it('worldToScreen / screenToWorld 互逆（误差 < 1e-9）', () => {
    const camera = createCamera({
      viewport: { w: 390, h: 844 },
      bounds: { x: 0, y: 0, w: 2000, h: 844 },
      smoothing: 1,
      zoom: 1,
    });
    camera.follow({ x: 800, y: 0 }, { x: 0, y: 0 }, 1 / 60);
    const points = [{ x: 0, y: 0 }, { x: 123.5, y: 456.25 }, { x: 1999, y: 843 }];
    for (const point of points) {
      const screen = camera.worldToScreen(point);
      const back = camera.screenToWorld(screen);
      expect(Math.abs(back.x - point.x)).toBeLessThan(1e-9);
      expect(Math.abs(back.y - point.y)).toBeLessThan(1e-9);
    }
  });

  it('zoom=2 时 1 世界像素 = 2 屏幕像素', () => {
    const camera = createCamera({ viewport: { w: 390, h: 844 }, zoom: 2, smoothing: 1 });
    const a = camera.worldToScreen({ x: 0, y: 0 });
    const b = camera.worldToScreen({ x: 10, y: 10 });
    expect(b.x - a.x).toBeCloseTo(20, 6);
    expect(b.y - a.y).toBeCloseTo(20, 6);
  });
});

describe('前瞻', () => {
  it('向右移动时相机中心在目标右侧，向左时在左侧', () => {
    const right = createCamera({ viewport: { w: 390, h: 844 }, smoothing: 1, lookAhead: 60 });
    right.follow({ x: 500, y: 0 }, { x: 200, y: 0 }, 1 / 60);
    expect(right.center.x).toBeCloseTo(560, 6);

    const left = createCamera({ viewport: { w: 390, h: 844 }, smoothing: 1, lookAhead: 60 });
    left.follow({ x: 500, y: 0 }, { x: -200, y: 0 }, 1 / 60);
    expect(left.center.x).toBeCloseTo(440, 6);
  });

  it('目标静止（|vx| ≤ 1）时不加前瞻', () => {
    const camera = createCamera({ viewport: { w: 390, h: 844 }, smoothing: 1, lookAhead: 60 });
    camera.follow({ x: 500, y: 0 }, { x: 0, y: 0 }, 1 / 60);
    expect(camera.center.x).toBeCloseTo(500, 6);
  });
});

describe('apply / 抖动 / 健壮性', () => {
  it('apply 先 save 后 restore，restore 调用后变换栈回到原状', () => {
    const { ctx, ops } = spyCtx();
    const camera = createCamera({ viewport: { w: 390, h: 844 }, smoothing: 1 });
    const restore = camera.apply(ctx);
    expect(ops[0]).toBe('save');
    expect(ops.some((op) => op.startsWith('scale('))).toBe(true);
    expect(ops.some((op) => op.startsWith('translate('))).toBe(true);
    restore();
    expect(ops[ops.length - 1]).toBe('restore');
    restore(); // 重复调用不应再动栈
    expect(ops[ops.length - 1]).toBe('restore');
  });

  it('shake 后可见区有偏移，衰退后回到 0', () => {
    const camera = createCamera({ viewport: { w: 390, h: 844 }, smoothing: 1 });
    camera.follow({ x: 0, y: 0 }, { x: 0, y: 0 }, 1 / 60);
    const baseX = camera.visible.x;
    const baseY = camera.visible.y;
    camera.shake(12);
    // 抖动相位从 0 开始：横向 sin(0)=0，纵向 cos(0)=1 → 纵向立刻有偏移
    expect(Math.abs(camera.visible.y - baseY) + Math.abs(camera.visible.x - baseX)).toBeGreaterThan(1);
    run(camera, { x: 0, y: 0 }, { x: 0, y: 0 }, 0.5, 60); // 超过 0.3s 衰减时长
    expect(camera.visible.x).toBeCloseTo(baseX, 6);
    expect(camera.visible.y).toBeCloseTo(baseY, 6);
  });

  it('NaN 目标 / 负 zoom / 0 视口 不崩，取安全默认值', () => {
    const camera = createCamera({
      viewport: { w: 0, h: 0 },
      zoom: -2,
      smoothing: Number.NaN,
      deadzone: { w: Number.NaN, h: -5 },
    });
    expect(Number.isFinite(camera.center.x)).toBe(true);
    expect(camera.zoom).toBe(1); // 非法 zoom 回落 1
    expect(camera.visible.w).toBeGreaterThan(0);
    camera.follow({ x: Number.NaN, y: Number.NaN }, { x: Number.NaN, y: 0 }, 1 / 60);
    expect(Number.isFinite(camera.center.x)).toBe(true);
    expect(Number.isFinite(camera.visible.x)).toBe(true);
  });

  it('dt 为 0 / 负数 / NaN 时只做钳制与抖动，不推进平滑', () => {
    const camera = createCamera({ viewport: { w: 390, h: 844 }, smoothing: 0.5 });
    camera.follow({ x: 100, y: 0 }, { x: 0, y: 0 }, 1 / 60);
    const x = camera.center.x;
    camera.follow({ x: 900, y: 0 }, { x: 0, y: 0 }, 0);
    expect(camera.center.x).toBe(x);
    camera.follow({ x: 900, y: 0 }, { x: 0, y: 0 }, Number.NaN);
    expect(camera.center.x).toBe(x);
  });

  it('snap：瞬时定位跳过平滑，仍然钳制边界（开场不该从边界中心滑过来）', () => {
    const camera = createCamera({
      viewport: { w: 390, h: 844 },
      bounds: { x: 0, y: 0, w: 1560, h: 844 },
      smoothing: 0.12,
    });
    // 初始中心 = 边界中心 780（世界比视口宽）
    expect(camera.center.x).toBe(780);
    // snap 到出生点 80：中心被钳到 195（visible.x = 0，左边界贴住）
    camera.snap({ x: 80, y: 662 });
    expect(camera.center.x).toBe(195);
    expect(camera.visible.x).toBe(0);
    // 再 snap 到世界中心，一步到位（不是平滑滑过去）
    camera.snap({ x: 780, y: 422 });
    expect(camera.center.x).toBe(780);
    expect(camera.visible.x).toBe(585);
    // snap 也钳制 NaN（不崩）
    camera.snap({ x: Number.NaN, y: Number.NaN });
    expect(Number.isFinite(camera.center.x)).toBe(true);
  });
});
