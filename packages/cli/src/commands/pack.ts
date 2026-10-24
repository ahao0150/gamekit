/**
 * `mg pack [--root <dir>] [--write]`
 *
 * 骨架：先统计 assets/ 下的图片与「同名多格式」组，给出压缩前的基线数据。
 * 真正压缩/图集流水线属于后续里程碑（把 imgcompress 的能力迁进 tools/），
 * 所以在 --write 下明确报未实现、返回非零，而不是假装做完。
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { boolFlag, parseArgs } from '../args';
import { formatBytes, projectRoot, readGameConfig, walkFiles } from '../shared';
import type { CommandRunner } from '../shared';

const IMAGE_EXT = /\.(png|webp|jpe?g|gif)$/i;

export const runPack: CommandRunner = async (argv, ctx) => {
  const parsed = parseArgs(argv);
  const root = projectRoot(ctx, parsed);
  const config = readGameConfig(root);
  const assetsDir = resolve(root, config?.assetsDir ?? 'assets');

  if (!existsSync(assetsDir)) {
    ctx.stderr(`mg pack: 资源目录不存在：${assetsDir}`);
    return 1;
  }

  const images = walkFiles(assetsDir).filter((file) => IMAGE_EXT.test(file.relative));
  const totalBytes = images.reduce((sum, file) => sum + file.bytes, 0);

  const groups = new Map<string, string[]>();
  for (const file of images) {
    const key = file.relative.replace(/\.[^.]+$/, '');
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [file.relative]);
    else list.push(file.relative);
  }
  const duplicates = [...groups.values()].filter((paths) => paths.length > 1);

  ctx.stdout(`mg pack: ${assetsDir}`);
  ctx.stdout(`- 图片 ${images.length} 张，合计 ${formatBytes(totalBytes)}`);
  if (duplicates.length > 0) {
    ctx.stdout(`- 同名多格式 ${duplicates.length} 组（压缩时按 webp 优先择优，见插件规则）：`);
    for (const paths of duplicates) ctx.stdout(`  · ${paths.join(' / ')}`);
  }

  if (boolFlag(parsed, 'write')) {
    ctx.stderr('mg pack: 压缩/图集流水线尚未实现，本次未写入任何文件');
    return 1;
  }
  ctx.stdout('dry-run：只统计不压缩。加 --write 走流水线（待实现）');
  return 0;
};
