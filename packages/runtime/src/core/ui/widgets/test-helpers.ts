// @long-file 假画布必须把 fillRect / 路径 fill / 文本 / 图片 / clip 五类调用记在同一个对象上，拆开会让一次绘制的证据散落、断言读不全
/**
 * widgets 测试用的假画布与假依赖。
 *
 * 为什么记录而不 mock 返回值：团队硬规则要求断言「真实绘制发生过」——
 * 次数、坐标（有限且在 box 内）、关键形态（填充宽、scale、alpha、clip）都要能读出来。
 * `Ctx2D` 是 DOM 类型，测试里用 `unknown` 收窄成最小假对象（不是 any）。
 */

import type { Ctx2D } from '../../../platform/contract';
import type { ImageAsset } from '../../assets/contract';
import { DEFAULT_THEME } from '../components';
import type { ComponentAssets, DrawDeps, MeasureEnv } from '../components';
import type { Rect } from '../contract';
import type { StyleProps } from '../layout-spec';

export interface SpyFill {
  readonly args: readonly number[];
  readonly color: string;
}
export interface SpyImage {
  readonly native: unknown;
  readonly args: readonly number[];
}
export interface SpyText {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  /**
   * `fillText` 的第 4 参（只有真的传了才记录）。
   *
   * 用来断言「`TextStyle.maxWidth` 透传到 canvas」——折行按估算算行数，
   * 真实字宽偏差靠这个参数横向压缩兜住，不记录它就测不到兜底是否生效。
   */
  readonly maxWidth?: number;
}

export interface SpyCtx {
  ctx: Ctx2D;
  readonly fills: SpyFill[];
  readonly images: SpyImage[];
  readonly texts: SpyText[];
  readonly arcs: number[][];
  readonly scales: number[][];
  readonly translates: number[][];
  readonly alphas: number[];
  /** `rect()` 调用记录（carousel 的 clip 区域） */
  readonly rects: number[][];
  saves: number;
  restores: number;
  clips: number;
  pathFills: number;
  beginPaths: number;
  /** `stroke()` 次数（T18 checkbox 的对勾用描边画） */
  strokes: number;
  /** 路径顶点数（moveTo / lineTo 分别记，对勾至少要 3 个点） */
  moves: number;
  lines: number;
  /** 每次 `fill()` / `stroke()` 时的颜色（断言「用哪个主题色画的」） */
  readonly pathFillColors: string[];
  readonly strokeColors: string[];
  /**
   * 每个 `beginPath()` 之后的第一个 `moveTo` 坐标（T19）。
   *
   * 圆角矩形走 `roundPath` 时起点是 `(x + radius, y)`，所以用它就能断言
   * 「这个圆角块画在哪」——`beginPath` 之前的坐标不算，避免把上一个路径的点混进来。
   */
  readonly pathStarts: number[][];
  /**
   * 每次 `fill()` 时当前路径的包围盒（T20）。
   *
   * 圆角块没有 `fillRect` 那样的几何参数，靠路径顶点反推矩形：`roundPath` 的
   * moveTo/lineTo/arcTo 正好覆盖四个角点，包围盒就等于该块的 `{x,y,w,h}`。
   */
  readonly fillBounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }[];
  /**
   * 每次填充的矩形 + 颜色（`fillRect` 与路径 `fill` 合并，按发生顺序）。
   *
   * 为什么要另开一份、而不给 `fillBounds` 加 `color` 字段：`fillBounds` 已被
   * `widgets-scrollbar.test.ts` 用 `toEqual({x,y,w,h})` 严格比较，加字段会整批打红。
   *
   * 为什么需要它：圆角块（气泡底、圆角输入框、圆角按钮）全都走
   * `beginPath → … → fill()`，**`spy.fills` 里一个都没有**。想把「填充面积 / 唯一填充色」
   * 这类像素断言接到 `fills` 上会恒得 0 —— 不是没画，是读错了通道。
   * 头像圆这类没有路径顶点的 `arc + fill` 反推不出矩形，不计入（面积只会偏小，不影响 `≥` 口径）。
   */
  readonly fillBoxes: SpyFillBox[];
}

