/**
 * `.ui` 语言解析器（纯函数）。
 *
 * 语法表（真源）在 `grammar.ts`；`docs/ui-syntax.md` 是给人读的说明，两者冲突时
 * 以 `mg.ui.grammar()`（从 grammar.ts 生成）为准。本文件只实现它，不发明新语法。
 * 三个动词：`region` 切带、`put` 往最近 region 放组件、`layer` 切换归属层。
 *
 * 三条硬要求：
 * 1. **纯函数**：不 import fs / vite / 浏览器，源码是字符串进、数据出；
 * 2. **错误一次报全**：不在第一个错误处中断，格式 `<file>:<line>: <中文说明>`；
 * 3. **产物直接喂 `layout()`**：`spec` 就是 `LayoutSpec`，不需要再转换。
 *
 * `put` 行的解析在 `parse-put.ts`（T33 拆出，守 300 行上限）。
 */

import type {
  Align,
  Justify,
  LayerName,
  LayoutSpec,
  Length,
  LengthInsets,
  NodeSpec,
  RegionSpec,
  Size,
  StackSpec,
} from './layout';
import { describeRegionModifiers, REGION_DIRECTIONS, UI_VERBS } from './grammar';
import { EDGES, IDENT, readAlign, readJustify, readLayer, readLength, readLengthPair, toLength, tokenize } from './parse-tokens';
import type { Token } from './parse-tokens';
import { parsePutLine } from './parse-put';

export interface ParseOptions {
  /** 已注册组件名。给了（非空）就校验「未知组件」；不传 / 空数组跳过。 */
  readonly knownComponents?: readonly string[];
  /** 组件参数声明：组件名 → 合法 style 键。给了就校验 style 键拼写。 */
  readonly componentProps?: Readonly<Record<string, readonly string[]>>;
  /** 文件名，用于错误前缀与产物 `name`；默认 `ui.ui`。 */
  readonly fileName?: string;
}

export interface ParsedUi {
  /** 文件名去扩展名（规范 §7） */
  readonly name: string;
  /** 直接喂给 `layout()` */
  readonly spec: LayoutSpec;
  /** 用到的组件名（首次出现顺序去重） */
  readonly components: readonly string[];
  /** 组件名 → 首次出现的源行号 */
  readonly lines: Readonly<Record<string, number>>;
  readonly source: string;
  /** 全部错误；为空表示解析成功 */
  readonly errors: readonly string[];
}

/** 内部正在累积的 region 草稿。 */
interface Draft {
  readonly name: string;
  readonly edge: 'top' | 'bottom' | 'fill';
  readonly layer: LayerName;
  readonly height?: Size;
  readonly padding?: LengthInsets;
  readonly direction: 'row' | 'column';
  readonly gap?: Length;
  readonly align?: Align;
  readonly justify?: Justify;
  /** v0.6：任意位置的中心点（只有 overlay 层会有值） */
  readonly at?: { readonly x: Length; readonly y: Length };
  /** v0.6：`at` 的宽高 */
  readonly regionSize?: { readonly w: Length; readonly h: Length };
  readonly children: NodeSpec[];
  readonly line: number;
}

