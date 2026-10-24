/**
 * 运行时调试的契约（8a 期）。
 *
 * 目标：把「AI 靠截图猜」变成「AI 读结构」。两条数据源必须分开记：
 * - **布局树**：应该在哪、多大（游戏侧 layout 纯函数算出来的）；
 * - **绘制记录**：实际画了什么、画在哪个矩形（dev 模式下包一层 ctx 记下来的）。
 *
 * 两者对比能直接定位三类 bug：算了没画 / 画了不该画 / 画了但错位。
 *
 * 设计约束（对应 PLAN 第 8 节）：
 * 1. `tree()` 返回纯 JSON，可序列化、可存档、可 diff；
 * 2. 生产构建完全剔除（调用点用 `import.meta.env.DEV` 包住，整块被 tree-shaking）；
 * 3. 只读为主，不提供改游戏状态的入口（click 走真实事件派发，不是直接调函数）。
 */

// ---------------------------------------------------------------------------
// 绘制记录
// ---------------------------------------------------------------------------

/** 逻辑像素矩形。与游戏绘制坐标系一致（左上角原点、真值不含 dpr）。 */
export interface DrawRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 一次绘制调用的类型。
 *
 * `image` / `rect` / `text` 是主力（背景图、格子、按钮文字分别落在这三类里）；
 * `fill` / `stroke` 是没有矩形语义的兜底（circle、line、渐变蒙版）；
 * `clear` 只记录发生了一次清屏。
 */
export type DrawKind = 'image' | 'rect' | 'text' | 'fill' | 'stroke' | 'clear';

/** 单次绘制记录。坐标已按当前变换矩阵换算成屏幕（逻辑像素）坐标。 */
export interface DrawCall {
  /** 帧内绘制序号，从 0 开始 —— 就是 z 序（Canvas 后画的盖住先画的）。 */
  readonly z: number;
  readonly kind: DrawKind;
  /** 目标矩形；没有矩形语义的绘制（fill 路径）为空。 */
  readonly rect?: DrawRect;
  /** 源矩形：drawImage 从图里取哪一块。整图绘制时等于整图尺寸。 */
  readonly source?: DrawRect;
  /** 资源标识：图集 key 优先，退化到图片文件名；画矩形时为空。 */
  readonly asset?: string;
  /** 文字内容（`kind === 'text'`）。 */
  readonly text?: string;
  /** 填充色 / 文字色（能拿到时）。 */
  readonly color?: string;
  /** 本次调用的耗时（ms）。dev 模式的性能诊断用，不要在生产里依赖它。 */
  readonly ms: number;
}

/** 一帧的绘制记录。帧边界由记录器按调用时间戳自动切分。 */
export interface FrameSnapshot {
  /** 帧序号，从 1 开始 */
  readonly frame: number;
  /** 该帧第一个绘制调用的时间戳（ms，`performance.now()` 口径） */
  readonly at: number;
  readonly calls: readonly DrawCall[];
  /** 该帧总耗时（ms）= 最后一次调用结束 − 第一次调用开始 */
  readonly ms: number;
}

// ---------------------------------------------------------------------------
// 记录器
// ---------------------------------------------------------------------------

/** 记录器状态快照（对应 `canvas()` 工具）。 */
export interface RecorderStats {
  /** 最近若干帧的平均帧率（按帧起始时间戳算，掉帧时偏低） */
  readonly fps: number;
  /** 最近一帧的绘制调用次数 */
  readonly drawsPerFrame: number;
  /** 最近一帧的绘制耗时（ms） */
  readonly frameMs: number;
  /** 当前保留的帧数（环形缓冲里还有多少帧可用） */
  readonly retained: number;
  /** 记录器是否开着（可运行时开关） */
  readonly enabled: boolean;
  /** 保留的帧数上限（环形缓冲，默认 180 帧 ≈ 3 秒） */
  readonly capacity: number;
}

