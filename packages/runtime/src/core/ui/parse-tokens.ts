/**
 * `.ui` 的词法与尺寸表达式：tokenizer + `fill/auto/fixed n/ratio r` 解析。
 *
 * 从 `parse.ts` 拆出来是为了守 AGENTS 铁律 2（单文件 ≤300 行）：这一块是纯字符串
 * 处理，不碰解析状态机，独立出来也更好测。
 */

import type { Align, HitMode, Justify, LayerName, Length, Size, StyleValue } from './layout';

/** 一个 token。`quoted` 表示它出现过引号（值里可能有空格）。 */
export interface Token {
  readonly text: string;
  readonly quoted: boolean;
}

/** 标识符：region / 组件名都必须是这个形状。 */
export const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
export const EDGES = ['top', 'bottom', 'fill'] as const;
export const ALIGNS: readonly Align[] = ['start', 'center', 'end', 'stretch'];
/** 主轴对齐取值（v0.4）。错误文案与语法表都从这份生成，不手抄。 */
export const JUSTIFIES: readonly Justify[] = ['start', 'center', 'end', 'space-between'];
/** 层名（v0.5）：base 流布局，overlay 独立整屏、彼此重叠。 */
export const LAYER_NAMES: readonly LayerName[] = ['base', 'overlay'];
/** 命中语义（v0.5，实现在 hit.ts；这里只做词法）。 */
export const HIT_MODES: readonly HitMode[] = ['self', 'block', 'none'];

/** 按空白切词；双引号内的空白不切，引号本身不进 token。 */
export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line.charAt(i))) i += 1;
    if (i >= line.length) break;
    let text = '';
    let quoted = false;
    while (i < line.length && !/\s/.test(line.charAt(i))) {
      const ch = line.charAt(i);
      if (ch === '"') {
        quoted = true;
        i += 1;
        while (i < line.length && line.charAt(i) !== '"') {
          text += line.charAt(i);
          i += 1;
        }
        if (i < line.length) i += 1; // 结束引号
      } else {
        text += ch;
        i += 1;
      }
    }
    tokens.push({ text, quoted });
  }
  return tokens;
}

/**
 * style 值类型转换：true/false/纯数字 → 布尔/数字，其余字符串（规范 §5）。
 *
 * `quoted`（v0.6 修正）：值在 `.ui` 里**带引号**时原样当字符串，不参与布尔/数字转换。
 * 之前 `text="3"` 会被转成数字 `3`，导致声明为 `string` 的组件参数校验失败——
 * 引号本来就是作者「这是字符串」的显式意图，不该被类型猜测覆盖。
 */
export function coerceStyleValue(raw: string, quoted = false): string | number | boolean {
  if (quoted) return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  return raw.trim().length > 0 && Number.isFinite(n) ? n : raw;
}

/** 尺寸表达式解析结果。 */
export type SizeRead =
  | { readonly ok: true; readonly size: Size; readonly next: number }
  | { readonly ok: false; readonly message: string };

/**
 * `Size`（fixed / ratio）→ `Length`（v0.6）。
 *
 * pad / gap / region 的 at / size 只接受「像素或百分比」两种，不会出现 fill / auto；
 * 万一出现（词法层不可能，但类型上防一手）按 0 处理。
 */
export const toLength = (size: Size): Length => {
  if (typeof size === 'number') return size;
  if (size.kind === 'fixed') return size.n;
  if (size.kind === 'ratio') return { kind: 'ratio', r: size.r };
  return 0;
};

/**
 * 读一个「长度」：固定像素或百分比（v0.2）。
 *
 * 只允许 `n` 与 `n%` 两种（region 的 top/bottom 高度用它），不接受 fill/auto。
 * 百分比按**视口高**换算成 `ratio`，由布局引擎负责乘基数。
 */
