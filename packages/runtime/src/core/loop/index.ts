/**
 * 固定步长主循环实现。
 *
 * 算法：累加帧间隔 → 按 step 切出整数步 update → 余数留作渲染插值。
 * 两个保护：单帧最大间隔（切后台回来不跳时间）、单帧最大补步数（不雪崩）。
 */

import type {
  CreateLoop,
  FrameScheduler,
  Loop,
  LoopOptions,
  Tick,
  TickParams,
  TickResult,
  TickState,
} from './contract';

/** 默认固定步长：60Hz */
export const DEFAULT_STEP = 1 / 60;
/** 默认单帧最大间隔：0.25 秒（约 4 帧） */
export const DEFAULT_MAX_FRAME_TIME = 0.25;
/** 默认单帧最多补 3 步 */
export const DEFAULT_MAX_SUB_STEPS = 3;

/** 浮点容差：避免 0.9999999 被截成 59 步 */
const EPSILON = 1e-9;

function resolveParams(input?: Partial<TickParams>): TickParams {
  return {
    step: input?.step !== undefined && input.step > 0 ? input.step : DEFAULT_STEP,
    maxFrameTime:
      input?.maxFrameTime !== undefined && input.maxFrameTime >= 0
        ? input.maxFrameTime
        : DEFAULT_MAX_FRAME_TIME,
    maxSubSteps:
      input?.maxSubSteps !== undefined && input.maxSubSteps >= 0
        ? Math.floor(input.maxSubSteps)
        : DEFAULT_MAX_SUB_STEPS,
  };
}

/** 纯函数：推进一帧。 */
export const tick: Tick = (
  state: TickState,
  nowMs: number,
  params?: Partial<TickParams>,
): TickResult => {
  const p = resolveParams(params);

  // 时间戳异常（NaN / Infinity）：不推进，保持原状态，防污染累加器
  if (!Number.isFinite(nowMs)) {
    return { state, steps: 0, alpha: 0, frameTime: 0 };
  }

  // 首帧：只记录起点，不 update 也不 render（还没有可插值的上一帧）
  if (state.prev === null) {
    return { state: { acc: 0, prev: nowMs }, steps: 0, alpha: 0, frameTime: 0 };
  }

  let frameTime = (nowMs - state.prev) / 1000;
  // 时间倒退（系统改时间 / 浮点误差）：按 0 处理
  if (!Number.isFinite(frameTime) || frameTime < 0) frameTime = 0;
  // 上限保护
  if (frameTime > p.maxFrameTime) frameTime = p.maxFrameTime;

  let acc = state.acc + frameTime;
  let steps = Math.floor(acc / p.step + EPSILON);

  if (steps > p.maxSubSteps) {
    // 超出上限：只补上限步数，多余时间丢弃（保留相位），否则下一帧继续欠账 → 雪崩
    steps = p.maxSubSteps;
    acc = acc % p.step;
  } else {
    acc -= steps * p.step;
  }

  // 浮点误差兜底：acc 归一到 [0, step)
  if (acc < 0) acc = 0;
  if (acc >= p.step) acc = acc % p.step;

  return { state: { acc, prev: nowMs }, steps, alpha: acc / p.step, frameTime };
};

/** 默认调度器：setTimeout 16ms（约 60fps）。三端都有 setTimeout。 */
const defaultScheduler: FrameScheduler = (cb) => {
  const timer = setTimeout(() => cb(Date.now()), 16);
  return () => {
    clearTimeout(timer);
  };
};

export const createLoop: CreateLoop = (opts: LoopOptions): Loop => {
  const params = resolveParams(opts);
  const schedule = opts.schedule ?? defaultScheduler;
  const now = opts.now ?? ((): number => Date.now());

  let state: TickState = { acc: 0, prev: null };
  let running = false;
  let cancel: (() => void) | null = null;

  const frame = (nowMs: number): number => {
    const result = tick(state, nowMs, params);
    const wasFirst = state.prev === null;
    state = result.state;

    if (result.steps > 0) {
      for (let i = 0; i < result.steps; i += 1) opts.update(params.step);
    }
    // 首帧没有可画的内容（也没有插值基准），其余每帧都画。
    // alpha 是渲染插值系数（0..1）：**消费者是 core/tween**——
    // 补间在 update 里按整步推进，渲染时用 alpha 在「上一值」与「当前值」之间插值，
    // 固定 60Hz 步长在更高刷新率的屏幕上才不会一格一格地跳（见 core/tween/index.ts）。
    if (!wasFirst) opts.render(result.alpha);
    return result.steps;
  };

  const scheduleNext = (): void => {
    if (!running) return;
    cancel = schedule((t) => {
      frame(t);
      scheduleNext();
    });
  };

  const start = (): void => {
    if (running) return;
    running = true;
    state = { acc: 0, prev: null };
    scheduleNext();
  };

  const stop = (): void => {
    if (!running) return;
    running = false;
    if (cancel) {
      cancel();
      cancel = null;
    }
  };

  return {
    start,
    stop,
    get running(): boolean {
      return running;
    },
    frame,
    get state(): TickState {
      return state;
    },
    params,
  };
};