export interface RecorderOptions {
  /** 帧容量上限，默认 180 */
  readonly capacity?: number;
  /**
   * 帧间隔阈值（ms）：两次绘制调用间隔超过它就认为是新的一帧。
   *
   * 为什么用时间戳而不是 hook 帧开始：游戏每帧的绘制入口（`render()`）没有任何
   * 「帧开始」标记，也不能为了调试去改玩法代码。帧内调用间隔通常 < 1ms，
   * 跨帧至少 8ms（120Hz），4ms 是安全的判别线。
   */
  readonly frameGapMs?: number;
  /**
   * 物理像素比。平台层用 `setTransform(dpr,...)` 建立物理像素坐标系，
   * 记录时除掉它才是**逻辑像素** —— 与布局树同一坐标系，才能直接 diff。
   * 默认 1（mock / 小游戏端本来就是逻辑像素）。
   */
  readonly dpr?: number;
}

/**
 * 绘制记录器。
 *
 * `ctx` 是包装后的上下文，交给游戏使用；原始上下文只由记录器持有。
 */
export interface Recorder {
  /** 包装后的 ctx：行为和原 ctx 完全一致，只是顺手记一笔。 */
  readonly ctx: Ctx2D;
  /** 最近一帧（可能正在写入中）。还没画过返回 null。 */
  latest(): FrameSnapshot | null;
  /** 最近 N 帧，旧 → 新。 */
  recent(limit?: number): readonly FrameSnapshot[];
  /** 统计信息（fps / 每帧绘制数 / 保留帧数）。 */
  stats(): RecorderStats;
  /** 运行时开关：关掉后不再记录，绘制行为不受影响。 */
  setEnabled(on: boolean): void;
  /** 清空已记录的帧（重新开始观察）。 */
  reset(): void;
  /** 当前保留的帧数上限。 */
  readonly capacity: number;
}

/**
 * `CanvasRenderingContext2D` 的最小结构。
 *
 * 直接复用 DOM 类型（与 `platform/contract.ts` 一致），这样不需要为三端再编一套
 * 方法表；测试里传 mock 时按 `unknown` 收窄即可。
 */
export type Ctx2D = CanvasRenderingContext2D;

export type WrapRecorder = (ctx: Ctx2D, options?: RecorderOptions) => Recorder;

// ---------------------------------------------------------------------------
// 与 MCP 服务端的通信协议
// ---------------------------------------------------------------------------

/** 游戏 → 服务端：客户端上线时上报的环境信息。 */
export interface HelloPayload {
  readonly platform: string;
  readonly screen: { readonly width: number; readonly height: number; readonly dpr: number };
  readonly tools: readonly string[];
}

/** 服务端 → 游戏：一次工具调用。 */
export interface CommandMessage {
  readonly id: number;
  readonly method: string;
  /** 参数按工具各自约定，收到后再收窄；不做全局 any。 */
  readonly params?: Record<string, unknown>;
}

/** 游戏 → 服务端：工具调用结果。 */
export interface ResultMessage {
  readonly id: number;
  readonly ok: boolean;
  readonly result?: unknown;
  /** 失败原因（中文，直接给人看）。 */
  readonly error?: string;
}

/** 建立连接后收到的命令分发器。返回值和抛错都会被包进 ResultMessage。 */
export type CommandHandlers = Record<string, (params: Record<string, unknown>) => unknown>;

/** WebSocket 客户端的连接状态，便于 `/healthz` 式诊断。 */
export type BridgeState = 'idle' | 'connecting' | 'open' | 'closed';

export interface Bridge {
  readonly state: BridgeState;
  /** 主动关闭，不再重连。 */
  close(): void;
  /** 发送一条原始 JSON 消息（调试用）。 */
  send(message: unknown): void;
}

export type CreateBridge = (options: {
  readonly url: string;
  readonly hello: HelloPayload;
  readonly handlers: CommandHandlers;
  /** 诊断回调：连接状态、收到的命令、错误都会走到这里。 */
  readonly onEvent?: (event: string, detail?: string) => void;
}) => Bridge;