export function readLength(tokens: readonly Token[], at: number, what: string): SizeRead {
  const token = tokens[at];
  if (token === undefined) return { ok: false, message: `${what} 缺少长度（可用：<n> 像素 或 <n>%）` };
  const word = token.text;
  if (word.endsWith('%')) {
    const pct = Number(word.slice(0, -1));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { ok: false, message: `${what} 的百分比必须在 0% 到 100% 之间，收到 '${word}'` };
    }
    return { ok: true, size: { kind: 'ratio', r: pct / 100 }, next: at + 1 };
  }
  const value = Number(word);
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, message: `${what} 必须是像素或百分比（如 48 / 9%），收到 '${word}'` };
  }
  return { ok: true, size: { kind: 'fixed', n: value }, next: at + 1 };
}

/**
 * 读一对长度（v0.6）：`at <x> <y>` 与 `region size <w> <h>` 共用。
 *
 * 只接受像素或百分比（`readLength` 的口径），不接受 fill / auto——
 * `at` / `size` 必须是确定的位置与尺寸，`fill` 在这里没有意义。
 * 第二个值缺失时错误文案会指到具体轴（`at 的 y`），而不是笼统的「缺少长度」。
 */
export type LengthPairRead =
  | { readonly ok: true; readonly first: Length; readonly second: Length; readonly next: number }
  | { readonly ok: false; readonly message: string };

export function readLengthPair(
  tokens: readonly Token[],
  start: number,
  what: string,
  axes: readonly [string, string],
): LengthPairRead {
  const first = readLength(tokens, start, `${what} 的 ${axes[0]}`);
  if (!first.ok) return first;
  const second = readLength(tokens, first.next, `${what} 的 ${axes[1]}`);
  if (!second.ok) return second;
  return {
    ok: true,
    first: toLength(first.size),
    second: toLength(second.size),
    next: second.next,
  };
}

/**
 * 读一个尺寸表达式：`fill` / `auto` / `fixed <n>` / `ratio <r>` / 裸数字（= fixed）/
 * `50%`（= ratio 0.5，v0.2）。
 *
 * 不直接报错而是返回 `message`：错误要带上「这是哪个字段」（size / cross），
 * 由调用方拼前缀，这样同一段逻辑能给两个字段复用。
 */
export function readSize(tokens: readonly Token[], at: number, what: string): SizeRead {
  const token = tokens[at];
  if (token === undefined) return { ok: false, message: `${what} 缺少尺寸值（可用：fill / auto / fixed <n> / ratio <r>）` };
  const word = token.text;
  if (word === 'fill') return { ok: true, size: { kind: 'fill' }, next: at + 1 };
  if (word === 'auto') return { ok: true, size: { kind: 'auto' }, next: at + 1 };
  if (word.endsWith('%')) {
    const pct = Number(word.slice(0, -1));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { ok: false, message: `${what} 的百分比必须在 0% 到 100% 之间，收到 '${word}'` };
    }
    return { ok: true, size: { kind: 'ratio', r: pct / 100 }, next: at + 1 };
  }
  if (word === 'fixed' || word === 'ratio') {
    const valueToken = tokens[at + 1];
    const value = valueToken === undefined ? Number.NaN : Number(valueToken.text);
    if (!Number.isFinite(value)) {
      return { ok: false, message: `${what} ${word} 需要一个数字，收到 '${valueToken?.text ?? '（缺值）'}'` };
    }
    if (word === 'fixed') {
      if (value < 0) return { ok: false, message: `${what} fixed 不能是负数，收到 ${value}` };
      return { ok: true, size: { kind: 'fixed', n: value }, next: at + 2 };
    }
    if (value < 0 || value > 1) return { ok: false, message: `${what} ratio 必须在 0 到 1 之间，收到 ${value}` };
    return { ok: true, size: { kind: 'ratio', r: value }, next: at + 2 };
  }
  const bare = Number(word);
  if (Number.isFinite(bare) && bare >= 0) return { ok: true, size: { kind: 'fixed', n: bare }, next: at + 1 };
  return { ok: false, message: `${what} 只接受 fill / auto / fixed <n> / ratio <r> / <n>%，收到 '${word}'` };
}

/** 读一个非负数字（gap / pad / region 高度共用）。 */
export function readNumber(tokens: readonly Token[], at: number, what: string): { readonly ok: true; readonly value: number; readonly next: number } | { readonly ok: false; readonly message: string } {
  const token = tokens[at];
  const value = token === undefined ? Number.NaN : Number(token.text);
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, message: `${what} 必须是非负数字，收到 '${token?.text ?? '（缺值）'}'` };
  }
  return { ok: true, value, next: at + 1 };
}

