/**
 * 运行时调试入口（8a 期）。
 *
 * 用法（游戏侧只有三行）：
 * ```ts
 * const session = installRuntimeDebug(platform);
 * const game = createGame(session?.platform ?? platform);
 * session?.attach(game);
 * ```
 *
 * **生产构建完全不进包**：`installRuntimeDebug` 里用 `import.meta.env.DEV` 判断，
 * 构建时该表达式被替换成 `false`，`if (false) start(...)` 整块被折叠，
 * 于是 `startRuntimeDebug` 不再被引用，整个 debug 目录随 tree-shaking 消失。
 * 验收方式是构建后 `grep -c WebSocket build/web/game.js` 必须为 0。
 */

import type { PlatformAdapter, GameCanvas } from '../platform/contract';
import { createBridge } from './bridge';
import { wrapRecorder } from './recorder';
import type { Bridge, CommandHandlers, HelloPayload, Recorder } from './contract';

/** 游戏侧注册给 `state()` 的快照来源。返回纯 JSON（MCP 侧要序列化）。 */
export interface DebugSnapshot {
  /** 业务状态快照；不传则 `state()` 返回「游戏没有注册快照」。 */
  readonly state?: () => unknown;
  /** 布局树；8a 期只放着，`tree()` 会一起返回，方便和绘制矩形对比。 */
  readonly layout?: () => unknown;
}

export interface RuntimeDebugOptions {
  /** 服务端地址，默认 `ws://127.0.0.1:7788` */
  readonly url?: string;
  /** 事件日志回调，默认 console.info；测试可注入收集器。 */
  readonly onEvent?: (event: string, detail?: string) => void;
}

/** 调试会话：`platform` 必须用这里返回的（它的 canvas 已被记录器包住）。 */
export interface DebugSession {
  readonly platform: PlatformAdapter;
  readonly recorder: Recorder;
  readonly bridge: Bridge;
  /** 把游戏的只读观察点接上（state / layout 快照）。可重复调用，后者覆盖前者。 */
  attach(snapshot: DebugSnapshot): void;
  dispose(): void;
}

const DEFAULT_URL = 'ws://127.0.0.1:7788';

/** 工具名清单：hello 里上报，服务端据此声明 MCP 工具。 */
export const DEBUG_TOOLS = ['canvas', 'tree', 'state', 'screenshot', 'click'] as const;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** web 画布对象：只用到 boundingClientRect 与 toDataURL，其余不收窄。 */
interface CanvasElement {
  getBoundingClientRect?: () => { readonly left: number; readonly top: number };
  toDataURL?: (type?: string) => string;
  dispatchEvent?: (event: Event) => boolean;
}

const canvasElementOf = (canvas: GameCanvas): CanvasElement | null => {
  const native = canvas.native;
  if (typeof native !== 'object' || native === null) return null;
  return native as CanvasElement;
};

