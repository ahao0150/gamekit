/**
 * 固定步长主循环契约。
 *
 * 为什么固定步长：物理与碰撞在变帧率下会漂移，1/60 固定步长让「同一份逻辑
 * 在任何机器上结果一致」。渲染用 alpha 插值消掉固定步长带来的抖动。
 *
 * 为什么 tick 是纯函数：单测不能等 rAF。`tick(state, nowMs)` 输入旧状态 +
 * 时间戳，返回新状态与本帧应补的步数，Node 里想推 1000 帧就推 1000 次。
 *
 * 为什么调度器要注入：core 里不许出现 `window.` / `wx.`，所以「下一帧什么时候来」
 * 由外部（平台层或测试）注入。默认实现用 setTimeout（三端都有）。
 */

/** 累加器状态。纯数据；`tick` 不修改它，返回新对象。 */
export interface TickState {
  /** 尚未消费的时间，单位秒；恒 < step */
  readonly acc: number;
  /** 上一帧的时间戳（ms）；null = 还没开始 */
  readonly prev: number | null;
}

/** 步长参数。 */
export interface TickParams {
  /** 固定步长（秒），默认 1/60 */
  readonly step: number;
  /** 单帧最大时间（秒），超出按此计算；默认 0.25，防切后台回来一次补几百步 */
  readonly maxFrameTime: number;
  /** 单帧最多补的固定步数，默认 3；超出部分直接丢弃（防雪崩） */
  readonly maxSubSteps: number;
}

/** 一次 tick 的结果。 */
export interface TickResult {
  /** 新状态，喂回下一次 tick */
  readonly state: TickState;
  /** 本帧应执行的 update 次数，范围 0..maxSubSteps */
  readonly steps: number;
  /** 渲染插值系数 0..1（不含 1），传给 render(alpha) */
  readonly alpha: number;
  /** 钳制后的帧间隔（秒），便于诊断掉帧 */
  readonly frameTime: number;
}

/**
 * 帧调度器：注册一次「下一帧」回调，返回取消函数。
 * 平台层可以注入 requestAnimationFrame / wx 的帧回调；测试注入手动队列。
 */
export type FrameScheduler = (cb: (nowMs: number) => void) => () => void;

export interface LoopOptions {
  /** 固定步长更新，dt 恒为 step */
  readonly update: (dt: number) => void;
  /** 每帧渲染，alpha 为 0..1 插值系数 */
  readonly render: (alpha: number) => void;
  readonly step?: number;
  readonly maxFrameTime?: number;
  readonly maxSubSteps?: number;
  /** 不注入则用 setTimeout(16ms) 驱动 */
  readonly schedule?: FrameScheduler;
  /** 时间源，默认 Date.now（三端都有） */
  readonly now?: () => number;
}

export interface Loop {
  start(): void;
  stop(): void;
  readonly running: boolean;
  /** 手动推进一帧（rAF 回调里调用）。返回本帧补的步数。 */
  frame(nowMs: number): number;
  /** 当前累加器状态快照 */
  readonly state: TickState;
  /** 实际生效的参数 */
  readonly params: TickParams;
}

export type CreateLoop = (opts: LoopOptions) => Loop;

/** 纯函数推进一帧。不依赖任何宿主 API，Node 可测。 */
export type Tick = (
  state: TickState,
  nowMs: number,
  params?: Partial<TickParams>,
) => TickResult;
