/**
 * 补间（动效）契约。
 *
 * 为什么要有它：框架原来只有「每帧把静态图画到固定位置」——没有时间、没有插值，
 * 所以游戏里所有状态变化都是瞬时的（按钮按下硬切、包裹凭空出现、结算直接铺出）。
 * 这份契约把「怎么动」一次性定死：曲线、时长、关键帧、弹簧，全部走这里的表，
 * **不许各游戏自己写缓动函数**（9 款游戏 9 套曲线 = 又一次没规范）。
 *
 * 数值全部来自团队动效规范 `docs/motion.md` v1.0（design-bot 维护），
 * 由 `design_animation` / `math_calc` 算出并回代验证。本文件里的数字**不许自创**。
 *
 * 硬边界（规范 §0）：
 * - 动效只改「画什么、画在哪」，不改玩法判定、不改命中区域；
 * - 动效不阻塞输入：重复触发时**替换**当前动效，不排队；
 * - 动效必须可降级：同一套状态能画成静态终态，不报错、不残影。
 *
 * 变更记录：
 * - 2026-10-20（维护者 拍板）：**删掉 `MOTION.squash`**（连带 1.098 / 0.902 / 220ms 那组）。
 *   理由是**职责错位**：runtime 常量表的职责是「通用原语」——时长档位、缓动曲线、
 *   弹簧参数；`squash` 是「包裹落位」这个**具体业务的表现参数**，不是原语。
 *   留在 runtime 的长期后果：第二个游戏想要不同的落位形变，要么改 runtime 契约
 *   （走冻结流程），要么绕开自己定义一套 —— 又回到「每个游戏各写一套」的老路，
 *   这跟当初加 `core/tween` 的初衷相反。落位形变的真源因此落到游戏侧
 *   （《快递装车员》`src/app/motion/timelines.ts` 的 `LANDING`）。
 */

/**
 * 团队动效常量 —— 抄自 docs/motion.md v1.0 §9，不要私自改数值。
 *
 * 出处：
 * - ms：`design_animation(op=duration_scale, baseDuration=120, ratio=2)`；
 * - ease：`design_animation(op=easing)`（cubic-bezier 精确值）；
 * - spring：`design_animation(op=spring)`，特征根已回代验证 σ² + ωd² − ω₀² = 0；
 * - shake：峰值速度 2πfA = 502.65 px/s（math_calc 验算）。
 *
 * 这里只放**原语**（跨游戏通用）：时长档位、曲线、弹簧、错峰、抖动。
 * 业务专属的表现参数（如「包裹落位」的形变幅度）不进这张表 —— 见文件头变更记录。
 */
export const MOTION = {
  /** 时长梯度（ms）｜ duration_scale(base=120, ratio=2) */
  ms: {
    instant: 60, // T0 瞬时反馈：按钮按下
    micro: 120, // T1 微交互：卡片选中
    state: 240, // T2 状态过渡：面板/阶段切换
    emphasis: 480, // T3 强调：结算
  },

  /** 缓动曲线（cubic-bezier 精确值）｜ design_animation(op=easing) */
  ease: {
    in: 'cubic-bezier(0.4, 0, 1, 1)', // y(0.5)=0.324815
    standard: 'cubic-bezier(0.4, 0, 0.2, 1)', // y(0.5)=0.775561
    out: 'cubic-bezier(0, 0, 0.2, 1)', // y(0.5)=0.839245
    back: 'cubic-bezier(0.34, 1.56, 0.64, 1)', // 中点 1.087401 / 全局峰值 1.097804
  },

  /** 弹簧（k=刚度 c=阻尼 m=质量）｜ design_animation(op=spring) */
  spring: {
    tap: { stiffness: 1400, damping: 52, mass: 1 }, // ω₀≈37.4166 ζ≈0.694879 过冲 4.80% 稳定 115.22ms
    settle: { stiffness: 900, damping: 39, mass: 1 }, // ω₀=30 ζ=0.65 过冲 6.81% 稳定 153.63ms
  },

  /** 错峰入场（ms/项）｜ design_animation(op=stagger, step=60) */
  stagger: { step: 60, max: 4 }, // 4 项 → 0/60/120/180ms

  /** 屏幕抖动（撞击反馈） */
  shake: { amplitude: 4, frequency: 20, duration: 180 }, // 峰值速度 502.65 px/s
} as const;

