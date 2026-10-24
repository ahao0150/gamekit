/**
 * `.ui` 语法的单一真源：关键字 / 参数 / 百分比基数表。
 *
 * 为什么单独成文件：PLAN-ai-authoring §9.6 要求「语法的权威定义在代码里」，
 * `mg.ui.grammar()` 必须**从实现生成**语法说明，不能手抄一份文档——今天已经因为
 * 文档和实现漂移踩过坑。所以表放这里，解析器（parse.ts）与离线 MCP 工具共用同一份。
 *
 * 只放数据与纯函数，不放任何面向 AI 的排版文案（排版在 packages/debug-mcp 里）。
 */

import { ALIGNS, EDGES, HIT_MODES, JUSTIFIES, LAYER_NAMES } from './parse-tokens';

/** 对齐取值；解析器与 MCP 都从这同一份拿。 */
export { ALIGNS } from './parse-tokens';

/** 主轴对齐取值（v0.4）；错误文案、语法说明、文档对账都从这份生成。 */
export const JUSTIFY_VALUES = JUSTIFIES;

/** 层名（v0.5）：base 流布局 / overlay 独立整屏、彼此重叠。 */
export { HIT_MODES, LAYER_NAMES };

/** 命中语义（v0.5）：self 默认 / block 吃掉点击 / none 穿透。 */
export const HIT_VALUES = HIT_MODES;

export const UI_SYNTAX_VERSION = 'v0.6';

/** 语句动词（v0.5 起 `layer` 是分段行）。`style` 不是独立行，是 `put` 的内联修饰词。 */
export const UI_VERBS = ['region', 'put', 'layer'] as const;

/** `region` 的三种边。 */
export const REGION_EDGES = EDGES;

/** `region` 的排布方向（默认 `column`）。 */
export const REGION_DIRECTIONS = ['row', 'column'] as const;

/**
 * `region` 行上可用的修饰词。
 *
 * v0.6 加 `at <x> <y>` + `size <w> <h>`：任意位置（只在 overlay 层有效）。
 * overlay 的 `edge` 因此可以省略（它本来就不参与 overlay 求解）。
 */
export const REGION_MODIFIERS = ['gap', 'pad', 'pad-x', 'pad-y', 'align', 'justify', 'at', 'size'] as const;

/**
 * `region` 修饰词的错误提示文案（T33 从 parse.ts 搬来）。
 *
 * 放这里是因为它必须与 `REGION_MODIFIERS` 一一对应：解析器报「可用：…」时
 * 不能手写清单，否则加一个修饰词而忘记更新提示，AI 会被引到错的方向。
 */
export const describeRegionModifiers = (): string =>
  REGION_MODIFIERS.map((m) => {
    if (m === 'align') return 'align <a>';
    if (m === 'justify') return 'justify <j>';
    if (m === 'at') return 'at <x> <y>';
    if (m === 'size') return 'size <w> <h>';
    return `${m} <n|n%>`;
  }).join(' / ');

/** `put` 行上可用的修饰词（v0.5 新增 `hit`）。 */
export const PUT_MODIFIERS = ['size', 'cross', 'align', 'style', 'hit'] as const;

/** 尺寸写法（region 高度 / `put size` / `put cross` 共用）。 */
export const SIZE_FORMS = ['fill', 'auto', 'fixed <n>', 'ratio <r>', '<n>', '<n>%'] as const;

/** 长度写法（region 高度 / `gap` / `pad*`）。 */
export const LENGTH_FORMS = ['<n>', '<n>%'] as const;

/**
 * `style` 值类型（规范 §5）。
 *
 * v0.6 加最后一条：**带引号的值永远是字符串**，不参与前面的布尔/数字猜测——
 * `text="3"` 是字符串 `'3'`，`value=50` 才是数字 `50`。
 */
export const STYLE_VALUE_TYPES = ['true', 'false', '<number>', '<string>', '"<value>"（带引号=强制字符串）'] as const;

/** 解析器写死的错误格式，`mg.ui.grammar()` 原样复述。 */
export const ERROR_FORMAT = '<file>:<line>: <中文说明>';

/** 百分比长度的基数规则（v0.3：水平方向用视口宽、垂直方向用视口高）。 */
export interface PercentBasis {
  readonly where: string;
  readonly axis: 'horizontal' | 'vertical' | 'available';
  readonly basis: string;
}

export const PERCENT_BASIS: readonly PercentBasis[] = [
  { where: 'region top/bottom 高度', axis: 'vertical', basis: '视口高' },
  { where: 'pad', axis: 'vertical', basis: '上下用视口高、左右用视口宽' },
  { where: 'pad-x', axis: 'horizontal', basis: '视口宽' },
  { where: 'pad-y', axis: 'vertical', basis: '视口高' },
  { where: 'gap（column 方向）', axis: 'vertical', basis: '视口高' },
  { where: 'gap（row 方向）', axis: 'horizontal', basis: '视口宽' },
  { where: 'put size / cross', axis: 'available', basis: '父容器可用空间（主轴 / 交叉轴）' },
  { where: 'region at 的 x', axis: 'horizontal', basis: '视口宽' },
  { where: 'region at 的 y', axis: 'vertical', basis: '视口高' },
  { where: 'region size 的宽', axis: 'horizontal', basis: '视口宽' },
  { where: 'region size 的高', axis: 'vertical', basis: '视口高' },
];

/** 生成给 `mg.ui.grammar()` 用的结构化语法说明（纯数据）。 */
export interface UiGrammar {
  readonly version: string;
  readonly verbs: readonly string[];
  readonly region: {
    readonly edges: readonly string[];
    readonly directions: readonly string[];
    readonly modifiers: readonly string[];
    readonly alignValues: readonly string[];
    readonly justifyValues: readonly string[];
  };
  readonly put: {
    readonly modifiers: readonly string[];
    readonly sizes: readonly string[];
    readonly styleValues: readonly string[];
    readonly hits: readonly string[];
  };
  /** 层名（v0.5 分段行 `layer <name>`） */
  readonly layers: readonly string[];
  readonly lengths: readonly string[];
  readonly percentBasis: readonly PercentBasis[];
  readonly errorFormat: string;
}

export const describeGrammar = (): UiGrammar => ({
  version: UI_SYNTAX_VERSION,
  verbs: UI_VERBS,
  region: {
    edges: REGION_EDGES,
    directions: REGION_DIRECTIONS,
    modifiers: REGION_MODIFIERS,
    alignValues: ALIGNS,
    justifyValues: JUSTIFY_VALUES,
  },
  put: { modifiers: PUT_MODIFIERS, sizes: SIZE_FORMS, styleValues: STYLE_VALUE_TYPES, hits: HIT_VALUES },
  layers: LAYER_NAMES,
  lengths: LENGTH_FORMS,
  percentBasis: PERCENT_BASIS,
  errorFormat: ERROR_FORMAT,
});

export const UI_GRAMMAR: UiGrammar = describeGrammar();
