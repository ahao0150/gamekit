/**
 * `aspect` 的求解（v0.7）：按宽高比从一个**已知轴**推出另一个轴。
 *
 * 口径（写进文档 §4.2，改之前先问）：
 * - `aspect` 是 `put` 的同级修饰词，不是 `size` 的值；存进 `NodeSpec.aspect` 时统一是
 *   `w / h` 的比值（`1` 正方形、`16:9` 横宽、`9:16` 竖长），词法侧保留四位小数。
 * - **必须有一个已知轴**，否则报错（错误进 `errors`，不抛异常）：
 *   - 交叉轴已知（`cross` 是确定值，或 `align stretch` 拉满）→ 推主轴；
 *   - 主轴已知（`size` 是 `fixed` / `ratio`）→ 推交叉轴；
 *   - `size fill` → **主轴先取剩余空间、上限是交叉轴拉满时的主轴**（见下）；
 *   - 两个都已知 → **轴冲突**；一个都不知道 → **缺已知轴**。
 * - 换算方向（不能搞反）：
 *   - `column`：交叉轴 = 宽 `w`，主轴 = 高 `h`；已知 `w` → `h = w / r`，已知 `h` → `w = h × r`
 *   - `row`：交叉轴 = 高 `h`，主轴 = 宽 `w`；已知 `h` → `w = h × r`，已知 `w` → `h = w / r`
 * - **`size fill` + `aspect` 合法**（v0.7 修正）：「在剩余空间里尽量大、且保持比例」是最常用的
 *   场景，和 fill 是配套的。求 `main = min(flexSize, mainLimit)`，`mainLimit` 是「交叉轴拉满
 *   `crossLen` 时的主轴」；被钳小的差额不进别的 fill 元素，而是**吐回 `free` 由 justify 分配**
 *   （与现有 justify 语义一致：fill 先吃，剩下的才交给 justify）。
 * - **必须在第一遍（推进 cursor 之前）定下主轴**：cursor 用它前进。所以「第一遍按 flexSize、
 *   第二遍再回退改 main」是错的写法，会让 cursor 与 free 全部错位。
 *
 * 为什么推翻「不新增 aspect」（原 `docs/ui-syntax.md` v0.3 附的结论）：
 * `games/player-ui-lab` 的专辑封面必须正方形，没有 `aspect` 只能 `cross 100%` +
 * 组件内部 `side = min(box.w, box.h)` 绕；代价是组件 box 与视觉正方形不重合 ——
 * 位置对拍只能比 box、命中区比看到的方块左右各多出 `(box.w - side)/2`。这是布局语言
 * 该管的「占位」，不是组件该猜的「内容尺寸」。
 *
 * 纯函数：只读入参、只返回数值/错误，不碰 canvas、不写全局状态。
 */

import type { Align, NodeSpec, Size } from './layout-spec';
import { num } from './layout-geometry';

/** 一个尺寸表达式的「确定值」类别。`fill` / `auto` 不算已知轴。 */
type SizeKind = 'fill' | 'auto' | 'definite';

const kindOf = (size: Size | undefined): SizeKind => {
  if (size === undefined) return 'auto';
  if (typeof size === 'number') return 'definite';
  if (size.kind === 'fixed' || size.kind === 'ratio') return 'definite';
  return size.kind;
};

/** 确定尺寸的取值（只对 `definite` 调用）。 */
const definiteValue = (size: Size, available: number): number => {
  if (typeof size === 'number') return num(size);
  if (size.kind === 'fixed') return num(size.n);
  if (size.kind === 'ratio') return num(available * size.r);
  return 0;
};

/** 已知主轴时求交叉轴（`column`：`w = h × r`；`row`：`h = w / r`）。 */
export const crossFromMain = (aspect: number, row: boolean, main: number): number =>
  row ? num(main / aspect) : num(main * aspect);

/** 已知交叉轴时求主轴（`column`：`h = w / r`；`row`：`w = h × r`）。 */
const mainFromCross = (aspect: number, row: boolean, cross: number): number =>
  row ? num(cross * aspect) : num(cross / aspect);

