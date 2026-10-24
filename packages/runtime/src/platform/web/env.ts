/**
 * web 平台的 DOM 环境读取。
 *
 * 为什么单独一个文件：
 * 这些是「读浏览器的脏活」—— 安全区、屏幕尺寸、画布获取，全都要碰 DOM 全局。
 * 把它们从适配器主体里拆出来有两个好处：
 * 1. 适配器主体只留「把环境翻译成契约」这件事，读起来就是契约本身；
 * 2. 单文件行数压在 300 以内（AGENTS 铁律 2）。
 *
 * 注意：这里**不做平台探测**（不判断「是不是浏览器」）——那是 index.ts 里
 * probe() 的独活，AGENTS §3 明确要求探测代码只出现在 probe 里。
 *
 * 坐标系约定（重要，改之前先读）：
 * - `screen.width/height` = **画布的 CSS 显示尺寸**，不是 window.innerWidth。
 *   页面里画布可能比视口小（模板把 canvas 固定成设计分辨率 390×844 再居中），
 *   游戏画的是画布，布局就该按画布算。
 * - `PointerSample.x/y` = 相对**画布左上角**的坐标，与 screen 同坐标系；
 *   DOM 事件给的是相对视口的 clientX/clientY，所以要减掉画布在视口中的偏移。
 *   少了这一步，页面上一旦有居中偏移，点击就会整体偏掉。
 * - `screen.dpr` = 物理像素比；画布 backing store 按「CSS 尺寸 × dpr」设置。
 */

import type { FitMode, GameCanvas, Insets, ScreenInfo } from '../contract';
import { safeCanvasDimension } from '../canvas-utils';

/** 判断宿主传进来的东西是不是一个真画布。 */
export const isCanvasLike = (v: unknown): v is HTMLCanvasElement =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as HTMLCanvasElement).getContext === 'function';

/**
 * 解析安全区四个 CSS 值（探针元素 `getComputedStyle` 读回来的 padding）→ Insets。
 *
 * 为什么把解析单独抽出来：DOM 读取没法在 Node 里稳定复现，但「字符串 → 四边数字」
 * 这一步是纯函数，可以在单测里把空串 / `auto` / 负数全钉死。
 *
 * 兜底与 wx / tt 同一条规矩：**任何情况不产出 NaN / 负数**。
 * 浏览器不支持 env() 时整条 padding 声明失效、读回来是 `''`，必须退成 0。
 */
export const parseSafeAreaInsets = (raw: {
  readonly top: string;
  readonly right: string;
  readonly bottom: string;
  readonly left: string;
}): Insets => {
  const num = (value: string): number => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return { top: num(raw.top), right: num(raw.right), bottom: num(raw.bottom), left: num(raw.left) };
};

/**
 * 读安全区。
 *
 * 做法是官方推荐的那套：造一个隐藏探针元素，把四个 env(safe-area-inset-*)
 * 写进 padding，再用 getComputedStyle 读回解析后的像素值。
 * 浏览器不支持 env() 时整条声明失效，读回来是 0 —— 安全退化成「无安全区」，
 * 不会算出负数或 NaN。
 */
export const readSafeAreaInsets = (): Insets => {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top) env(safe-area-inset-right) ' +
    'env(safe-area-inset-bottom) env(safe-area-inset-left);';
  (document.body ?? document.documentElement).appendChild(el);
  const cs = window.getComputedStyle(el);
  const insets = parseSafeAreaInsets({
    top: cs.paddingTop,
    right: cs.paddingRight,
    bottom: cs.paddingBottom,
    left: cs.paddingLeft,
  });
  el.remove();
  return insets;
};

/**
 * 取画布：宿主给了就用宿主的；页面里已经有 canvas（模板的
 * `<canvas id="game">`）就复用它；都没有才自己造一个铺满视口的。
 *
 * 为什么要「优先复用页面里已有的」：
 * 页面上如果有两个 canvas（模板那个 + 我们自建那个），它们会叠在一起 ——
 * 用户看到的是后加的那个（尺寸=视口），而不是模板指定的设计分辨率，
 * 而且每次绘制都在画两个画布。宁可少一个。
 */
export const resolveCanvas = (given: unknown): HTMLCanvasElement => {
  if (isCanvasLike(given)) return given;
  const existing = document.querySelector('canvas');
  if (isCanvasLike(existing)) return existing;
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;touch-action:none;';
  (document.body ?? document.documentElement).appendChild(c);
  return c;
};

