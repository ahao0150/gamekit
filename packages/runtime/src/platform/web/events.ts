/**
 * web 的 DOM 指针事件接线。
 *
 * 为什么单独一个文件：
 * 这一块是「浏览器有几种输入事件、怎么归一成一种」的全部脏活，
 * 与适配器的装配逻辑无关。拆出来，index.ts 就只剩「把各能力接上」，
 * 单文件也压得住 300 行（AGENTS 铁律 2）。
 *
 * 归一策略：
 * 1. 有 PointerEvent 就用它（pointerdown/move/up/cancel）；
 * 2. 没有就退回 touch 事件 + mouse 事件（老浏览器）；
 * 3. 两条路的产出结构完全一样，业务与 core 只见一种事件。
 *
 * 坐标：DOM 给的是视口坐标，统一转成**画布局部坐标**（toCanvasPoint），
 * 否则画布在页面里被居中时，点击会整体偏一个偏移量。
 */

import { normalizeWheelDelta } from '../wheel-utils';
import { readCanvasBox, toCanvasPoint } from './env';

/** 统一的滚轮回调：坐标是画布局部坐标，delta 已归一为像素。 */
export type EmitWheel = (
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
  time: number,
) => void;

export type PointerKind = 'down' | 'move' | 'up' | 'cancel';

/** 统一的指针事件回调。 */
export type EmitPointer = (
  kind: PointerKind,
  id: number,
  x: number,
  y: number,
  time: number,
) => void;

/**
 * 装上指针事件监听，返回解绑函数。
 *
 * touch 事件用 passive:false 是为了能 preventDefault —— 否则移动端浏览器
 * 会在我们处理之前先滚动/缩放页面，点击就丢了。
 */
export const attachPointerEvents = (
  canvas: HTMLCanvasElement,
  emit: EmitPointer,
): (() => void) => {
  const cleanups: Array<() => void> = [];
  const listen = <E extends Event>(
    target: EventTarget,
    type: string,
    fn: (ev: E) => void,
    options?: AddEventListenerOptions,
  ): void => {
    const handler = fn as EventListener;
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  // 特性检测（判断浏览器支不支持 PointerEvent），不是平台探测 ——
  // 平台探测只在 index.ts 的 probe() 里。
  if (typeof window.PointerEvent === 'function') {
    listen<PointerEvent>(canvas, 'pointerdown', (e) => {
      const p = toCanvasPoint(canvas, e.clientX, e.clientY);
      emit('down', e.pointerId, p.x, p.y, e.timeStamp);
    });
    listen<PointerEvent>(canvas, 'pointermove', (e) => {
      const p = toCanvasPoint(canvas, e.clientX, e.clientY);
      emit('move', e.pointerId, p.x, p.y, e.timeStamp);
    });
    listen<PointerEvent>(canvas, 'pointerup', (e) => {
      const p = toCanvasPoint(canvas, e.clientX, e.clientY);
      emit('up', e.pointerId, p.x, p.y, e.timeStamp);
    });
    listen<PointerEvent>(canvas, 'pointercancel', (e) => {
      const p = toCanvasPoint(canvas, e.clientX, e.clientY);
      emit('cancel', e.pointerId, p.x, p.y, e.timeStamp);
    });
  } else {
    // 老浏览器：touch 优先，鼠标兜底（id 用 -1 表示鼠标）
    const touch = (kind: PointerKind) => (e: TouchEvent): void => {
      const t =
        kind === 'up' || kind === 'cancel'
          ? (e.changedTouches[0] ?? null)
          : (e.touches[0] ?? null);
      if (!t) return;
      e.preventDefault();
      const p = toCanvasPoint(canvas, t.clientX, t.clientY);
      emit(kind, t.identifier, p.x, p.y, e.timeStamp);
    };
    listen<TouchEvent>(canvas, 'touchstart', touch('down'), { passive: false });
    listen<TouchEvent>(canvas, 'touchmove', touch('move'), { passive: false });
    listen<TouchEvent>(canvas, 'touchend', touch('up'), { passive: false });
    listen<TouchEvent>(canvas, 'touchcancel', touch('cancel'), { passive: false });

    listen<MouseEvent>(canvas, 'mousedown', (e) => {
      const p = toCanvasPoint(canvas, e.clientX, e.clientY);
      emit('down', -1, p.x, p.y, e.timeStamp);
    });
    listen<MouseEvent>(canvas, 'mousemove', (e) => {
      const p = toCanvasPoint(canvas, e.clientX, e.clientY);
      emit('move', -1, p.x, p.y, e.timeStamp);
    });
    listen<MouseEvent>(canvas, 'mouseup', (e) => {
      const p = toCanvasPoint(canvas, e.clientX, e.clientY);
      emit('up', -1, p.x, p.y, e.timeStamp);
    });
  }

  return () => {
    for (const fn of cleanups) fn();
  };
};

/**
 * 装上滚轮监听，返回解绑函数（T36）。
 *
 * 三个必须做对的地方：
 * 1. **`passive: false` + `preventDefault()`**：画布铺满视口，滚页面没有意义；
 *    不阻止的话浏览器会把整页滚走（PC 上表现为「滚轮一滚，游戏画布跑了」）。
 * 2. **`deltaMode` 归一**：0 像素 / 1 行 / 2 页，换算成像素统一交给
 *    `wheel-utils.ts` 的纯函数，不在事件回调里手写魔法数。
 *    页模式用**画布 CSS 高**（`readCanvasBox().height`）而不是 `innerHeight`：
 *    画布可能只占视口一部分（contain 适配留边），「一页」应按画布算。
 * 3. **坐标走 `toCanvasPoint`**：与指针事件同一套换算，画布居中时不会偏。
 */
export const attachWheelEvents = (
  canvas: HTMLCanvasElement,
  emit: EmitWheel,
): (() => void) => {
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = toCanvasPoint(canvas, e.clientX, e.clientY);
    const pageHeight = readCanvasBox(canvas).height;
    emit(
      p.x,
      p.y,
      normalizeWheelDelta(e.deltaX, e.deltaMode, pageHeight),
      normalizeWheelDelta(e.deltaY, e.deltaMode, pageHeight),
      e.timeStamp,
    );
  };
  canvas.addEventListener('wheel', onWheel as EventListener, { passive: false });
  return () => canvas.removeEventListener('wheel', onWheel as EventListener);
};