/** 一次填充：矩形 + 颜色 + 走的是哪条通道。 */
export interface SpyFillBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly color: string;
  readonly via: 'rect' | 'path';
}

/** 假画布：把绘制调用记进数组，属性用 getter/setter 模拟。 */
export const spyCtx = (): SpyCtx => {
  const state = { fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '', globalAlpha: 1 };
  const spy: SpyCtx = {
    ctx: null as unknown as Ctx2D,
    fills: [],
    images: [],
    texts: [],
    arcs: [],
    scales: [],
    translates: [],
    alphas: [],
    rects: [],
    saves: 0,
    restores: 0,
    clips: 0,
    pathFills: 0,
    beginPaths: 0,
    strokes: 0,
    moves: 0,
    lines: 0,
    pathFillColors: [],
    strokeColors: [],
    pathStarts: [],
    fillBounds: [],
    fillBoxes: [],
  };
  /** 刚开了一条新路径、还没记起点 */
  let awaitingStart = false;
  /** 当前路径的顶点（用来反推 fill 的包围盒） */
  let pathPoints: number[][] = [];

  /** 用当前路径顶点算包围盒，push 进 fillBounds 并清空；返回该包围盒（无顶点时为 null）。 */
  const pushBounds = (
    target: SpyCtx,
  ): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null => {
    if (pathPoints.length === 0) return null;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const point of pathPoints) {
      const x = point[0] ?? 0;
      const y = point[1] ?? 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    target.fillBounds.push(bounds);
    pathPoints = [];
    return bounds;
  };
  const ctx = {
    get fillStyle(): string {
      return state.fillStyle;
    },
    set fillStyle(value: string) {
      state.fillStyle = value;
    },
    get strokeStyle(): string {
      return state.strokeStyle;
    },
    set strokeStyle(value: string) {
      state.strokeStyle = value;
    },
    get font(): string {
      return state.font;
    },
    set font(value: string) {
      state.font = value;
    },
    get textAlign(): string {
      return state.textAlign;
    },
    set textAlign(value: string) {
      state.textAlign = value;
    },
    get textBaseline(): string {
      return state.textBaseline;
    },
    set textBaseline(value: string) {
      state.textBaseline = value;
    },
    get globalAlpha(): number {
      return state.globalAlpha;
    },
    set globalAlpha(value: number) {
      state.globalAlpha = value;
      spy.alphas.push(value);
    },
    save: (): void => void (spy.saves += 1),
    restore: (): void => void (spy.restores += 1),
    beginPath: (): void => {
      spy.beginPaths += 1;
      awaitingStart = true;
      pathPoints = [];
    },
    closePath: (): void => undefined,
    moveTo: (x: number, y: number): void => {
      spy.moves += 1;
      pathPoints.push([x, y]);
      if (awaitingStart) {
        spy.pathStarts.push([x, y]);
        awaitingStart = false;
      }
    },
    lineTo: (x: number, y: number): void => {
      spy.lines += 1;
      pathPoints.push([x, y]);
    },
    arcTo: (x1: number, y1: number, x2: number, y2: number): void => {
      // arcTo 的两个控制点都在矩形角上，收进来才能让包围盒等于整块矩形
      pathPoints.push([x1, y1], [x2, y2]);
    },
    arc: (...args: number[]): void => void spy.arcs.push(args),
    rect: (x: number, y: number, w: number, h: number): void => void spy.rects.push([x, y, w, h]),
    clip: (): void => void (spy.clips += 1),
    fill: (): void => {
      spy.pathFills += 1;
      spy.pathFillColors.push(state.fillStyle);
      const bounds = pushBounds(spy);
      if (bounds !== null) spy.fillBoxes.push({ ...bounds, color: state.fillStyle, via: 'path' });
    },
    stroke: (): void => {
      spy.strokes += 1;
      spy.strokeColors.push(state.strokeStyle);
    },
    fillRect: (x: number, y: number, w: number, h: number): void => {
      spy.fills.push({ args: [x, y, w, h], color: state.fillStyle });
      spy.fillBoxes.push({ x, y, w, h, color: state.fillStyle, via: 'rect' });
    },
    fillText: (text: string, x: number, y: number, maxWidth?: number): void => {
      spy.texts.push({
        text,
        x,
        y,
        color: state.fillStyle,
        ...(maxWidth === undefined ? {} : { maxWidth }),
      });
    },
    drawImage: (native: unknown, ...args: number[]): void => {
      spy.images.push({ native, args });
    },
    translate: (x: number, y: number): void => void spy.translates.push([x, y]),
    scale: (x: number, y: number): void => void spy.scales.push([x, y]),
  };
  spy.ctx = ctx as unknown as Ctx2D;
  return spy;
};