/** 画布在视口中的位置与 CSS 尺寸。 */
export interface CanvasBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export const readCanvasBox = (canvas: HTMLCanvasElement): CanvasBox => {
  const r = canvas.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/**
 * 按 design + fit 算画布在视口里的**显示尺寸**（CSS 像素）。
 *
 * 为什么由平台算、而不是插件写死 CSS：
 * 插件只知道设计分辨率，不知道用户视口。写死 `width:390px;height:844px` 的话，
 * 视口比它小（真机 360×640）时画布会被裁掉，底部的按钮点不到。
 * 平台层同时知道视口与适配策略，所以精确尺寸在这里算：
 * - contain（默认）：短边贴住视口，**画布完整可见**；
 * - height：贴住视口高，宽按设计比例走（宽可能超出，属该策略的预期）；
 * - width：贴住视口宽；
 * - fill：**画布 = 视口**，逻辑尺寸就是视口尺寸，不缩放设计稿。
 *
 * 为什么要有 `fill`：`contain` 只要设计比例与设备比例不一致就必然留边，而且
 * 留边方向随设备变（设备更宽 → 左右留；设备更长 → 上下留）。锁死一个比例就
 * 永远有设备难看。有布局引擎之后正确做法是画布铺满、内容按 region 自适应，
 * `design` 只作为固定像素的参考基准。
 */
export const computeCanvasBox = (
  design: { readonly width: number; readonly height: number },
  fit: FitMode | undefined,
  viewport: { readonly width: number; readonly height: number },
): { readonly width: number; readonly height: number } => {
  // fill：直接等于视口，完全不看 design（design 只影响布局里的固定像素换算）
  if (fit === 'fill') {
    const w = viewport.width > 0 ? viewport.width : design.width;
    const h = viewport.height > 0 ? viewport.height : design.height;
    return { width: w, height: h };
  }
  const dw = design.width > 0 ? design.width : viewport.width;
  const dh = design.height > 0 ? design.height : viewport.height;
  let scale: number;
  if (fit === 'height') scale = viewport.height / dh;
  else if (fit === 'width') scale = viewport.width / dw;
  else scale = Math.min(viewport.width / dw, viewport.height / dh);
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  return { width: dw * scale, height: dh * scale };
};

/**
 * 按 design + fit 把画布摆进视口：算显示尺寸 → 设 CSS 尺寸 → 设 backing → 给出屏幕信息。
 *
 * 返回的 ScreenInfo 就是适配器的 screen：**画布的 CSS 显示尺寸**，
 * 与指针坐标（画布局部坐标）同一坐标系，布局按它算。
 */
export const placeCanvas = (
  canvas: HTMLCanvasElement,
  design: { readonly width: number; readonly height: number },
  fit: FitMode | undefined,
): ScreenInfo => {
  const dpr = window.devicePixelRatio || 1;
  const box = computeCanvasBox(design, fit, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  canvas.style.width = `${box.width}px`;
  canvas.style.height = `${box.height}px`;
  applyCanvasSize(canvas, box.width, box.height, dpr);
  return {
    width: box.width,
    height: box.height,
    dpr,
    insets: readSafeAreaInsets(),
    orientation: box.width >= box.height ? 'landscape' : 'portrait',
  };
};

/**
 * 视口坐标（DOM 事件给的 clientX/clientY）→ 画布局部坐标。
 * 画布在页面里被居中/偏移时，不减这个偏移点击就会整体偏。
 */
export const toCanvasPoint = (
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } => {
  const box = readCanvasBox(canvas);
  return { x: clientX - box.left, y: clientY - box.top };
};

/**
 * 设置画布 backing store：CSS 尺寸 × dpr，并把绘制坐标系缩回逻辑像素。
 *
 * 为什么这里必须 setTransform（曾经的屏幕适配 bug）：
 * backing store 是「CSS 尺寸 × dpr」，而 screen.width/height 与指针坐标都是
 * **逻辑像素（CSS）**。若绘制时不建立 dpr 变换，游戏按逻辑坐标画出来的东西只占
 * 画布左上角 1/dpr² 区域，用户看到的画面缩在左上角，点击位置也整体错位。
 * 契约里写的就是「绘制时统一用 setTransform(dpr,0,0,dpr,0,0)」（platform/contract.ts）。
 *
 * 为什么每次都要重设：给 `canvas.width/height` 赋值会**重置整个 ctx 状态**
 * （transform 归 identity），所以 resize / 首次摆放之后都必须重新建立。
 */
export const applyCanvasSize = (
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): void => {
  const w = Math.max(1, Math.round(cssWidth * dpr));
  const h = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

/**
 * 把 HTMLCanvasElement 包成契约画布（T30，供离屏层使用）。
 *
 * 与上屏 `canvas` 的区别：那个的 width/height 是 `screen` 的逻辑尺寸；
 * 这里的 width/height 是元素自己的 backing 尺寸（物理像素），离屏层要的就是这个。
 */
export const wrapCanvas = (el: HTMLCanvasElement): GameCanvas => ({
  get width(): number {
    return el.width;
  },
  get height(): number {
    return el.height;
  },
  getContext: (type: '2d') => el.getContext(type),
  native: el,
});

/**
 * 新建一张**不插 DOM** 的离屏画布（T30）。
 *
 * 为什么不用 `OffscreenCanvas`：iOS Safari 16.4 才有、小游戏端支持不全；
 * 普通 canvas 三端都稳。尺寸按物理像素给，非法值钳到 1（尺寸 0 会让绘制静默消失）。
 */
export const createDetachedCanvas = (width: number, height: number): HTMLCanvasElement => {
  const el = document.createElement('canvas');
  el.width = safeCanvasDimension(width);
  el.height = safeCanvasDimension(height);
  return el;
};
