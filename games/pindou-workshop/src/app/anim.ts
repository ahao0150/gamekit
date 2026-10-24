/**
 * 第二轮动效的**纯数值层**（不碰 canvas、不存状态、不读全局）。
 *
 * 数值全部来自 `artifacts/pindou-juice-spec.md`（设计基准 390×844、格边 21.875px）；
 * 本游戏盘面是 10×10，格边在 390 上是 39px，所以**倍率与时长照抄、像素幅度按格边重算**：
 * - 「拿起放大 1.25×」在 39px 格上是 +9.75px ≫ 2px 可感知门槛 ✅
 * - 「连击 1.06×」只有 2.3px，按 spec §1 的换算仍不许用缩放 → 连击只走光晕阶梯
 *
 * 为什么单独成文件：这些能在 Node 里断言（见 anim.test.ts），渲染层只负责把数值画出来。
 * 颜色不在这里：色值统一放 `skin.ts`（本文件只留数值与曲线）。
 */

import { IRON_BURN, IRON_COLD, IRON_DONE } from './skin';

/** 时长阶梯（ms）：与 `MOTION.ms`、`docs/motion.md` §3 同一套 */
export const MS = { t0: 60, t1: 120, t2: 240, t3: 480 } as const;

// ---------- ① 拿起 / ② 跟手高亮 ----------

/** 拿起放大目标倍率（spec ①：1.000 → 1.250，60ms，out） */
export const PICK_SCALE = 1.25;
/** 跟手高亮强度：常态 0.55，悬停到同色空格 1.30（spec ②） */
export const HILITE_IDLE = 0.55;
export const HILITE_HOVER = 1.3;
/** 高亮淡入 120ms；悬停提升 90ms；离开回落到 0.55 也用 90ms（对称，不然「掉下去」很突） */
export const HILITE_FADE_MS = 120;
export const HILITE_HOVER_MS = 90;

// ---------- ③ 归位成功 ----------

/** 连击光晕阶梯（spec ③）：连击 1/2/3/4+ → 1.40/1.80/2.20/2.60，≥5 封顶 */
export const COMBO_PEAK = [1.4, 1.8, 2.2, 2.6] as const;
/** 锁定高光：出段 80ms out + 回段 80ms in（共 160ms） */
export const LOCK_UP_MS = 80;
export const LOCK_DOWN_MS = 80;
/** 归位粒子（发动机没有粒子系统，spec §5-① 降级为 3 个自绘圆点） */
export const PARTICLE_COUNT = 3;
export const PARTICLE_RADIUS = 2;
export const PARTICLE_FLY = 12;
export const PARTICLE_MS = 120;

// ---------- ④ 落位错误 ----------

export const REJECT_MS = 240;
export const REJECT_CHROMATIC_MS = 160;
export const REJECT_CHROMATIC_PX = 3;
export const REJECT_CHROMATIC_ALPHA = 0.55;
export const REJECT_SHAKE_PX = 3;
export const REJECT_SHAKE_MS = 120;
export const REJECT_FLASH_MS = 60;
/** 浅底上 alpha 0.10 的朱砂闪看不见，按方案 §2.5 提到 0.16 */
export const REJECT_FLASH_ALPHA = 0.16;
/** 单格闪红：2 × 60ms（不能用 drawFlash，那是全屏） */
export const REJECT_CELL_ALPHA = 0.55;
export const REJECT_CELL_MS = 120;

// ---------- ⑤ 熨烫扫过 ----------

/** 未烫 / 已烫 / 烫糊三色见 `skin.ts`（spec ⑤⑦） */
export const IRON_DONE_MS = 120;
/** 熨烫板跟随弹簧：k=900 c=60 m=1 → ω₀=30、ζ=1（临界阻尼，唯一「跟得住又不甩」的区间） */
export const PLATE_SPRING = { stiffness: 900, damping: 60, mass: 1 } as const;
export const PLATE_GLOW_INTENSITY = 0.35;
export const PLATE_HEAT_ALPHA = 0.1;

// ---------- ⑥ 温度窗三态 ----------

