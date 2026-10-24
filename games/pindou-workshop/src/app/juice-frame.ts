/**
 * 动效快照的类型与帧率无关的小工具（`juice.ts` 产出、`render-fx.ts` 消费）。
 *
 * 为什么单独成文件：快照字段一多，`juice.ts` 就顶到单文件 300 行上限（AGENTS 铁律 2），
 * 而「快照长什么样」和「状态机怎么推进」本来就是两件事。
 */

/** 渲染层要的东西：一份只读快照（每帧最后算一次） */
export interface JuiceFrame {
  /** ① 拿起放大倍率 1..1.25 */
  readonly pickScale: number;
  /** ② 正在拖的色块颜色；-1 = 没在拖 */
  readonly dragColor: number;
  /** ② 目标区高亮强度（0.55 常态 / 1.30 悬停） */
  readonly highlight: number;
  /** ② 悬停到的同色空格下标；-1 = 没有 */
  readonly hoverCell: number;
  /** ③ 正在闪的锁定高光（含连击强度） */
  readonly locks: readonly { readonly cell: number; readonly intensity: number; readonly combo: number; readonly ageMs: number }[];
  /** ④ 弹回的「残影」色块（位置已插值到 240ms 曲线上的点） */
  readonly ghost: { readonly x: number; readonly y: number; readonly s: number; readonly color: number } | null;
  /** ④ 错误格闪红：格下标 / 透明度 */
  readonly rejectCell: number;
  readonly rejectCellAlpha: number;
  /** ④ 色差抖动像素（0..3） */
  readonly chromatic: number;
  /** ④ 全屏闪透明度（0..0.10） */
  readonly flash: number;
  /** ④/⑦ 震屏：振幅 px、旋转度、种子 */
  readonly shake: number;
  readonly shakeRot: number;
  readonly shakeSeed: number;
  /** ⑤ 弹簧跟随后的熨烫板格坐标 */
  readonly plate: { readonly gx: number; readonly gy: number } | null;
  /** ⑥ 平滑后的温度（温度条指针用） */
  readonly temp: number;
  /** ⑦ 累积告警暗角强度 0..0.55 */
  readonly alert: number;
  /** ⑦ 是否进危险档（> 30%） */
  readonly alertHot: boolean;
  /** 动效时钟（ms）：脉冲相位基准 */
  readonly clockMs: number;
}

export const EMPTY_FRAME: JuiceFrame = {
  pickScale: 1, dragColor: -1, highlight: 0, hoverCell: -1, locks: [], ghost: null,
  rejectCell: -1, rejectCellAlpha: 0, chromatic: 0, flash: 0,
  shake: 0, shakeRot: 0, shakeSeed: 0,
  plate: null, temp: 0, alert: 0, alertHot: false, clockMs: 0,
};

/** ④ 回弹用的 `back` 曲线：峰值 1.0978（= spec 的 9.78% 过冲），t=1 归到 1 */
export const easeBack = (t: number): number => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const c = 1.70158;
  const u = k - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/** 帧率无关的指数逼近：k = 1 - (1 - perFrame) ^ (dt*60) */
export const smooth = (cur: number, target: number, perFrame: number, dt: number): number => {
  const k = 1 - Math.pow(1 - perFrame, dt * 60);
  return cur + (target - cur) * k;
};