/** 缓动曲线控制点（CSS cubic-bezier 同形：x1,y1,x2,y2）。 */
export interface BezierCurve {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** 团队规范里的四条曲线名（docs/motion.md §4）。 */
export type EasingName = 'in' | 'standard' | 'out' | 'back';

/**
 * 一条缓动曲线。
 *
 * 两种求值口径都要有：
 * - `at(progress)`：按**进度**求值（解 x(t)=p，返回 y(t)）—— 业务用这个；
 * - `atParam(t)`：按**参数 t** 求值，不反解 —— 峰值自检与设计自检用这个
 *   （back-out 的全局峰值 1.0978035 出现在参数 t = 39/67，对应进度 0.5727948）。
 */
export interface EasingSample {
  readonly name: EasingName;
  readonly curve: BezierCurve;
  /** 按进度 p（0..1）求值。p<0 → 0，p>1 → 1。 */
  readonly at: (progress: number) => number;
  /** 按参数 t（0..1）求值 y(t)。 */
  readonly atParam: (t: number) => number;
  /** 参数 t 对应的进度 x(t)。 */
  readonly progressAt: (t: number) => number;
}

/** 关键帧时间线：多段、每段可换缓动（M-03 落位形变就是这种）。 */
export interface Keyframe {
  /** 相对起点的毫秒 */
  readonly at: number;
  readonly value: number;
  /**
   * 从**本帧到下一帧**这一段用的缓动；最后一个关键帧忽略此字段。
   * 例：落位形变 0→110ms 用 'out'、110→220ms 用 'standard'。
   */
  readonly easing: EasingName;
}

export interface Timeline {
  /** 总时长（毫秒） */
  readonly duration: number;
  readonly keyframes: readonly Keyframe[];
}

/** 弹簧参数（k=刚度 c=阻尼 m=质量）。 */
export interface SpringConfig {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

/** 弹簧的解析属性（由 k/c/m 推出，不手填）。 */
export interface Spring extends SpringConfig {
  /** 无阻尼固有角频率 ω₀（rad/s） */
  readonly omega0: number;
  /** 阻尼比 ζ */
  readonly zeta: number;
  /** 峰值过冲比例（欠阻尼时 > 0） */
  readonly overshoot: number;
  /** 2% 稳定时间（秒） */
  readonly settleSeconds: number;
  /** 是否欠阻尼（有过冲） */
  readonly underdamped: boolean;
}

/**
 * 一个补间：标量从 from 走到 to。
 *
 * 时间单位：duration / delay / elapsed 都是**毫秒**；
 * 唯独弹簧采样用**秒**（k/c/m 是物理量纲，时间单位是秒）——别混。
 */
export interface TweenOptions {
  readonly from: number;
  readonly to: number;
  /** 时长（毫秒），取 MOTION.ms 四档之一 */
  readonly duration: number;
  readonly easing?: EasingName;
  /** 起始延迟（毫秒） */
  readonly delay?: number;
  /** 循环播放（用于常驻脉动） */
  readonly loop?: boolean;
}

export interface Tween {
  readonly key: string;
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly delay: number;
  readonly easing: EasingName;
  readonly loop: boolean;
  /** 已过毫秒（含 delay 段） */
  readonly elapsed: number;
  /** 当前值 */
  readonly value: number;
  /** 上一推进步的值（渲染插值用） */
  readonly previous: number;
  /** 是否已走完（loop 的 tween 永不为 true） */
  readonly done: boolean;
  /** 推进 dt 毫秒 */
  advance(dtMs: number): void;
  /**
   * 打断重定向：从**当前值**出发走到新目标，耗时 durationMs。
   * 规范 §0：重复触发时替换当前动效，不排队。
   */
  redirect(to: number, durationMs: number, easing?: EasingName): void;
}

/**
 * 补间容器：按 key 管理一组补间。
 *
 * 为什么按 key：同一元素被重复触发时应该**替换**当前动效（规范 §0），
 * 而不是排队。key 由业务给（通常就是元素 id + 通道名）。
 */
export interface TweenRunner {
  /** 新建或替换一个补间（同 key 直接替换，不排队）。 */
  set(key: string, opts: TweenOptions): Tween;
  get(key: string): Tween | null;
  /** 当前值；没有这个 key 返回 null */
  value(key: string): number | null;
  /**
   * 用渲染插值系数取当前值：lerp(previous, value, alpha)。
   *
   * 为什么要 alpha：主循环是固定步长（60Hz），而屏幕刷新率可能不是 60。
   * 补间在 update 里按整步推进，渲染时用 alpha 在「上一值」与「当前值」之间插值，
   * 动效才不会一格一格地跳（这就是 core/loop 那个 alpha 一直没人消费的原因）。
   */
  sample(key: string, alpha: number): number | null;
  remove(key: string): void;
  clear(): void;
  /** 推进 dt 毫秒（把所有补间推进一步） */
  advance(dtMs: number): void;
  /**
   * 还在跑的补间数量。
   *
   * 已完成的补间**仍留在容器里**（终值要能读到 —— 元素不能因为动画结束
   * 就跳回默认值），但不再计入 activeCount。
   */
  readonly activeCount: number;
  /** 更新档位：ORDER.animation（300）—— 框架侧挂 System 时用这个 */
  readonly order: number;
}

export type CreateTweenRunner = () => TweenRunner;

/** 采样一条缓动曲线（按进度）。 */
export type SampleEasing = (name: EasingName, progress: number) => number;

/** 按参数 t 采样一条缓动曲线（峰值自检用）。 */
export type SampleEasingParam = (name: EasingName, t: number) => number;

/** 采样关键帧时间线。 */
export type SampleTimeline = (timeline: Timeline, elapsedMs: number) => number;

/** 采样弹簧（t 单位：秒；from=0、to=1 的归一化值）。 */
export type SampleSpring = (spring: Spring, tSeconds: number) => number;

/** 由 k/c/m 推出弹簧的解析属性。 */
export type CreateSpring = (config: SpringConfig) => Spring;
