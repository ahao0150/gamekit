/**
 * 游戏装配：平台 → 布局（底层 + 浮层）→ 渲染 → 输入。
 *
 * 输入走 `platform.onPointer` 的真实事件；命中判定交给 core 的 `pickHit`。
 *
 * **T42：浮层是叠加的**。`engine.computeLayers()` 每帧给两份布局：
 * - `base`：`state.screen`（menu / gallery / …）—— 永远完整画一遍；
 * - `modal`：`state.modal`（popup / sheet / half / tip）—— 只画在 base 之上。
 *
 * 命中顺序与绘制顺序相反：**先查浮层**。浮层的遮罩是 `hit block`，所以点在遮罩上
 * 只会命中遮罩（有「关闭」action），**不会穿透到底层按钮**。tip 没有遮罩，浮层
 * 命不中时会落到 base（一条飘过的提示不该让底层按钮失效 1 秒）；其余三个浮层的
 * 遮罩铺满整屏，永远先命中，因此底层点不到。
 *
 * 滚动同 T38（`state.scrolls[组件名]`）：
 * - 拖动：底层可滚容器（浮层里没有可滚容器）；
 * - 滚轮：`platform.onWheel?` → 指针下最里层可滚容器 → `scrollByWheel`。
 * 浮层打开时不滚底层（遮罩挡住的界面不该被滚）。
 *
 * 按钮三态交给 `press.ts`；按压/命中都用**当前最上层**的条目（浮层优先）。
 */

import { createLoop, pickHit, pressDown, pressMove, pressUp, scrollByWheel, scrollDragMove } from './deps';
import type { Ctx2D, PlatformAdapter, PointerEvent, PressState, WheelEvent } from './deps';
import { gridIndexAtPoint, hitEntriesOf, listIndexAtPoint } from './hit';
import type { Point } from './hit';
import { createLayoutEngine } from './layout';
import type { ScreenLayout } from './layout';
import { createRenderer } from './render';
import { scrollableAt, scrollablesOf, WHEEL_SPEED } from './scrollables';
import type { Scrollable } from './scrollables';
import { ACTION_OF, INITIAL_STATE, reduce } from './state';
import type { DemoState } from './state';
import { IDLE_PRESS } from './deps';

/** 拖动阈值（逻辑像素）：超过它才算「滑容器」，否则算点击。 */
const DRAG_THRESHOLD = 6;

/** 命中来自哪一层（浮层与底层组件名可能重名，动作表要按层查）。 */
type LayerOf = 'base' | 'modal';

/** 一次可能变成拖动的手势（只有落在底层可滚容器上才会建立）。 */
interface DragGesture {
  readonly pointerId: number;
  /** 被拖的容器名（组件名；嵌套时是内层那个） */
  readonly target: string;
  readonly startY: number;
  lastY: number;
  /** 已超过阈值 = 真的在拖动（松手不算点击） */
  active: boolean;
}

export interface Game {
  readonly state: DemoState;
  /** 只读：底层界面布局（矩形是副本，外部改不到内部） */
  readonly layout: ScreenLayout;
  /** 只读：浮层布局；没有浮层时 null */
  readonly overlay: ScreenLayout | null;
  start(): void;
  stop(): void;
}

