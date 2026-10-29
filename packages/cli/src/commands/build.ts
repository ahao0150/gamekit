/**
 * `mg build [--target web|wx|tt] [--all] [--skip-typecheck]`
 *
 * 只做参数解析与调度：真正的三端构建在 `@mg/vite`（`mgPlugin`），这里不写任何
 * 构建逻辑。默认先跑 typecheck（可用 --skip-typecheck 跳过）。
 * `.ui` 是否都被 import 由 `@mg/ui-plugin` 在 build 结束时强制校验。
 */

import { build as viteBuild } from 'vite';
import { mgPlugin } from '@mg/vite-plugin';
import { boolFlag, parseArgs } from '../args';
import { messageOf, projectRoot, readGameConfig, resolveTargets } from '../shared';
import type { CommandRunner } from '../shared';
import { runTypecheck } from './typecheck';

export const runBuild: CommandRunner = async (argv, ctx) => {
  const parsed = parseArgs(argv);
  const root = projectRoot(ctx, parsed);
  const targets = resolveTargets(parsed, 'web');
  if (targets === null) {
    ctx.stderr('mg build: --target 只能是 web / wx / tt');
    return 1;
  }

  if (!boolFlag(parsed, 'skip-typecheck')) {
    const tc = runTypecheck(root, ctx);
    if (!tc.ok) return 1;
  }

  const config = readGameConfig(root);
  const design = config?.design;
  if (design === undefined) {
    ctx.stderr(
      'mg build: 找不到设计分辨率。在 game.config.json 写 {"design":{"width":390,"height":844}}（或 package.json 的 mg 字段）',
    );
    return 1;
  }

  for (const target of targets) {
    ctx.stdout(`[mg build] ${target} …`);
    try {
      await viteBuild({
        // Vite在插件config钩子前定位配置文件，必须提前指定项目根。
        root,
        plugins: [
          mgPlugin({
            target,
            root,
            design,
            fit: config?.fit,
            assetsDir: config?.assetsDir,
            subpackages: config?.subpackages,
            title: config?.title,
            atlas: config?.atlas,
          }),
        ],
        logLevel: 'warn',
      });
    } catch (error) {
      ctx.stderr(`mg build: ${target} 构建失败：${messageOf(error)}`);
      return 1;
    }
    ctx.stdout(`[mg build] ${target} 完成`);
  }
  return 0;
};