/** 读一个 align 值。 */
export function readAlign(tokens: readonly Token[], at: number, what: string): { readonly ok: true; readonly align: Align; readonly next: number } | { readonly ok: false; readonly message: string } {
  const raw = tokens[at]?.text ?? '';
  const align = ALIGNS.find((a) => a === raw);
  if (align === undefined) {
    return { ok: false, message: `${what} 的 align 只能是 start / center / end / stretch，收到 '${raw || '（缺值）'}'` };
  }
  return { ok: true, align, next: at + 1 };
}

/** 读一个 justify 值（v0.4 主轴对齐）。 */
export function readJustify(tokens: readonly Token[], at: number, what: string): { readonly ok: true; readonly justify: Justify; readonly next: number } | { readonly ok: false; readonly message: string } {
  const raw = tokens[at]?.text ?? '';
  const justify = JUSTIFIES.find((j) => j === raw);
  if (justify === undefined) {
    return { ok: false, message: `${what} 的 justify 只能是 ${JUSTIFIES.join(' / ')}，收到 '${raw || '（缺值）'}'` };
  }
  return { ok: true, justify, next: at + 1 };
}

/** 读一个层名（v0.5 分段行 `layer <name>`）。 */
export function readLayer(tokens: readonly Token[], at: number, what: string): { readonly ok: true; readonly layer: LayerName; readonly next: number } | { readonly ok: false; readonly message: string } {
  const raw = tokens[at]?.text ?? '';
  const layer = LAYER_NAMES.find((l) => l === raw);
  if (layer === undefined) {
    return { ok: false, message: `${what} 只能是 ${LAYER_NAMES.join(' / ')}，收到 '${raw || '（缺值）'}'` };
  }
  return { ok: true, layer, next: at + 1 };
}

/** 读一个命中语义（v0.5 `put ... hit <mode>`）。 */
export function readHit(tokens: readonly Token[], at: number, what: string): { readonly ok: true; readonly hit: HitMode; readonly next: number } | { readonly ok: false; readonly message: string } {
  const raw = tokens[at]?.text ?? '';
  const hit = HIT_MODES.find((h) => h === raw);
  if (hit === undefined) {
    return { ok: false, message: `${what} 的 hit 只能是 ${HIT_MODES.join(' / ')}，收到 '${raw || '（缺值）'}'` };
  }
  return { ok: true, hit, next: at + 1 };
}

/**
 * 读 `put` 的 style 键值对（规范 §5）：`k=v`，空格分隔，值按 `true/false/数字→布尔/数字` 转换。
 *
 * 抽到词法层是为了让 `parse.ts` 不破 300 行铁律（它是解析器里最长的分支）。
 * `what` 只用于错误文案（例如 `组件 primaryButton`），词法层不知道组件概念。
 *
 * @param allowed 该组件的合法参数键；undefined = 跳过键校验
 */
export function readStyle(
  tokens: readonly Token[],
  at: number,
  what: string,
  allowed: readonly string[] | undefined,
): { readonly ok: true; readonly props: Readonly<Record<string, StyleValue>>; readonly next: number } | { readonly ok: false; readonly message: string } {
  const props: Record<string, StyleValue> = {};
  let index = at;
  while (index < tokens.length) {
    const token = tokens[index];
    const pair = token?.text ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) return { ok: false, message: `style 需要 key=value 形式，收到 '${pair}'` };
    const key = pair.slice(0, eq);
    if (allowed !== undefined && !allowed.includes(key)) {
      return { ok: false, message: `style 键 '${key}' 不是${what} 的合法参数，可用：${allowed.join(' / ')}` };
    }
    // 值保留下来：T7 组件注册表要拿它做值校验并传给 measure / draw，不能只查不用。
    // 带引号的值强制当字符串（text="3" 保持 '3'），见 coerceStyleValue。
    props[key] = coerceStyleValue(pair.slice(eq + 1), token?.quoted === true);
    index += 1;
  }
  return { ok: true, props, next: index };
}