/** 温度窗三态颜色见 `skin.ts` */
/** 琥珀脉冲周期 400ms ±12 级；超温脉冲 300ms ±20 级 */
export const TEMP_WARN_PULSE_MS = 400;
export const TEMP_WARN_PULSE_AMP = 12;
export const TEMP_HOT_PULSE_MS = 300;
export const TEMP_HOT_PULSE_AMP = 20;
/** 温度条数值平滑（帧率无关的比例） */
export const TEMP_SMOOTH = 0.18;
/** 超温叠加危险条纹（spec ⑥） */
export const HOT_SCANLINE = { gap: 6, thickness: 2, alpha: 0.1 } as const;

// ---------- ⑦ 烫糊（含累积告警） ----------

/** 单格：变色 120ms in + 溶解 0→0.60 共 480ms in（延迟 40ms 起） */
export const BURN_FADE_MS = 120;
export const BURN_DISSOLVE = 0.6;
export const BURN_DISSOLVE_MS = 480;
export const BURN_DISSOLVE_DELAY_MS = 40;
/** 累积告警：spec 写「> 30% 全局告警」，但 > 30% 就是当场判失败 —— 那个阈值永远看不见。
 *  所以拆两档：18% 起预警（琥珀暗角，玩家还来得及救），30% 起危险（朱砂暗角 + 震屏）。 */
export const ALERT_WARN_RATE = 0.18;
export const ALERT_DANGER_RATE = 0.3;
export const ALERT_WARN_VIGNETTE = 0.3;
export const ALERT_DANGER_VIGNETTE = 0.55;
export const ALERT_MS = 240;
export const ALERT_SHAKE_PX = 2;
export const ALERT_SHAKE_ROT = 0.6;
export const ALERT_SCANLINE = { gap: 6, thickness: 2, alpha: 0.12 } as const;

/** 全屏闪（④ 放错）：朱砂，alpha 0→0.10→0，60ms；颜色见 `skin.ts` REJECT_FLASH_COLOR */

/** hex → [r,g,b]；坏值回落到中性灰，不抛 */
export const parseHex = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (m === null) return [136, 136, 136];
  const v = Number.parseInt(m[1]!, 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
};

/** 两色线性插值（t 钳到 0..1） */
export const mixColor = (from: string, to: string, t: number): string => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const a = parseHex(from);
  const b = parseHex(to);
  const to2 = (n: number): string => (n < 16 ? '0' : '') + Math.round(n).toString(16);
  return '#' + to2(a[0] + (b[0] - a[0]) * k) + to2(a[1] + (b[1] - a[1]) * k) + to2(a[2] + (b[2] - a[2]) * k);
};

/** 缓动：out = cubic-bezier(0,0,0.2,1) 的多项式近似（同 `core/tween` 的 out 手感） */
export const easeOut = (t: number): number => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - Math.pow(1 - k, 3);
};

/** 缓动：in（溶解 / 暗角收缩用） */
export const easeIn = (t: number): number => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return k * k * k;
};

/** 连击对应的光晕峰值（combo 从 1 起；≥4 封顶 2.60） */
export const comboPeak = (combo: number): number => {
  if (!Number.isFinite(combo) || combo < 1) return COMBO_PEAK[0];
  const i = Math.min(COMBO_PEAK.length - 1, Math.floor(combo) - 1);
  return COMBO_PEAK[i]!;
};

/** 锁定高光强度：0 → peak（80ms out）→ 0（80ms in）；超出 160ms 返回 0 */
export const lockIntensityAt = (combo: number, ageMs: number): number => {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  const peak = comboPeak(combo);
  if (ageMs <= LOCK_UP_MS) return peak * easeOut(ageMs / LOCK_UP_MS);
  if (ageMs >= LOCK_UP_MS + LOCK_DOWN_MS) return 0;
  return peak * (1 - easeIn((ageMs - LOCK_UP_MS) / LOCK_DOWN_MS));
};

