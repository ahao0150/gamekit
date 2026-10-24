/**
 * Node 直接运行 TS 源码时的 resolve 钩子。
 *
 * 背景：仓库当前用 `tsc --noEmit`（不产出 JS），而 `mg` 命令要在没有构建产物的
 * 情况下就能跑。Node 22+ 能剥离 TS 类型，但 ESM 不会自动补扩展名，而源码里的
 * 相对导入都是无扩展名写法（`./args`、`./commands/build`）。
 *
 * 这个钩子只做一件事：把无扩展名的相对导入依次试成 `.ts` / `.tsx` / `/index.ts`。
 * 将来有了 dist 构建产物（或全仓改成显式扩展名）后，本文件与 register 一行即可删除。
 */

import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CANDIDATES = ['.ts', '.tsx', '/index.ts'];

/**
 * @param {string} specifier
 * @param {{ parentURL?: string }} context
 * @param {(specifier: string, context: unknown) => Promise<unknown>} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.')) {
    const parent =
      context.parentURL === undefined ? process.cwd() : dirname(fileURLToPath(context.parentURL));
    const base = resolvePath(parent, specifier);
    for (const suffix of CANDIDATES) {
      const file = `${base}${suffix}`;
      if (existsSync(file)) {
        return { url: pathToFileURL(file).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
