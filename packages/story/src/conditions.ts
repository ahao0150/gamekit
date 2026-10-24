/**
 * 简单条件：flags.x == true / vars.gold >= 10
 */

import type { StoryState } from './contract';

const TRIM = (s: string): string => s.trim();

/** 求值；空条件视为 true。 */
export const evalCondition = (expr: string | undefined, state: StoryState): boolean => {
  if (expr === undefined || TRIM(expr).length === 0) return true;
  const m = TRIM(expr).match(/^(flags|vars)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*(==|>=|<=|>|<|!=)\s*(.+)$/);
  if (m === null) return false;
  const scope = m[1];
  const key = m[2];
  const op = m[3];
  const rhsRaw = m[4];
  if (scope === undefined || key === undefined || op === undefined || rhsRaw === undefined) return false;
  const rhs = TRIM(rhsRaw);
  let left: boolean | number;
  if (scope === 'flags') {
    left = state.flags[key] === true;
  } else {
    const v = state.vars[key];
    left = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  if (op === '==') {
    if (rhs === 'true') return left === true;
    if (rhs === 'false') return left === false;
    const n = Number(rhs);
    if (Number.isFinite(n)) return left === n;
    return String(left) === rhs.replace(/^["']|["']$/g, '');
  }
  const ln = typeof left === 'number' ? left : left ? 1 : 0;
  const rn = Number(rhs);
  if (!Number.isFinite(rn)) return false;
  if (op === '>=') return ln >= rn;
  if (op === '<=') return ln <= rn;
  if (op === '>') return ln > rn;
  if (op === '<') return ln < rn;
  if (op === '!=') return ln !== rn;
  return false;
};