/** 归位粒子的扩散距离与透明度（3 颗，12px，120ms） */
export const particleAt = (ageMs: number, index: number): { dx: number; dy: number; alpha: number } => {
  const t = ageMs <= 0 ? 0 : ageMs >= PARTICLE_MS ? 1 : ageMs / PARTICLE_MS;
  const ang = (-Math.PI / 2) + (index - (PARTICLE_COUNT - 1) / 2) * 0.9;
  const d = PARTICLE_FLY * easeOut(t);
  return { dx: Math.cos(ang) * d, dy: Math.sin(ang) * d, alpha: 0.9 * (1 - t) };
};

/** 熨烫单格颜色：未烫 → 暖褐（120ms standard）；烫糊 → 焦褐（120ms in） */
export const ironCellColor = (doneTint: string, cell: number, ageMs: number): string => {
  if (cell === 2) {
    const t = Number.isFinite(ageMs) ? ageMs / BURN_FADE_MS : 1;
    return mixColor(IRON_COLD, IRON_BURN, easeIn(t));
  }
  if (cell === 1) {
    const t = Number.isFinite(ageMs) ? ageMs / IRON_DONE_MS : 1;
    return mixColor(IRON_COLD, doneTint, easeOut(t));
  }
  return IRON_COLD;
};

/** 烫糊单格「烧掉」的进度 0..0.60（120ms 变色后、延迟 40ms 起，480ms in） */
export const burnDissolveAt = (ageMs: number): number => {
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 0;
  const t = (ageMs - BURN_DISSOLVE_DELAY_MS) / BURN_DISSOLVE_MS;
  return BURN_DISSOLVE * easeIn(t);
};

/** 确定性哈希（0..1）：同一格同一帧永远一样，可复现、不用 Math.random */
export const hash01 = (n: number): number => {
  const s = Math.sin(Number.isFinite(n) ? n : 0) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * 烫糊格要「烧掉」的小块（替代 `drawWithDissolve`）。
 *
 * 为什么不用原语：`drawWithDissolve` 走 `destination-out`，会擦掉**整张画布**已有像素
 * （它自己的文件头就写了这条），单格用会把底下的盘面和背景一起擦穿成「画面破洞」。
 * 隔离层需要离屏 canvas，而 `document.createElement` 是 Web 专属能力（小游戏没有）——
 * 引擎目前没有跨端离屏画布，硬用就违反「平台差异只在 platform/」。
 * 所以这里用**同一套确定性噪声网格**，改成「用背景色盖掉」：视觉上就是格子被烧穿，
 * 但只影响这一格自己的像素。
 */
export const burnPatches = (
  rect: { x: number; y: number; w: number; h: number },
  progress: number,
  cols = 4,
  rows = 4,
): { x: number; y: number; w: number; h: number }[] => {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  if (!(p > 0) || !(rect.w > 0) || !(rect.h > 0)) return [];
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (hash01(col * 7.13 + row * 31.7) < p) {
        out.push({ x: rect.x + (col * rect.w) / cols, y: rect.y + (row * rect.h) / rows, w: rect.w / cols + 0.5, h: rect.h / rows + 0.5 });
      }
    }
  }
  return out;
};

/** 温度条的脉冲亮度偏移（级，可正负）：琥珀 ±12/400ms，超温 ±20/300ms，绿窗 0 */
export const tempPulse = (state: 'cold' | 'warn' | 'ok' | 'hot', clockMs: number): number => {
  const t = Number.isFinite(clockMs) ? clockMs : 0;
  if (state === 'hot') return Math.sin((t / TEMP_HOT_PULSE_MS) * Math.PI * 2) * TEMP_HOT_PULSE_AMP;
  if (state === 'warn' || state === 'cold') return Math.sin((t / TEMP_WARN_PULSE_MS) * Math.PI * 2) * TEMP_WARN_PULSE_AMP;
  return 0;
};

/** 把亮度偏移加到颜色上（钳 0..255） */
export const shiftColor = (hex: string, delta: number): string => {
  const [r, g, b] = parseHex(hex);
  const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  const to2 = (v: number): string => (v < 16 ? '0' : '') + clamp(v).toString(16);
  return '#' + to2(r + delta) + to2(g + delta) + to2(b + delta);
};
