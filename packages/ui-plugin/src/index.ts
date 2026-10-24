/**
 * `@mg/ui-plugin`：把 `.ui` 文件编译成数据模块的 Vite 插件。
 *
 * 为什么单独一个包：`packages/vite-plugin` 正在被图集改造，`.ui` 与图集是两条
 * 独立的编译链，混在一起会让两边互相阻塞。这个包只做一件事：**拦 `.ui` → 编译**。
 *
 * 另：构建结束时核对 ui/ 下每个 .ui 是否都被 import（见 orphan-ui.ts）。
 */

import { relative } from 'node:path';
import type { Plugin } from 'vite';
import { compileUi } from './compile';
import type { CompileOptions } from './compile';
import type { ComponentRegistry } from '../../runtime/src/core/ui/components';
import { filterOrphans, formatOrphanUiError, listProjectUiFiles } from './orphan-ui';

export interface UiPluginOptions extends CompileOptions {
  /** 只编译这些路径下的 `.ui`；默认全部 */
  readonly include?: (fileName: string) => boolean;
  /**
   * 是否在 build 结束时检查「ui/ 下每个 .ui 都被 import」。
   * 默认 true；dev 热更新不拦（只在 `command === 'build'` 时检查）。
   */
  readonly checkOrphans?: boolean;
  /**
   * 有意不接线的 `.ui`（相对项目根、`/` 分隔），跳过孤儿检查。
   * 例：`games/ui-demo/ui/widgets.ui` 是组件库 demo，只给离线 `ui.check` / `preview` 用。
   */
  readonly orphanExclude?: readonly string[];
}

/**
 * 从组件注册表生成编译选项（T7）。
 *
 * 为什么必须这样：构建期校验「组件名 / style 键」和运行时绘制用的是**同一份**
 * 注册表，否则会出现「构建说合法、运行时说未知组件」的割裂。调用方一行：
 * `uiPlugin(optionsFromRegistry(createBuiltinRegistry()))`。
 */
export const optionsFromRegistry = (registry: ComponentRegistry): CompileOptions => ({
  knownComponents: registry.names(),
  componentProps: registry.propKeys(),
});

/** `.ui` 模块的落点：产物里导出编译好的数据对象。 */
export const uiPlugin = (options: UiPluginOptions = {}): Plugin => {
  let root = process.cwd();
  let isBuild = false;
  const transformed = new Set<string>();
  return {
    name: 'mg:ui',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
      isBuild = config.command === 'build';
    },
    transform(code, id) {
      const clean = id.split('?')[0] ?? id;
      if (!clean.endsWith('.ui')) return null;
      const fileName = relative(root, clean).replace(/\\/g, '/');
      if (options.include !== undefined && !options.include(fileName)) return null;
      transformed.add(fileName);
      const result = compileUi(code, fileName, options);
      if (result.errors.length > 0) {
        this.error(`\n${result.errors.join('\n')}\n`);
      }
      return { code: result.code, map: null };
    },
    buildEnd() {
      if (!isBuild || options.checkOrphans === false) return;
      const discovered = listProjectUiFiles(root);
      const orphans = filterOrphans(discovered, transformed, options.orphanExclude);
      if (orphans.length > 0) this.error(`\n${formatOrphanUiError(orphans)}\n`);
    },
  };
};

export { compileUi } from './compile';
export type { CompileOptions, CompileResult, UiModule } from './compile';
export { parse } from '../../runtime/src/core/ui/parse';
export { formatOrphanUiError, listProjectUiFiles } from './orphan-ui';
