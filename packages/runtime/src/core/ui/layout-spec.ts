/**
 * UI 布局的类型与构造器（纯数据）。
 *
 * 从 `layout.ts` 拆出来是为了守 AGENTS 铁律 2（单文件 ≤300 行）：布局引擎的实现
 * （切带、一维流、尺寸分配、溢出检查）已经占满一屏，类型定义放这里更好读。
 *
 * `layout.ts` 会把这些原样 re-export，所以外部仍然 `import { layout, fill } from './layout'`。
 */

import type { Rect } from './contract';
import type { HitMode } from './hit';

/** 命中语义（v0.5，单一真源在 `hit.ts`；布局只决定默认值）。 */
export type { HitMode };

// ---------------------------------------------------------------------------
// 尺寸约束
// ---------------------------------------------------------------------------

/** 尺寸约束表达式。 */
export type SizeSpec =
  | { readonly kind: 'fill' }
  | { readonly kind: 'auto' }
  | { readonly kind: 'fixed'; readonly n: number }
  | { readonly kind: 'ratio'; readonly r: number };

/** 尺寸：数字是 `fixed` 的简写。 */
export type Size = number | SizeSpec;

/** 主轴吃掉剩余空间。 */
export const fill: SizeSpec = { kind: 'fill' };
/** 尺寸由 measure() 决定。 */
export const auto: SizeSpec = { kind: 'auto' };
/** 固定逻辑像素。 */
export const fixed = (n: number): SizeSpec => ({ kind: 'fixed', n });
/** 占可用空间的比例（0..1）。 */
export const ratio = (r: number): SizeSpec => ({ kind: 'ratio', r });

// ---------------------------------------------------------------------------
// 结构
// ---------------------------------------------------------------------------

/** 交叉轴对齐。`stretch` 时交叉轴拉满。 */
export type Align = 'start' | 'center' | 'end' | 'stretch';

/**
 * 主轴对齐（v0.4，对齐 CSS flex 的 `justify-content`）。
 *
 * 语义：子元素在**主轴**（row=水平、column=垂直）上分配剩余空间。
 * `fill` 的子元素**先**吃掉剩余空间，剩下的才交给 justify 分配——
 * 所以「有 fill 子元素时 justify 通常不生效」是预期行为，不是 bug。
 */
export type Justify = 'start' | 'center' | 'end' | 'space-between';

/**
 * 层名（v0.5）。
 *
 * - `base`（默认）：保持流布局语义，region 依次纵向堆叠；
 * - `overlay`：每个 region 都是**独立的整屏坐标系**（相对视口），不参与 base 的流，
 *   多个 region 天然重叠，声明顺序即叠序。overlay 恒在 base 之上。
 */
export type LayerName = 'base' | 'overlay';

/** 每个命名节点的层与命中信息（`LayoutResult.meta`）。 */
export interface NodeMeta {
  readonly layer: LayerName;
  /** 未写 `hit` 时是 `self`（与旧行为等价） */
  readonly hit: HitMode;
  /** 层号：base=0、overlay=1（`hit.ts` 的 `HitEntry.layer` 直接用） */
  readonly layerIndex: number;
  /** 层内声明序（跨 region 累计）；越大越后画、在上（`HitEntry.index` 直接用） */
  readonly index: number;
}

/**
 * 长度：像素或百分比（v0.3）。
 *
 * **百分比的基数按方向取**：水平方向用视口宽、垂直方向用视口高。
 * 这条规则只在 `layout.ts` 里实现一次，`.ui` 那边负责把 `5%` 编译成 `{kind:'ratio',r:0.05}`。
 */
export type Length = number | { readonly kind: 'ratio'; readonly r: number };

/** 四边长度（百分比各按自己的方向取基数）。 */
export interface LengthInsets {
  readonly top: Length;
  readonly right: Length;
  readonly bottom: Length;
  readonly left: Length;
}

// ---------------------------------------------------------------------------
// 组件参数与 measure（T7）
// ---------------------------------------------------------------------------

/** `.ui` 的 `style k=v` 值：布尔 / 数字 / 字符串（规范 §5 的类型转换结果）。 */
export type StyleValue = string | number | boolean;

/** 组件参数表：键 → 值。布局引擎不解释，原样交给组件。 */
export type StyleProps = Readonly<Record<string, StyleValue>>;

/** 内容尺寸（组件 measure 的返回值）。 */
export interface MeasuredSize {
  readonly w: number;
  readonly h: number;
}

/** 一维流。 */
export interface StackSpec {
  readonly direction: 'row' | 'column';
  /** 子元素间距；百分比按方向取基数（row→视口宽，column→视口高） */
  readonly gap?: Length;
  readonly align?: Align;
  /** 主轴对齐（v0.4）：fill 先吃剩余空间，剩下的才按 justify 分配。默认 start。 */
  readonly justify?: Justify;
  readonly children: readonly NodeSpec[];
}