/** `aspect` 求解结果：主轴 / 交叉轴由它决定、fill 的主轴上限，或者一条错误。 */
export type AspectSolve =
  | { readonly kind: 'main'; readonly value: number }
  | { readonly kind: 'cross'; readonly value: number }
  /** `size fill` + `aspect`：主轴 = `min(flexSize, mainLimit)`，差额吐回 `free` */
  | { readonly kind: 'fill'; readonly mainLimit: number }
  | { readonly kind: 'error'; readonly message: string };

export interface AspectInput {
  /** `w / h` 比值；`<= 0` 视为非法（词法层已拦，这里再防一手） */
  readonly aspect: number;
  /** 当前 stack 的方向 */
  readonly row: boolean;
  /** 容器主轴长度（`ratio` 的基数） */
  readonly mainLen: number;
  /** 容器交叉轴长度（`align stretch` 的交叉轴、`ratio` 的基数） */
  readonly crossLen: number;
  /** `put size`（`.ui` 未写时解析器会给 `{kind:'auto'}`） */
  readonly size: Size | undefined;
  /** `put cross` */
  readonly cross: Size | undefined;
  /** 交叉轴是否被 `align stretch` 拉满（此时 `cross` 被忽略） */
  readonly stretch: boolean;
}

const error = (message: string): AspectSolve => ({ kind: 'error', message });

/**
 * 求解一个带 `aspect` 的节点。
 *
 * 返回值告诉 `layoutStack`：主轴用它算（`main`）、交叉轴用它算（`cross`）、
 * 还是先按剩余空间再钳到上限（`fill`）。`error` 时调用方应**保留原求解路径**
 * （报错但不影响布局产出）。
 */
export const solveAspect = (input: AspectInput): AspectSolve => {
  const { aspect, row, crossLen } = input;
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return error(`aspect 的比值必须大于 0，收到 ${aspect}`);
  }
  const sizeKind = kindOf(input.size);
  const mainKnown = sizeKind === 'definite';
  const crossKind = input.stretch ? undefined : kindOf(input.cross);
  const crossKnown = crossKind === 'definite';

  if (sizeKind === 'fill') {
    if (crossKnown) {
      return error('aspect 的轴冲突：size fill 要吃剩余空间、cross 又给了确定交叉轴，aspect 无需求解');
    }
    // 主轴上限 = 交叉轴拉满 crossLen 时的主轴；实际取 min(flexSize, 它)
    return { kind: 'fill', mainLimit: mainFromCross(aspect, row, crossLen) };
  }
  if (mainKnown && crossKnown) {
    return error('aspect 的轴冲突：size 和 cross 同时给了确定尺寸，没有需要 aspect 推的那一轴');
  }
  if (mainKnown) {
    const main = definiteValue(input.size as Size, input.mainLen);
    return { kind: 'cross', value: crossFromMain(aspect, row, main) };
  }
  if (crossKnown) {
    const cross = definiteValue(input.cross as Size, crossLen);
    return { kind: 'main', value: mainFromCross(aspect, row, cross) };
  }
  if (input.stretch) {
    return { kind: 'main', value: mainFromCross(aspect, row, crossLen) };
  }
  return error('aspect 缺少已知轴：要有一个确定尺寸（size）或一个确定交叉轴（cross / align stretch）');
};

/**
 * 解析期的组合校验（parse-put 用，能区分「作者显式写了 size auto」）。
 *
 * `layout` 层拿不到 `sizeExplicit`（`NodeSpec` 里缺省 size 与显式 auto 同形），
 * 所以那里把 `auto` 一律当「无已知轴」；显式 `size auto` 的矛盾在解析期就带行号报掉。
 *
 * **`size fill` 不在这里报错**（v0.7 修正后合法）；只有「fill 又给了确定 cross」算冲突。
 */
