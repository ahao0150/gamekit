/**
 * 相机实现：死区 → 前瞻 → 平滑 → 边界钳制 → 抖动。
 *
 * 三个必须做对的点（都有单测钉）：
 * 1. **平滑帧率无关**：`k = 1 - (1 - smoothing) ** (dt * 60)`。直接用 smoothing
 *    会在 30fps 下慢一半。
 * 2. **死区内完全不动**：目标在死区里时 desired 就是当前中心，差值为 0 —— 不能
 *    因为浮点误差或抖动逻辑而产生 1px 的漂移。
 * 3. **边界钳制**：世界比视口小时居中且固定；否则可见矩形不越出 bounds。
 */

import type { Ctx2D } from '../../platform/contract';
import type {
  Camera,
  CameraBounds,
  CameraConfig,
  CreateCamera,
  ScreenPoint,
  WorldPoint,
} from './contract';

/** 抖动衰减时长（秒） */
const SHAKE_SECONDS = 0.3;
/** 抖动主频（Hz） */
const SHAKE_HZ = 18;

const finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

const positive = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const createCamera: CreateCamera = (config: CameraConfig): Camera => {
  const viewportW = positive(config.viewport?.w ?? 0, 1);
  const viewportH = positive(config.viewport?.h ?? 0, 1);
  const zoom = positive(config.zoom ?? 1, 1);
  const rawSmoothing = finite(config.smoothing ?? 1, 1);
  const smoothing = clamp(rawSmoothing, 0, 1);
  const lookAhead = Math.max(0, finite(config.lookAhead ?? 0, 0));
  const deadzoneW = Math.max(0, finite(config.deadzone?.w ?? 0, 0));
  const deadzoneH = Math.max(0, finite(config.deadzone?.h ?? 0, 0));
  const bounds = config.bounds !== undefined
    && Number.isFinite(config.bounds.x) && Number.isFinite(config.bounds.y)
    && Number.isFinite(config.bounds.w) && Number.isFinite(config.bounds.h)
    && config.bounds.w > 0 && config.bounds.h > 0
    ? config.bounds
    : undefined;

  /** 可见世界尺寸（缩放后） */
  const visibleW = viewportW / zoom;
  const visibleH = viewportH / zoom;

  // 初始中心：有边界就从边界中心开始（避免开场镜头从 (0,0) 甩过去）
  let centerX = bounds === undefined ? 0 : bounds.x + bounds.w / 2;
  let centerY = bounds === undefined ? 0 : bounds.y + bounds.h / 2;
  let shakeAmplitude = 0;
  let shakeElapsed = 0;

  const clampToBounds = (): void => {
    if (bounds === undefined) return;
    // 世界比视口小：该轴居中且固定（否则会出现「世界浮在中间乱飘」）
    centerX = bounds.w <= visibleW
      ? bounds.x + bounds.w / 2
      : clamp(centerX, bounds.x + visibleW / 2, bounds.x + bounds.w - visibleW / 2);
    centerY = bounds.h <= visibleH
      ? bounds.y + bounds.h / 2
      : clamp(centerY, bounds.y + visibleH / 2, bounds.y + bounds.h - visibleH / 2);
  };

  clampToBounds();

  const shakeOffset = (): WorldPoint => {
    if (shakeAmplitude <= 0) return { x: 0, y: 0 };
    const decay = Math.max(0, 1 - shakeElapsed / SHAKE_SECONDS);
    const amplitude = shakeAmplitude * decay;
    const phase = shakeElapsed * SHAKE_HZ * Math.PI * 2;
    return { x: Math.sin(phase) * amplitude, y: Math.cos(phase * 1.37) * amplitude * 0.6 };
  };

  const visibleOf = (): CameraBounds => {
    const offset = shakeOffset();
    return {
      x: centerX - visibleW / 2 + offset.x,
      y: centerY - visibleH / 2 + offset.y,
      w: visibleW,
      h: visibleH,
    };
  };

  const camera: Camera = {
    follow(target: WorldPoint, velocity: WorldPoint, dt: number): void {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      const targetX = finite(target.x, centerX);
      const targetY = finite(target.y, centerY);
      const velocityX = finite(velocity.x, 0);

      // 1) 死区：目标在框内 → desired 保持当前中心（差值恒 0，相机真的一动不动）
      const halfDeadX = deadzoneW / 2;
      const halfDeadY = deadzoneH / 2;
      let desiredX = centerX;
      let desiredY = centerY;
      const dx = targetX - centerX;
      const dy = targetY - centerY;
      if (dx > halfDeadX) desiredX = targetX - halfDeadX;
      else if (dx < -halfDeadX) desiredX = targetX + halfDeadX;
      if (dy > halfDeadY) desiredY = targetY - halfDeadY;
      else if (dy < -halfDeadY) desiredY = targetY + halfDeadY;

      // 2) 前瞻：朝移动方向多看一点（|vx| 太小时不算，避免静止抖动）
      if (lookAhead > 0 && Math.abs(velocityX) > 1) desiredX += Math.sign(velocityX) * lookAhead;

      // 3) 帧率无关平滑：k 按 60fps 定义后换算到本次 dt
      if (smoothing <= 0) {
        // 完全不平滑：不动
      } else if (smoothing >= 1 || step === 0) {
        centerX = smoothing >= 1 ? desiredX : centerX;
        centerY = smoothing >= 1 ? desiredY : centerY;
      } else {
        const k = 1 - Math.pow(1 - smoothing, step * 60);
        centerX += (desiredX - centerX) * k;
        centerY += (desiredY - centerY) * k;
      }

      // 4) 边界钳制（每帧都做，保证任何时刻都不露世界外）
      clampToBounds();

      // 5) 抖动衰减
      if (shakeAmplitude > 0) {
        shakeElapsed += step;
        if (shakeElapsed >= SHAKE_SECONDS) {
          shakeAmplitude = 0;
          shakeElapsed = 0;
        }
      }
    },

    /**
     * 瞬时定位：直接改中心，跳过死区与平滑，仍然钳制边界。
     *
     * 为什么必须有：初始中心的默认值是「边界中心」（世界比视口大时），
     * 用它配 `follow` 做开场，相机会从世界中心平滑滑到出生点——
     * 表现就是「进游戏时镜头从右侧回弹矫正」。`snap` 让初始化一步到位。
     */
    snap(target: WorldPoint): void {
      centerX = finite(target.x, centerX);
      centerY = finite(target.y, centerY);
      clampToBounds();
    },

    apply(ctx: Ctx2D): () => void {
      const visible = visibleOf();
      ctx.save();
      // 先缩放再平移：屏幕坐标 = (世界坐标 - 可见区左上) × zoom
      ctx.scale(zoom, zoom);
      ctx.translate(-visible.x, -visible.y);
      return () => {
        ctx.restore();
      };
    },

    worldToScreen(p: WorldPoint): ScreenPoint {
      const visible = visibleOf();
      return { x: (finite(p.x, 0) - visible.x) * zoom, y: (finite(p.y, 0) - visible.y) * zoom };
    },

    screenToWorld(p: ScreenPoint): ScreenPoint {
      const visible = visibleOf();
      return { x: finite(p.x, 0) / zoom + visible.x, y: finite(p.y, 0) / zoom + visible.y };
    },

    shake(amount: number): void {
      if (!Number.isFinite(amount) || amount <= 0) return;
      // 取较大值：连续受击时不会因为新的一次更小而变弱
      shakeAmplitude = Math.max(shakeAmplitude, amount);
      shakeElapsed = 0;
    },

    get visible(): CameraBounds {
      return visibleOf();
    },

    get center(): WorldPoint {
      return { x: centerX, y: centerY };
    },

    get zoom(): number {
      return zoom;
    },
  };

  return camera;
};
