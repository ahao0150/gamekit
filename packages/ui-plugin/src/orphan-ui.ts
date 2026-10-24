/**
 * 构建期：发现 ui/ 下每个 .ui 并核对是否都被 import（transform 过）。
 *
 * 坑：新建了 `ui/foo.ui` 却忘了在 layout 里 import → tree-shake 后产物不变、也不报错，
 * 界面等于没接上。这里在 `mg build` 结束时把漏网的列出来。
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const walkUi = (dir: string, root: string, out: string[]): void => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkUi(full, root, out);
      continue;
    }
    if (name.endsWith('.ui')) out.push(relative(root, full).replace(/\\/g, '/'));
  }
};

/** 列出项目根下 `ui/` 里所有 `.ui`（相对 root，`/` 分隔）。 */
export const listProjectUiFiles = (root: string): readonly string[] => {
  const out: string[] = [];
  walkUi(join(root, 'ui'), root, out);
  out.sort();
  return out;
};

/** 中文报错：哪些 .ui 存在但构建没碰到（没被 import）。 */
export const formatOrphanUiError = (orphans: readonly string[]): string =>
  [
    '以下 .ui 文件存在但未被 import（不会进入 bindComponents，界面等于没接上）：',
    ...orphans.map((file) => `  - ${file}`),
    '每个 ui/*.ui 都必须在 layout 代码里 import，并交给 bindComponents。',
  ].join('\n');