export const describeAspectConflict = (
  size: Size,
  sizeExplicit: boolean,
  cross: Size | undefined,
): string | undefined => {
  const sizeKind = kindOf(size);
  const crossDefinite = cross !== undefined && kindOf(cross) === 'definite';
  if (sizeKind === 'fill' && crossDefinite) {
    return 'aspect 的轴冲突：size fill 要吃剩余空间、cross 又给了确定交叉轴，aspect 无需求解';
  }
  if (sizeKind === 'auto' && sizeExplicit) {
    return 'aspect 与 size auto 冲突：auto 由组件 measure() 决定尺寸，不能再由 aspect 推';
  }
  if (sizeKind === 'definite' && crossDefinite) {
    return 'aspect 的轴冲突：size 和 cross 同时给了确定尺寸，没有需要 aspect 推的那一轴';
  }
  return undefined;
};

/** `layoutStack` 的 aspect 计划：求解结果、错误、最终主轴、justify 可分配的剩余。 */
export interface AspectStackPlan {
  /** 每个子节点的求解结果（`null` = 没写 aspect） */
  readonly solved: ReadonlyArray<AspectSolve | null>;
  /** 错误文案（**不带路径前缀**，由调用方拼 `path/name`） */
  readonly errors: readonly string[];
  /** 最终主轴：`fixed` / `ratio` / aspect 推导 / fill 按上限钳制后的值 */
  readonly mains: readonly number[];
  /** justify 可分配的剩余空间（被 aspect 钳小的 fill 把差额吐回这里） */
  readonly free: number;
}

export interface AspectStackInput {
  readonly children: readonly NodeSpec[];
  /** 父 stack 的 align（子节点没写 align 时继承它） */
  readonly align: Align;
  readonly row: boolean;
  readonly mainLen: number;
  readonly crossLen: number;
  /** 现有算法算出的主轴：`fill` 是 `null`，其余是数值（含 aspect 推出的主轴） */
  readonly rawMains: readonly (number | null | undefined)[];
  /** 现有算法算出的「每个 fill 平分的剩余空间」 */
  readonly flexSize: number;
  /** 现有算法算出的 `mainLen - 定长和 - 间距和` */
  readonly remain: number;
}

/**
 * 一次算完整个 stack 的 aspect：**必须在第一遍推进 cursor 之前调用**。
 *
 * `free` 的口径：`remain` 减去每个 fill 的**实际**主轴。没 aspect 时
 * `Σ实际 = flexSize × fill 数`，与旧公式 `remain - flexSize × flexCount` 完全等价；
 * 有 fill+aspect 时被钳小的差额会留在 `remain` 里，从而进 `free` 交给 justify。
 */
export const planAspectStack = (input: AspectStackInput): AspectStackPlan => {
  const { children, align, row, mainLen, crossLen, rawMains, flexSize, remain } = input;
  const solved = children.map((child) => {
    if (child.aspect === undefined) return null;
    const childAlign = child.align ?? align;
    return solveAspect({
      aspect: child.aspect,
      row,
      mainLen,
      crossLen,
      size: child.size,
      cross: child.cross,
      stretch: childAlign === 'stretch',
    });
  });
  const errors = solved.flatMap((item, index) =>
    item?.kind === 'error' ? [`${children[index]?.name ?? index} ${item.message}`] : [],
  );
  const mains = children.map((child, index) => {
    const item = solved[index];
    // aspect 决定主轴的优先（此时 size 不是确定值，rawMains 里是 fill 的 null 或 auto 的 0）
    if (item?.kind === 'main') return item.value;
    const raw = rawMains[index];
    if (raw !== null && raw !== undefined) return raw;
    if (item?.kind === 'fill') return Math.min(flexSize, item.mainLimit);
    return flexSize;
  });
  // free 只能减 **fill 部分**：`remain` 已经减过定长和与间距和，再减一遍定长会重复扣减。
  // 没 aspect 时 fillUsed = flexSize × fill 数，与旧公式 `remain - flexSize × flexCount` 等价。
  const fillUsed = children.reduce((sum, _child, index) => {
    const raw = rawMains[index];
    if (raw !== null && raw !== undefined) return sum;
    return sum + (mains[index] ?? 0);
  }, 0);
  const free = Math.max(0, remain - fillUsed);
  return { solved, errors, mains, free };
};
