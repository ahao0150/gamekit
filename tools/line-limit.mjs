/**
 * 单文件行数的软限制判定（纯函数，供 `tools/lint.mjs` 与测试共用）。
 *
 * 300 行是提醒线，500 行是警告线 —— 都只产生 warning/notice，不产生 violation，
 * 因此不会让 lint 以非零码退出。确需长文件时，在文件前 5 行内写
 * `// @long-file <原因>`；原因必须非空，否则不豁免。
 */

export const SOFT_LINE_LIMIT = 300;
export const HARD_WARN_LINE_LIMIT = 500;
export const LONG_FILE_EXEMPT = '@long-file';

/** 只认文件前 5 行里的 `// @long-file <原因>` 注释。 */
const EXEMPT_SCAN_LINES = 5;
const EXEMPT_PATTERN = new RegExp(String.raw`^\s*//\s*${LONG_FILE_EXEMPT}\b(.*)$`);

/**
 * 查前 5 行里的豁免标记。
 * @returns {{ found: boolean, reason: string }}
 */
function findExemption(lines) {
  const limit = Math.min(EXEMPT_SCAN_LINES, lines.length);
  for (let i = 0; i < limit; i += 1) {
    const m = EXEMPT_PATTERN.exec(lines[i]);
    if (m !== null) return { found: true, reason: m[1].trim() };
  }
  return { found: false, reason: '' };
}

/**
 * @param {string} rel 仓库相对路径（只用于文案）
 * @param {string[]} lines 文件内容按行拆分后的数组
 * @returns {{ level: 'ok' | 'notice' | 'warning', message?: string }}
 */
export function checkLineLimit(rel, lines) {
  const count = lines.length;
  const exempt = findExemption(lines);

  if (exempt.found && exempt.reason !== '') {
    return { level: 'ok' };
  }

  const missingReason = exempt.found
    ? `${rel}: ${LONG_FILE_EXEMPT} 没写原因，不豁免（写成 // ${LONG_FILE_EXEMPT} <原因>）`
    : '';

  if (count > HARD_WARN_LINE_LIMIT) {
    const tail = missingReason ? `；${missingReason}` : '';
    return {
      level: 'warning',
      message: `${rel}:${count} 行，超过警告线 ${HARD_WARN_LINE_LIMIT}（先拆；确需保留请写 // ${LONG_FILE_EXEMPT} <原因>）${tail}`,
    };
  }

  if (count > SOFT_LINE_LIMIT) {
    // 写了标记却没写原因，按 warning 报，而不是放行成 notice。
    const level = missingReason ? 'warning' : 'notice';
    const tail = missingReason ? `；${missingReason}` : '';
    return {
      level,
      message: `${rel}:${count} 行，超过提醒线 ${SOFT_LINE_LIMIT}（先拆；确需保留请写 // ${LONG_FILE_EXEMPT} <原因>）${tail}`,
    };
  }

  if (missingReason !== '') {
    return { level: 'warning', message: missingReason };
  }

  return { level: 'ok' };
}
