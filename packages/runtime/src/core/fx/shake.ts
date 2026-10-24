/**
 * 全屏特效：摇晃（T23）。
 *
 * `beginShake` **只负责 save + translate/rotate，不自己 restore**——因为摇晃要包住
 * 整帧的绘制（游戏在帧开头 begin、帧末尾调用返回的函数），由调用方决定撤销点。
 * 返回的函数必须调用（否则 canvas 状态泄漏），函数内部只做一次 `restore`。
 *
 * 抖动值来自 `hash01(seed)`（确定性）：同一个 `seed` 永远同一抖动。游戏每帧传不同
 * `seed`（比如帧号 / 计时器）就有摇动；传同一个 seed 则是「固定偏移」——这也是
 * 可以逐帧断言的原因（不碰 Math.random / 时间）。
 */

import type { Ctx2D } from '../../platform/contract';
import { hash01, nonNegative } from './util';

/** 摇晃参数。 */
export interface ShakeOptions {
  /** 位移振幅（像素）；会被钳到视口短边的 10% 以内，防参数过大把画面甩飞 */
  readonly amplitude: number;
  /** 旋转幅度（度，默认 0）；同样受短边 10% 的等效限制 */
  readonly rotation?: number;
  /** 抖动种子（每帧换一个值才会摇） */
  readonly seed?: number;
}

/** 空操作（不需要摇晃时返回，调用方无脑调用即可）。 */
const NOOP = (): void => undefined;

/** 旋转上限（度）：按振幅上限制换算，保证不会把画面转飞。 */
const MAX_ROTATION_DEG = 3;

/**
 * 开始摇晃，返回「结束摇晃」函数（内部一次 `restore`）。
 *
 * `amplitude` 与 `rotation` 都是 0 / 非法 → 不 save、不平移，返回空操作
 *（此时 save 与 restore 次数都是 0，配对要求仍然满足）。
 */
export const beginShake = (
  ctx: Ctx2D,
  viewport: { readonly width: number; readonly height: number },
  opts: ShakeOptions,
): (() => void) => {
  const shortSide = Math.min(viewport.width, viewport.height);
  const maxAmplitude = Number.isFinite(shortSide) && shortSide > 0 ? shortSide * 0.1 : 0;
  const amplitude = Math.min(nonNegative(opts.amplitude, 0), maxAmplitude);
  const rotation = Math.min(nonNegative(opts.rotation ?? 0, 0), MAX_ROTATION_DEG);
  if (!(amplitude > 0) && !(rotation > 0)) return NOOP;

  const seed = Number.isFinite(opts.seed) ? (opts.seed ?? 0) : 0;
  ctx.save();
  // 两个独立哈希：x/y 不会同步抖动（同步的话就是整屏平移，没有「抖」的感觉）
  const dx = (hash01(seed * 1.7 + 0.3) * 2 - 1) * amplitude;
  const dy = (hash01(seed * 2.3 + 5.1) * 2 - 1) * amplitude;
  ctx.translate(dx, dy);
  if (rotation > 0) {
    const angle = (hash01(seed * 3.1 + 9.7) * 2 - 1) * rotation * (Math.PI / 180);
    ctx.rotate(angle);
  }
  return () => ctx.restore();
};
