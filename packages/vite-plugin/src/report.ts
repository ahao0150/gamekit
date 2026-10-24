/** 包体统计。4MB 是微信/抖音平台硬限，超了打红字告警但不 throw；mg check 另有 3MB 团队保守线。 */
import { readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { MAIN_LIMIT_BYTES } from './types';
import type { BundleReport, MgTarget } from './types';
export interface FileSize {
  /** 相对产物根目录，统一 `/` 分隔 */
  readonly relative: string;
  readonly bytes: number;
}
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
/** 递归列出目录下所有文件；目录不存在返回空。 */
export const listFiles = (root: string): FileSize[] => {
  try {
    return readdirSync(root, { recursive: true, encoding: 'utf8' })
      .map((path) => path.split(sep).join('/'))
      .map((relative) => ({ relative, bytes: statSync(join(root, relative)).size }));
  } catch {
    return [];
  }
};
export const kb = (bytes: number): number => Math.round((bytes / 1024) * 10) / 10;
/** `subpackages/<name>/...` 进对应分包，其余算主包。 */
export const computeReport = (
  files: readonly FileSize[],
  subpackageNames: readonly string[],
): BundleReport => {
  const buckets = new Map<string, number>();
  let main = 0;
  let total = 0;
  for (const file of files) {
    total += file.bytes;
    const parts = file.relative.split('/');
    const name = parts[0] === 'subpackages' ? parts[1] : undefined;
    if (name === undefined || parts.length < 3) main += file.bytes;
    else buckets.set(name, (buckets.get(name) ?? 0) + file.bytes);
  }
  const names = [...subpackageNames];
  for (const name of buckets.keys()) if (!names.includes(name)) names.push(name);
  return {
    main,
    subpackages: names.map((name) => ({ name, bytes: buckets.get(name) ?? 0 })),
    total,
    files: files.length,
    limitBytes: MAIN_LIMIT_BYTES,
    ok: main <= MAIN_LIMIT_BYTES,
  };
};
/** 构建结束打印；web 没有主包限制，只报总量。 */
export const formatReport = (report: BundleReport, target: MgTarget): string => {
  const size = `合计 ${kb(report.total)} KB，${report.files} 个文件`;
  if (target === 'web') return `mg 产物（web）：${size}`;
  const sub = report.subpackages.map((s) => `${s.name} ${kb(s.bytes)} KB`).join(' / ');
  const head = `mg 包体（${target}）：主包 ${kb(report.main)} KB${sub === '' ? '' : ` / 分包 ${sub}`} / ${size}`;
  return report.ok ? head : `${RED}✗ ${head} —— 主包超过 4MB 平台硬限${RESET}`;
};