/**
 * 这次绘制用到的全部填充色（去重，路径 `fill` 与 `fillRect` 合并）。
 *
 * 像素断言的「唯一填充色」口径：圆角块走路径、直角块走 `fillRect`，
 * 只看 `fills` 会漏掉全部圆角块。
 */
export const fillColors = (spy: SpyCtx): readonly string[] => [...new Set(spy.fillBoxes.map((box) => box.color))];

/** 填充总面积（`fillBoxes` 各矩形面积之和）。 */
export const filledArea = (spy: SpyCtx): number =>
  spy.fillBoxes.reduce((sum, box) => sum + box.w * box.h, 0);

/** 填充面积占 box 的比例（像素断言的「画面被填满多少」口径）。 */
export const filledRatio = (spy: SpyCtx, box: Rect): number =>
  box.w > 0 && box.h > 0 ? filledArea(spy) / (box.w * box.h) : 0;

/** 构造一个图片素材（native 带 key，便于断言「用的是哪张图」）。 */
export const makeImage = (key: string, w: number, h: number, sx = 0, sy = 0): ImageAsset => ({
  key,
  width: w,
  height: h,
  src: `${key}.png`,
  native: { kind: 'fake-image', key },
  sx,
  sy,
  sw: w,
  sh: h,
});

/** 假资产源：按 key 精确查找。 */
export const makeAssets = (list: readonly ImageAsset[] = []): ComponentAssets => ({
  get: (key: string): ImageAsset | null => list.find((item) => item.key === key) ?? null,
});

/** 假绘制依赖（主题用 DEFAULT_THEME）。 */
export const makeDeps = (list: readonly ImageAsset[] = []): DrawDeps => ({
  assets: makeAssets(list),
  theme: DEFAULT_THEME,
});

export const makeBox = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

export const makeEnv = (width = 390, height = 844, data: Record<string, unknown> = {}): MeasureEnv => ({
  viewport: { width, height },
  data,
});

/** 跑一次 draw，返回记录器。 */
export const render = (
  comp: { readonly def: { readonly draw: (ctx: Ctx2D, box: Rect, props: StyleProps, deps: DrawDeps) => void } },
  box: Rect,
  props: StyleProps = {},
  deps: DrawDeps = makeDeps(),
): SpyCtx => {
  const spy = spyCtx();
  comp.def.draw(spy.ctx, box, props, deps);
  return spy;
};

/** 断言一组坐标都是有限数且落在 box 内（容差 0.01）。 */
export const expectInside = (args: readonly number[], box: Rect, label: string): void => {
  for (const value of args) {
    if (!Number.isFinite(value)) throw new Error(`${label} 出现非有限坐标：${args.join(',')}`);
  }
  const [x = 0, y = 0, w = 0, h = 0] = args;
  const tol = 0.01;
  if (x < box.x - tol || y < box.y - tol || x + w > box.x + box.w + tol || y + h > box.y + box.h + tol) {
    throw new Error(`${label} 超出 box：绘制 ${JSON.stringify(args)} vs box ${JSON.stringify(box)}`);
  }
};