/** 一个布局节点。叶子节点只需要 `size` / `cross`；有 `stack` 时按流排布子节点。 */
export interface NodeSpec {
  /** 产出到 `rects` 的键名；匿名节点（占位/spacer）不产出。 */
  readonly name?: string;
  /** 主轴尺寸（row = 宽，column = 高）。 */
  readonly size?: Size;
  /** 交叉轴尺寸；`align: 'stretch'` 时被忽略（交叉轴拉满）。 */
  readonly cross?: Size;
  /**
   * 宽高比（v0.7）：统一是 `w / h` 的比值。`1` 正方形、`16:9` 横宽、`9:16` 竖长。
   *
   * 词法侧（`parse-tokens.ts` 的 `readAspect`）把 `16:9` 折成四位小数；求解在
   * `layout-aspect.ts`。**必须且只能有一个已知轴**：交叉轴确定（`cross` 或
   * `align stretch`）时推主轴，主轴确定（`size` 是 `fixed` / `ratio`）时推交叉轴；
   * 两轴都确定（轴冲突）或都不确定（缺已知轴）都报错，错误进 `errors`、不抛异常。
   */
  readonly aspect?: number;
  /** 覆盖父 stack 的交叉轴对齐（`.ui` 里 `put pause align end` 就是这个）。 */
  readonly align?: Align;
  readonly stack?: StackSpec;
  /**
   * 命中语义（v0.5）：`self`(默认，有 action 才响应) / `block`(吃掉点击无动作) /
   * `none`(穿透)。布局引擎不解释它，只原样带进 `meta`；判定在 `hit.ts`。
   */
  readonly hit?: HitMode;
  /**
   * `auto` 时用来取内容尺寸；缺省按 0。
   *
   * 入参是**父容器的可用框**（T7）：组件可能要做「按父宽还是按内容高」的判断，
   * 例如 `parcelGrid` 要读视口宽算格子边长。纯函数——只读入参、不碰 canvas。
   */
  readonly measure?: (box: Rect) => MeasuredSize;
  /** 组件参数（`.ui` 的 `style k=v`）。布局引擎不看，绑定时原样传给组件。 */
  readonly props?: StyleProps;
}

/** 一条视口带。 */
export interface RegionSpec {
  readonly name: string;
  /** top 从顶部累加，bottom 从底部累减，fill 吃剩余。overlay 层可省略（缺省 fill，不参与求解）。 */
  readonly edge: 'top' | 'bottom' | 'fill';
  /** 所属层（v0.5）：缺省 base。overlay 的 region 一律整屏坐标系，edge/height 被忽略。 */
  readonly layer?: LayerName;
  /** top / bottom 的高度：数字=fixed 像素，`ratio` 相对**视口高**（v0.2 的 `9%`）。fill 忽略。 */
  readonly height?: Size;
  /**
   * 任意位置（v0.6，**只在 overlay 层有效**）：region 的**中心点**落在 `(x, y)`。
   *
   * 百分比按方向取基数：x 用视口宽、y 用视口高。
   * 必须同时给 `size`——没有 size 就不知道内容多大，不能靠 measure 猜（组件可能还没绑定）。
   * 中心点会被钳制在视口内，所以完全跑出视口的 `at` 也不会让内容消失。
   */
  readonly at?: { readonly x: Length; readonly y: Length };
  /** `at` 的宽高（v0.6）：像素或百分比（宽按视口宽、高按视口高）。大于视口时钳到视口并进 errors。 */
  readonly size?: { readonly w: Length; readonly h: Length };
  /** 带内内边距：数字=四边同值；`LengthInsets`=四边分别给（v0.2 pad-x/y、v0.3 百分比）。 */
  readonly padding?: number | LengthInsets;
  /** 带内部布局。 */
  readonly node?: NodeSpec;
}

/** 顶层 spec。 */
export interface LayoutSpec {
  /** 视口内边距：安全区直接喂这里。 */
  readonly padding?: number | LengthInsets;
  readonly regions: readonly RegionSpec[];
}

export interface LayoutViewport {
  readonly width: number;
  readonly height: number;
}

export interface LayoutResult {
  /** 各带的矩形（name → rect） */
  readonly regions: Readonly<Record<string, Rect>>;
  /** 各命名节点的矩形 */
  readonly rects: Readonly<Record<string, Rect>>;
  /**
   * 绘制顺序（v0.5）：`layer` 声明序 → 层内声明序。**绘制按它正序，命中按它逆序**
   * （见 `hit.ts` 的 `sortForPaint` / `pickHit`）。
   */
  readonly paintOrder: readonly string[];
  /** 每个命名节点的层/命中信息（v0.5）；可直接映射成 `hit.ts` 的 `HitEntry` */
  readonly meta: Readonly<Record<string, NodeMeta>>;
  /** 溢出等问题（中文，不抛异常） */
  readonly errors: readonly string[];
}
