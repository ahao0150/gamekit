/**
 * 游戏装配：平台 → 布局引擎 → 渲染 → 输入。
 *
 * 输入走 `platform.onPointer` 的**真实事件**；命中判定交给 core 的 `pickHit`
 * （与绘制共用同一份由 `paintOrder` / `meta` 推出的顺序），代码里没有任何坐标常量。
 * 状态迁移是纯函数（state.ts 的 `reduce`）。
 *
 * 命中语义（`.ui` 的 `put ... hit`）：
 * - `null`      → 点空白，什么都不做
 * - `block`     → 遮罩 / loading 层吃掉点击，**不执行动作、也不继续往下找**
 * - `self`      → 有 action 才执行（`ACTION_OF` 里没绑就什么都不做）
 */

import { createLoop, pickHit } from './deps';
import type { Ctx2D, HitEntry, PlatformAdapter, PointerEvent, Rect } from './deps';
import { createLayoutEngine } from './layout';
import type { ScreenLayout } from './layout';
import { createRenderer } from './render';
import { ACTION_OF, INITIAL_STATE, reduce } from './state';
import type { GameState } from './state';

export interface Game {
  readonly state: GameState;
  /** 只读：当前界面布局（矩形是副本，外部改不到内部） */
  readonly layout: ScreenLayout;
  start(): void;
  stop(): void;
}

/**
 * 把 `ScreenLayout` 组装成命中层要的条目。
 *
 * `layer` 用 `meta.layerIndex`（base=0 / overlay=1），`index` 用同层声明序：
 * 与 `paintOrder` 同源，所以 `pickHit` 的逆序遍历严格等于「从最上面往下找」。
 */
const hitEntriesOf = (view: ScreenLayout): HitEntry[] => {
  const entries: HitEntry[] = [];
  for (const name of view.paintOrder) {
    const rect = view.rects[name];
    const meta = view.meta[name];
    if (rect === undefined || meta === undefined) continue;
    entries.push({ name, rect, hit: meta.hit, layer: meta.layerIndex, index: meta.index });
  }
  return entries;
};

export const createGame = (platform: PlatformAdapter): Game => {
  const ctx: Ctx2D | null = platform.canvas.getContext('2d');
  const engine = createLayoutEngine();
  const renderer = createRenderer();
  let state: GameState = INITIAL_STATE;

  const viewport = (): { width: number; height: number } => ({
    width: platform.screen.width,
    height: platform.screen.height,
  });
  const view = (): ScreenLayout => engine.compute(state.screen, viewport(), state);

  /** 当前布局：每帧重算（纯函数、毫秒级），绘制与命中判定用同一份 */
  let current: ScreenLayout = view();

  const draw = (): void => {
    current = view();
    if (ctx !== null) renderer.draw(ctx, current);
  };

  const pointer = (event: PointerEvent): void => {
    // 用 up 判定：按下即触发会让滑动误触
    if (event.kind !== 'up') return;
    const picked = pickHit(hitEntriesOf(current), event.pointer);
    // 空白处 / 全是 hit none：没有元素接这次点击
    if (picked === null) return;
    // 遮罩 / loading：吃掉这次点击，不执行任何 action、也不继续往下找
    if (picked.hit === 'block') return;
    // self 但没绑动作：元素可点但无事可做
    const action = ACTION_OF[current.screen][picked.name];
    if (action === undefined) return;
    state = reduce(state, action);
    // 状态变了就立刻重算布局：切界面后 layout 查询要马上反映新界面
    current = view();
  };

  const loop = createLoop({ update: () => undefined, render: () => draw() });
  const unsubscribe = platform.onPointer(pointer);

  return {
    get state(): GameState {
      return state;
    },
    get layout(): ScreenLayout {
      // 深拷贝矩形：外部拿到的是快照，改不到内部布局
      const rects: Record<string, Rect> = {};
      for (const [name, rect] of Object.entries(current.rects)) rects[name] = { ...rect };
      return { ...current, rects };
    },
    start(): void {
      draw(); // 先画一帧，避免首帧白屏
      loop.start();
    },
    stop(): void {
      loop.stop();
      unsubscribe();
    },
  };
};
