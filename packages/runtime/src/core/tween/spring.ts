/**
 * 弹簧（解析解，纯函数）。
 *
 * 为什么用弹簧而不是 cubic-bezier 硬凑：玩家输入触发的回弹需要「打断时能自然
 * 接管」，而曲线的时长完全写死。规范 §5.1 就是这个分工。
 *
 * 重要：**时间单位是秒**（k/c/m 是物理量纲），而补间的 duration 是毫秒。
 * 两者别混 —— 规范里弹簧的「稳定 115.22ms」是 0.11522 秒。
 *
 * 团队规范 §5 的两条（design_animation(op=spring) 算的，特征根已回代验证
 * σ² + ωd² − ω₀² = 0）：
 * - 轻点回弹：k=1400 c=52 m=1 → ω₀ = 10√14 ≈ 37.41657386773941，
 *   ζ = 13√14/70 ≈ 0.6948792289723034，过冲 4.804267223552392%，
 *   2% 稳定时间 0.11522047205976888 s = 115.22 ms；
 * - 落位/归位：k=900 c=39 m=1 → ω₀ = 30，ζ = 13/20 = 0.65，
 *   过冲 6.807664510187792%，2% 稳定时间 0.15362729607969185 s = 153.63 ms。
 */

import type { Spring, SpringConfig } from './contract';

/** 由 k/c/m 推出解析属性。不手填 ω₀/ζ —— 那些是算出来的。 */
export const createSpring = (config: SpringConfig): Spring => {
  const { stiffness: k, damping: c, mass: m } = config;
  const omega0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  const underdamped = zeta < 1;
  // 峰值过冲：100·e^(−πζ/√(1−ζ²))（只有欠阻尼才有）
  const overshoot = underdamped
    ? Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta))
    : 0;
  // 2% 稳定时间：ln(20)/σ，σ = c/(2m)
  const settleSeconds = Math.log(20) / (c / (2 * m));
  return { ...config, omega0, zeta, overshoot, settleSeconds, underdamped };
};

/**
 * 采样弹簧：from=0、to=1 的归一化位移。
 *
 * 三个阻尼态都实现了（规范里两条都是欠阻尼，但临界/过阻尼写全更不容易在
 * 换参数时静默出错）：
 * - 欠阻尼 ζ<1：1 − e^(−ζω₀t)·[cos(ω_d t) + (ζω₀/ω_d)·sin(ω_d t)]，ω_d = ω₀√(1−ζ²)
 * - 临界 ζ=1：1 − e^(−ω₀t)(1 + ω₀t)
 * - 过阻尼 ζ>1：1 − (r₂e^(r₁t) − r₁e^(r₂t))/(r₂ − r₁)，r₁,₂ = −ζω₀ ± ω₀√(ζ²−1)
 */
export const sampleSpring = (spring: Spring, tSeconds: number): number => {
  if (!Number.isFinite(tSeconds) || tSeconds <= 0) return 0;
  const { omega0, zeta } = spring;
  if (zeta < 1) {
    const wd = omega0 * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega0 * tSeconds);
    return (
      1 - decay * (Math.cos(wd * tSeconds) + ((zeta * omega0) / wd) * Math.sin(wd * tSeconds))
    );
  }
  if (Math.abs(zeta - 1) < 1e-12) {
    return 1 - Math.exp(-omega0 * tSeconds) * (1 + omega0 * tSeconds);
  }
  const root = omega0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * omega0 + root;
  const r2 = -zeta * omega0 - root;
  return 1 - ((r2 * Math.exp(r1 * tSeconds) - r1 * Math.exp(r2 * tSeconds)) / (r2 - r1));
};