/** 派发一次真实的 pointerdown + pointerup（走平台监听器，不是直接调游戏函数）。 */
function dispatchClick(adapter: PlatformAdapter, x: number, y: number): void {
  const el = canvasElementOf(adapter.canvas);
  if (el === null || typeof el.dispatchEvent !== 'function') {
    throw new Error('当前平台画布不支持事件派发：click 只在 web 端可用');
  }
  const Ctor = (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent;
  if (Ctor === undefined) {
    throw new Error('当前浏览器不支持 PointerEvent：无法注入真实点击');
  }
  const box = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : { left: 0, top: 0 };
  // 逻辑像素 == 画布 CSS 像素（平台层 screen.width 就是 CSS 宽度），
  // 所以逻辑坐标 + 画布在视口中的偏移 = DOM 的 client 坐标。
  const clientX = box.left + x;
  const clientY = box.top + y;
  const make = (type: string): PointerEvent =>
    new Ctor(type, {
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerdown' ? 1 : 0,
    });
  el.dispatchEvent(make('pointerdown'));
  el.dispatchEvent(make('pointerup'));
}

/** 真正的装配（只有 dev 会走到这里）。 */
function startRuntimeDebug(base: PlatformAdapter, options: RuntimeDebugOptions): DebugSession {
  /**
   * 首次连上之前不打印 error / close。
   *
   * 为什么：本地没起调试 MCP 是**常态**（玩游戏时谁开 MCP），而 bridge 每 1s 重连一次，
   * 每次失败都打 `[mg-debug] error` + `[mg-debug] close`，DevTools 控制台瞬间被红字刷满，
   * 看起来像游戏坏了。连上之后这些事件照常打印（那时候断线才是真信息）。
   */
  let everConnected = false;
  const report = (event: string, detail?: string): void => {
    if (event === 'open') everConnected = true;
    if (!everConnected) return;
    if (options.onEvent !== undefined) options.onEvent(event, detail);
    else console.info(`[mg-debug] ${event}${detail === undefined ? '' : `：${detail}`}`);
  };

  const rawContext = base.canvas.getContext('2d');
  if (rawContext === null) throw new Error('画布没有 2d 上下文：无法安装绘制记录器');

  const recorder = wrapRecorder(rawContext, { capacity: 180, dpr: base.screen.dpr });

  // 只替换 canvas.getContext：其余成员原样透传。用 Proxy 而不是展开对象，
  // 这样平台适配器里的方法（onPointer 等）的 this 不会丢。
  const platform = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'canvas') {
        return new Proxy(target.canvas, {
          get(canvasTarget, canvasProp, canvasReceiver) {
            if (canvasProp === 'getContext') return () => recorder.ctx;
            return Reflect.get(canvasTarget, canvasProp, canvasReceiver);
          },
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  let snapshot: DebugSnapshot = {};

  const handlers: CommandHandlers = {
    canvas(): unknown {
      const stats = recorder.stats();
      const screen = base.screen;
      const canvasSize = { width: base.canvas.width, height: base.canvas.height };
      return {
        screen: { width: screen.width, height: screen.height, dpr: screen.dpr, orientation: screen.orientation },
        canvas: canvasSize,
        fps: stats.fps,
        drawsPerFrame: stats.drawsPerFrame,
        frameMs: stats.frameMs,
        retained: stats.retained,
        recording: stats.enabled,
      };
    },
    tree(params: Record<string, unknown>): unknown {
      const limit = typeof params.limit === 'number' && params.limit > 0 ? Math.floor(params.limit) : 1;
      const frames = recorder.recent(limit);
      const latest = frames[frames.length - 1] ?? null;
      return {
        frames,
        latest,
        layout: snapshot.layout === undefined ? null : snapshot.layout(),
      };
    },
    state(): unknown {
      if (snapshot.state === undefined) return { ok: false, error: '游戏没有注册状态快照：attach({ state }) 才能用 state()' };
      return { ok: true, state: snapshot.state() };
    },
    screenshot(): unknown {
      const el = canvasElementOf(base.canvas);
      if (el === null || typeof el.toDataURL !== 'function') throw new Error('当前平台画布不支持 toDataURL');
      const dataUrl = el.toDataURL('image/png');
      const prefix = 'base64,';
      const at = dataUrl.indexOf(prefix);
      return {
        width: base.canvas.width,
        height: base.canvas.height,
        format: 'png',
        data: at >= 0 ? dataUrl.slice(at + prefix.length) : dataUrl,
      };
    },
    click(params: Record<string, unknown>): unknown {
      const x = typeof params.x === 'number' ? params.x : null;
      const y = typeof params.y === 'number' ? params.y : null;
      if (x === null || y === null) throw new Error('click 需要 x / y（逻辑像素，左上角原点）');
      dispatchClick(base, x, y);
      return { clicked: true, x, y };
    },
  };

  const hello: HelloPayload = {
    platform: base.name,
    screen: { width: base.screen.width, height: base.screen.height, dpr: base.screen.dpr },
    tools: [...DEBUG_TOOLS],
  };

  const bridge = createBridge({ url: options.url ?? DEFAULT_URL, hello, handlers, onEvent: report });

  return {
    platform,
    recorder,
    bridge,
    attach(next: DebugSnapshot): void {
      snapshot = next;
    },
    dispose(): void {
      bridge.close();
    },
  };
}

/**
 * 安装运行时调试。**生产构建里这个函数体只剩 `return null`**，整块被剔除。
 */
export const installRuntimeDebug = (
  platform: PlatformAdapter,
  options: RuntimeDebugOptions = {},
): DebugSession | null => {
  if (import.meta.env.DEV) return startRuntimeDebug(platform, options);
  return null;
};

export { wrapRecorder } from './recorder';
export { createBridge } from './bridge';
export type { Bridge, DrawCall, DrawKind, DrawRect, FrameSnapshot, Recorder, RecorderStats } from './contract';