export const parse = (source: string, opts: ParseOptions = {}): ParsedUi => {
  const fileName = opts.fileName ?? 'ui.ui';
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? fileName;
  const name = base.replace(/\.ui$/i, '');
  const errors: string[] = [];
  const fail = (line: number, message: string): void => void errors.push(`${fileName}:${line}: ${message}`);

  const drafts: Draft[] = [];
  const byName = new Map<string, Draft>();
  const components: string[] = [];
  const lineOf: Record<string, number> = {};
  let current: Draft | null = null;
  /** 当前层（v0.5 分段行 `layer base|overlay` 切换），默认 base。 */
  let currentLayer: LayerName = 'base';

  /** 解析分段行 `layer <name>`：切换后续 region 的归属层。 */
  const parseLayer = (tokens: readonly Token[], line: number): void => {
    const read = readLayer(tokens, 1, 'layer');
    if (!read.ok) { fail(line, read.message); return; }
    currentLayer = read.layer;
  };

  /** 解析 region 行。 */
  const parseRegion = (tokens: readonly Token[], line: number): void => {
    const regionName = tokens[1]?.text;
    if (regionName === undefined || !IDENT.test(regionName)) {
      fail(line, `region 需要一个合法的标识符作为名字（[a-zA-Z_][a-zA-Z0-9_]*），收到 '${regionName ?? '（缺值）'}'`);
      return;
    }
    const defined = byName.get(regionName);
    if (defined !== undefined) { fail(line, `region '${regionName}' 重复定义（第 ${defined.line} 行已定义）`); return; }

    // v0.6：overlay 的 edge 不参与求解，允许省略（`region tip at 30% 70% size 60% 18%`）
    let index = 2;
    const edgeToken = tokens[index]?.text;
    const matchedEdge = EDGES.find((e) => e === edgeToken);
    let edge: 'top' | 'bottom' | 'fill';
    if (matchedEdge !== undefined) {
      edge = matchedEdge;
      index = 3;
    } else if (currentLayer === 'overlay') {
      edge = 'fill';
    } else {
      fail(line, `region '${regionName}' 的边必须是 top / bottom / fill，收到 '${edgeToken ?? '（缺值）'}'`);
      return;
    }

    let height: Size | undefined;
    if (matchedEdge !== undefined && edge !== 'fill') {
      // v0.2：高度可以是像素，也可以是视口高百分比（`9%`）
      const read = readLength(tokens, index, `region '${regionName}' 的 ${edge} 高度`);
      if (!read.ok) { fail(line, read.message); return; }
      height = read.size;
      index = read.next;
    }

    let direction: 'row' | 'column' = 'column';
    let gap: Length | undefined;
    let pad: Length | undefined;
    let padX: Length | undefined;
    let padY: Length | undefined;
    let align: Align | undefined;
    let justify: Justify | undefined;
    let at: { readonly x: Length; readonly y: Length } | undefined;
    let regionSize: { readonly w: Length; readonly h: Length } | undefined;
    let directionSeen = false;
    while (index < tokens.length) {
      const word = tokens[index]?.text ?? '';
      if (word === 'row' || word === 'column') {
        if (directionSeen) fail(line, `region '${regionName}' 的排布方向重复指定`);
        directionSeen = true;
        direction = word;
        index += 1;
        continue;
      }
      if (word === 'gap' || word === 'pad' || word === 'pad-x' || word === 'pad-y') {
        // v0.3：这四个都接受百分比（基数按方向取，由布局引擎决定）
        const read = readLength(tokens, index + 1, `region '${regionName}' 的 ${word}`);
        if (!read.ok) { fail(line, read.message); return; }
        const value = toLength(read.size);
        if (word === 'gap') gap = value;
        else if (word === 'pad') pad = value;
        else if (word === 'pad-x') padX = value;
        else padY = value;
        index = read.next;
        continue;
      }
      if (word === 'align') {
        const read = readAlign(tokens, index + 1, `region '${regionName}'`);
        if (!read.ok) { fail(line, read.message); return; }
        align = read.align;
        index = read.next;
        continue;
      }
      if (word === 'justify') {
        const read = readJustify(tokens, index + 1, `region '${regionName}'`);
        if (!read.ok) { fail(line, read.message); return; }
        justify = read.justify;
        index = read.next;
        continue;
      }
      if (word === 'at' || word === 'size') {
        // v0.6：`at <x> <y>` 中心点 / `size <w> <h>` 宽高
        const pair = readLengthPair(
          tokens,
          index + 1,
          `region '${regionName}' 的 ${word}`,
          word === 'at' ? ['x', 'y'] : ['宽', '高'],
        );
        if (!pair.ok) { fail(line, pair.message); return; }
        if (word === 'at') {
          if (currentLayer !== 'overlay') {
            fail(line, `region '${regionName}' 的 at 只能用在 layer overlay 里（base 是流布局，位置由流决定）`);
            return;
          }
          at = { x: pair.first, y: pair.second };
        } else {
          regionSize = { w: pair.first, h: pair.second };
        }
        index = pair.next;
        continue;
      }
      fail(
        line,
        `region '${regionName}' 里不认识的修饰词 '${word}'（可用：${REGION_DIRECTIONS.join(' / ')} / ${describeRegionModifiers()}）`,
      );
      return;
    }

    // v0.6：at 与 size 必须成对——没有 size 就不知道内容多大，不能靠 measure 猜（组件可能还没绑定）
    if (at !== undefined && regionSize === undefined) {
      fail(line, `region '${regionName}' 的 at 必须配 size <w> <h>（没有 size 就不知道内容多大，不能靠 measure 猜）`);
      return;
    }
    if (regionSize !== undefined && at === undefined) {
      fail(line, `region '${regionName}' 的 size 只能和 at 一起用（base 的带高写在 edge 后面，如 \`top 48\`）`);
      return;
    }

    // pad-x / pad-y 覆盖 pad 的对应两轴（v0.2）；一个都没写时不产出该字段
    const padding: LengthInsets | undefined =
      pad === undefined && padX === undefined && padY === undefined
        ? undefined
        : { top: padY ?? pad ?? 0, right: padX ?? pad ?? 0, bottom: padY ?? pad ?? 0, left: padX ?? pad ?? 0 };
    const draft: Draft = {
      name: regionName,
      edge,
      layer: currentLayer,
      height,
      padding,
      direction,
      gap,
      align,
      justify,
      ...(at === undefined ? {} : { at }),
      ...(regionSize === undefined ? {} : { regionSize }),
      children: [],
      line,
    };
    drafts.push(draft);
    byName.set(regionName, draft);
    current = draft;
  };

  /** 解析 put 行：真正的解析在 parse-put.ts，这里只补 `文件:行号:` 前缀并记录组件。 */
  const parsePut = (tokens: readonly Token[], line: number): void => {
    const parsed = parsePutLine(tokens, {
      ...(opts.knownComponents === undefined ? {} : { knownComponents: opts.knownComponents }),
      ...(opts.componentProps === undefined ? {} : { componentProps: opts.componentProps }),
      hasRegion: current !== null,
    });
    for (const message of parsed.errors) fail(line, message);
    if (parsed.node === undefined || parsed.component === undefined || current === null) return;
    current.children.push(parsed.node);
    if (lineOf[parsed.component] === undefined) lineOf[parsed.component] = line;
    if (!components.includes(parsed.component)) components.push(parsed.component);
  };

  source.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) return;
    const tokens = tokenize(trimmed);
    const verb = tokens[0]?.text;
    if (verb === 'region') parseRegion(tokens, line);
    else if (verb === 'put') parsePut(tokens, line);
    else if (verb === 'layer') parseLayer(tokens, line);
    else fail(line, `不认识的语句 '${verb ?? ''}'（只有 ${UI_VERBS.join(' / ')} 这几种行）`);
  });

  const regions: RegionSpec[] = drafts.map((draft) => {
    const stack: StackSpec | undefined =
      draft.children.length === 0
        ? undefined
        : {
            direction: draft.direction,
            ...(draft.gap === undefined ? {} : { gap: draft.gap }),
            ...(draft.align === undefined ? {} : { align: draft.align }),
            ...(draft.justify === undefined ? {} : { justify: draft.justify }),
            children: draft.children,
          };
    return {
      name: draft.name,
      edge: draft.edge,
      ...(draft.layer === 'base' ? {} : { layer: draft.layer }),
      ...(draft.height === undefined ? {} : { height: draft.height }),
      ...(draft.at === undefined ? {} : { at: draft.at }),
      ...(draft.regionSize === undefined ? {} : { size: draft.regionSize }),
      ...(draft.padding === undefined ? {} : { padding: draft.padding }),
      ...(stack === undefined ? {} : { node: { stack } }),
    };
  });

  return { name, spec: { regions }, components, lines: lineOf, source: fileName, errors };
};

// 语法表的对外出口：`mg.ui.grammar()` 从这里取，不从手写文档抄。
export {
  ALIGNS, ERROR_FORMAT, HIT_MODES, HIT_VALUES, JUSTIFY_VALUES, LAYER_NAMES, LENGTH_FORMS, PERCENT_BASIS, PUT_MODIFIERS,
  REGION_DIRECTIONS, REGION_EDGES, REGION_MODIFIERS, SIZE_FORMS, STYLE_VALUE_TYPES, UI_GRAMMAR, UI_SYNTAX_VERSION, UI_VERBS,
  describeGrammar,
} from './grammar';
export type { PercentBasis, UiGrammar } from './grammar';