export const createGame = (platform: PlatformAdapter): Game => {
  const ctx: Ctx2D | null = platform.canvas.getContext('2d');
  const engine = createLayoutEngine();
  // 渲染器拿 engine 的注册表：gallery 行要按名字取组件定义独立调 draw（同一份）
  const renderer = createRenderer(undefined, engine.registry);
  let state: DemoState = INITIAL_STATE;
  /** 当前手势；null = 没有按下（或按下的不是可滚容器） */
  let drag: DragGesture | null = null;

  const viewport = (): { width: number; height: number } => ({
    width: platform.screen.width,
    height: platform.screen.height,
  });
  /** 当前两份布局：底层 + 浮层（T42） */
  let baseView: ScreenLayout;
  let modalView: ScreenLayout | null = null;
  const refresh = (): void => {
    const layers = engine.computeLayers(viewport(), state);
    baseView = layers.base;
    modalView = layers.modal;
  };
  refresh();

  const draw = (): void => {
    refresh();
    if (ctx !== null) renderer.draw(ctx, baseView, modalView);
  };

  const setPress = (next: PressState): void => {
    state = reduce(state, { kind: 'press', state: next });
  };

  /** 只改某一个容器的滚动位（拖动与滚轮共用这一个入口）。 */
  const setScroll = (name: string, offset: number): void => {
    state = reduce(state, { kind: 'scrollTo', name, offset });
  };

  /** 当前界面里名字叫 `name` 的可滚容器（找不到返回 null：布局变了 / 不是容器）。 */
  const scrollableNamed = (name: string): Scrollable | null =>
    scrollablesOf(baseView).find((item) => item.name === name) ?? null;

  /**
   * 指针下最上层的命中：**先浮层、再底层**。
   *
   * 浮层的遮罩是 `hit block`，所以浮层开着时这个函数通常返回浮层条目；
   * 只有 tip 这种没有遮罩的浮层会在空白处落回底层。
   */
  const hitAt = (point: Point): { readonly name: string; readonly from: LayerOf } | null => {
    if (modalView !== null) {
      const modalHit = pickHit(hitEntriesOf(modalView), point);
      if (modalHit !== null) return { name: modalHit.name, from: 'modal' };
    }
    const baseHit = pickHit(hitEntriesOf(baseView), point);
    return baseHit === null ? null : { name: baseHit.name, from: 'base' };
  };

  /** 按压状态机用的条目：浮层开着就用浮层（底层不该被按出三态）。 */
  const activeEntries = () => hitEntriesOf(modalView ?? baseView);

  /** 按钮松手后的动作：按层查 ACTION_OF；列表 / 网格的几何命中只发生在底层。 */
  const activated = (name: string, point: Point, from: LayerOf): void => {
    const screen = from === 'modal' && state.modal !== null ? state.modal : state.screen;
    const action = ACTION_OF[screen][name];
    if (action !== undefined) {
      state = reduce(state, action);
      refresh();
      return;
    }
    if (from === 'modal') return;
    const index =
      state.screen === 'inventory' && name === 'list'
        ? listIndexAtPoint(baseView, point)
        : state.screen === 'bag' && name === 'grid'
          ? gridIndexAtPoint(baseView, point)
          : null;
    if (index === null) return;
    state = reduce(state, { kind: 'select', index });
    refresh();
  };

  const onDown = (event: PointerEvent): void => {
    const point = event.pointer;
    // 只有「底层、且没有浮层挡住」的手势才可能是拖动
    const hit = modalView === null ? hitAt(point) : null;
    const target = hit === null || hit.from !== 'base' ? null : scrollableNamed(hit.name);
    if (target !== null) {
      drag = {
        pointerId: point.id,
        target: target.name,
        startY: point.y,
        lastY: point.y,
        active: false,
      };
    }
    setPress(pressDown(state.press, activeEntries(), point, point.id));
  };

  const onMove = (point: PointerEvent['pointer']): void => {
    if (drag !== null && drag.pointerId === point.id) {
      const dy = point.y - drag.lastY;
      drag.lastY = point.y;
      if (!drag.active && Math.abs(point.y - drag.startY) >= DRAG_THRESHOLD) drag.active = true;
      if (drag.active) {
        // 手指上滑（dy < 0）→ 内容上移 → offset 增大，所以取 -dy
        const target = scrollableNamed(drag.target);
        if (target !== null) {
          const offset = state.scrolls[target.name] ?? 0;
          const next = scrollDragMove({ offset, velocity: 0, dragging: true }, -dy, target.contentSize, target.rect.h);
          setScroll(target.name, next.offset);
        }
        // 拖动一开始就取消按压：滑容器不能顺带激活按钮/列表项
        if (state.press.pressed !== null) setPress(IDLE_PRESS);
      }
      return; // 拖动期间不跑 pressMove（否则滑出容器会反复改按压态）
    }
    setPress(pressMove(state.press, activeEntries(), point));
  };

  const onUp = (point: PointerEvent['pointer']): void => {
    const wasDragging = drag !== null && drag.pointerId === point.id && drag.active;
    if (drag !== null && drag.pointerId === point.id) drag = null;
    const result = pressUp(state.press, activeEntries(), point, point.id);
    setPress(result.state);
    // 拖动结束的 up 是「松手停住」，不是点击
    if (wasDragging) return;
    if (result.activated !== null) activated(result.activated, point, modalView === null ? 'base' : 'modal');
  };

  /**
   * 滚轮：`platform.onWheel` 是可选成员 —— 手机小游戏没有滚轮事件，`?.` 直接跳过。
   *
   * 浮层开着时**不滚底层**（遮罩挡住的内容不该在背后滚动）；浮层自己没有可滚容器，
   * 所以浮层打开期间滚轮是空操作。
   */
  const onWheel = (event: WheelEvent): void => {
    if (modalView !== null) return;
    const target = scrollableAt(baseView, { x: event.x, y: event.y });
    if (target === null) return;
    const offset = state.scrolls[target.name] ?? 0;
    const next = scrollByWheel({
      offset,
      delta: event.deltaY,
      contentSize: target.contentSize,
      viewSize: target.rect.h,
      speed: WHEEL_SPEED,
    });
    // 已在边界：不写状态（嵌套时外层更不会被「接力」滚起来）
    if (next === offset) return;
    setScroll(target.name, next);
    refresh();
  };

  const pointer = (event: PointerEvent): void => {
    // down / move / up / cancel 全走真实事件；用 up 判定动作（按下即触发会让滑动误触）
    if (event.kind === 'down') onDown(event);
    else if (event.kind === 'move') onMove(event.pointer);
    else if (event.kind === 'up') onUp(event.pointer);
    else {
      // cancel（来电 / 系统手势打断）：按压与拖动都清掉，滚动停在当前位置
      drag = null;
      setPress(IDLE_PRESS);
    }
    refresh();
  };

  const loop = createLoop({
    update: () => {
      // T42：tip 浮层倒计时（每帧一 tick，60 帧后只清 modal，底层不动）
      if (state.modal === 'tip') state = reduce(state, { kind: 'tick' });
    },
    render: () => draw(),
  });
  const unsubscribePointer = platform.onPointer(pointer);
  // 滚轮是可选能力：没有 onWheel 的平台（手机小游戏）就不订阅，其余逻辑不变
  const unsubscribeWheel = platform.onWheel?.(onWheel) ?? null;

  /** 深拷贝矩形：外部拿到的是快照，改不到内部布局。 */
  const snapshot = (view: ScreenLayout): ScreenLayout => {
    const rects: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const [name, rect] of Object.entries(view.rects)) rects[name] = { ...rect };
    return { ...view, rects };
  };

  return {
    get state(): DemoState {
      return state;
    },
    get layout(): ScreenLayout {
      return snapshot(baseView);
    },
    get overlay(): ScreenLayout | null {
      return modalView === null ? null : snapshot(modalView);
    },
    start(): void {
      draw(); // 先画一帧，避免首帧白屏
      loop.start();
    },
    stop(): void {
      loop.stop();
      unsubscribePointer();
      unsubscribeWheel?.();
    },
  };
};
