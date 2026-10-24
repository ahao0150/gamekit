/**
 * `put` 行的解析（T33 从 `parse.ts` 抽出）。
 *
 * 抽出来是为了守 AGENTS 铁律 2（单文件 ≤300 行）：v0.6 的 `at` / `size` 让
 * `parse.ts` 的 region 分支变长，`put` 是里面最独立、最长的一段，正好搬走。
 *
 * 纯函数：tokens 进、`NodeSpec` + 错误列表出；错误是**裸中文说明**，
 * 由调用方补 `文件:行号:` 前缀（这样格式只有一个地方拼）。
 */

import type { Align, HitMode, NodeSpec, Size, StyleProps } from './layout';
import { PUT_MODIFIERS } from './grammar';
import { IDENT, readAlign, readHit, readSize, readStyle } from './parse-tokens';
import type { Token } from './parse-tokens';

export interface ParsePutOptions {
  /** 已注册组件名；给了（非空）就校验「未知组件」。 */
  readonly knownComponents?: readonly string[];
  /** 组件参数声明：组件名 → 合法 style 键。 */
  readonly componentProps?: Readonly<Record<string, readonly string[]>>;
  /** 当前是否已经定义过 region（`put` 必须在 region 之后）。 */
  readonly hasRegion: boolean;
}

export interface ParsedPut {
  readonly node?: NodeSpec;
  readonly component?: string;
  readonly errors: readonly string[];
}

/** 解析 `put <组件> [size ...] [cross ...] [align ...] [hit ...] [style k=v...]`。 */
export const parsePutLine = (tokens: readonly Token[], opts: ParsePutOptions): ParsedPut => {
  const errors: string[] = [];
  const component = tokens[1]?.text;
  if (component === undefined || !IDENT.test(component)) {
    errors.push(`put 需要一个组件名（[a-zA-Z_][a-zA-Z0-9_]*），收到 '${component ?? '（缺值）'}'`);
    return { errors };
  }
  const known = opts.knownComponents;
  if (known !== undefined && known.length > 0 && !known.includes(component)) {
    errors.push(`未知组件 '${component}'，已注册的有：${known.join(' / ')}`);
    return { errors };
  }
  if (!opts.hasRegion) {
    errors.push(`put '${component}' 之前没有 region（文件第 1 行开始就必须先定义 region）`);
    return { errors };
  }

  let size: Size = { kind: 'auto' };
  let cross: Size | undefined;
  let align: Align | undefined;
  let hit: HitMode | undefined;
  let props: StyleProps | undefined;
  let index = 2;
  while (index < tokens.length) {
    const word = tokens[index]?.text ?? '';
    if (word === 'size' || word === 'cross') {
      const read = readSize(tokens, index + 1, word);
      if (!read.ok) return { errors: [...errors, read.message] };
      if (word === 'size') size = read.size;
      else cross = read.size;
      index = read.next;
      continue;
    }
    if (word === 'align') {
      const read = readAlign(tokens, index + 1, `put '${component}'`);
      if (!read.ok) return { errors: [...errors, read.message] };
      align = read.align;
      index = read.next;
      continue;
    }
    if (word === 'hit') {
      const read = readHit(tokens, index + 1, `put '${component}'`);
      if (!read.ok) return { errors: [...errors, read.message] };
      hit = read.hit;
      index = read.next;
      continue;
    }
    if (word === 'style') {
      // 变量名与循环内的 index 分开：readStyle 从 index+1 开始吃，返回下一个游标
      const read = readStyle(tokens, index + 1, `组件 ${component}`, opts.componentProps?.[component]);
      if (!read.ok) return { errors: [...errors, read.message] };
      props = read.props;
      index = read.next;
      continue;
    }
    const putModifierList = PUT_MODIFIERS.map((m) =>
      m === 'style' ? 'style k=v…' : m === 'align' ? 'align <a>' : `${m} <尺寸>`,
    ).join(' / ');
    errors.push(`put '${component}' 里不认识的修饰词 '${word}'（可用：${putModifierList}）`);
    return { errors };
  }

  const node: NodeSpec = {
    name: component,
    size,
    ...(cross === undefined ? {} : { cross }),
    ...(align === undefined ? {} : { align }),
    ...(hit === undefined ? {} : { hit }),
    ...(props === undefined ? {} : { props }),
  };
  return { node, component, errors };
};
