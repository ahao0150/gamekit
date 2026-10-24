/**
 * 极简参数解析：只做 `--flag` / `--flag value` / `--flag=value` / `--` /
 * 位置参数。不引第三方库——CLI 是 AI 读的代码，越少依赖越稳。
 */

export type FlagValue = string | true;

export interface ParsedArgs {
  /** 非选项参数，按出现顺序 */
  readonly positionals: readonly string[];
  /** 选项名（不含 `--`）→ 值；布尔选项值为 true */
  readonly flags: Readonly<Record<string, FlagValue>>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, FlagValue> = {};

  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    index += 1;
    if (token === undefined) break;

    // `--` 之后全部当位置参数（允许文件名以 - 开头）
    if (token === '--') {
      positionals.push(...argv.slice(index));
      break;
    }

    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const next = argv[index];
      if (next !== undefined && !next.startsWith('-')) {
        flags[body] = next;
        index += 1;
      } else {
        flags[body] = true;
      }
      continue;
    }

    // 单横线短选项：只当布尔开关，不支持组合
    if (token.length > 1 && token.startsWith('-')) {
      flags[token.slice(1)] = true;
      continue;
    }

    positionals.push(token);
  }

  return { positionals, flags };
}

/** 取字符串选项；布尔或未给都返回 undefined。 */
export function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === 'string' ? value : undefined;
}

/** 布尔选项是否为真。 */
export function boolFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags[name] === true;
}

/**
 * 取端口选项：只接受 1-65535 的整数字符串。
 *
 * 为什么在解析层就拒：端口传错（缺值、负数、0、小数、字母）应该在启动前
 * 就报错，而不是让下游拿一个怪值去猜 —— 「猜错了还能跑起来」比
 * 「直接失败」危险得多：门禁/CI 打在别的服务上却全绿，就是这么来的。
 */
export function portFlag(parsed: ParsedArgs, name: string): number | undefined {
  const raw = stringFlag(parsed, name);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) return undefined; // 负数、小数、字母、空串、带 + 号都不收
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return undefined;
  return value;
}
