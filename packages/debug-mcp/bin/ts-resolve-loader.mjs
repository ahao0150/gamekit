/**
 * Node 直接运行 TS 源码时的 resolve 钩子。
 *
 * 与 `packages/cli/bin/ts-resolve-loader.mjs` 同源、同职责：把无扩展名的相对
 * 导入依次试成 `.ts` / `.tsx` / `/index.ts`。复制而不是跨包 import，是因为
 * 这是个「给 Node 用的加载钩子」，跨包相对路径引用会让两个包的可执行入口绑死。
 *
 * 将来全仓改成显式扩展名（或产出 dist）之后，本文件与 bin 里的 register 一行即可删除。
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
    const parent = context.parentURL === undefined ? process.cwd() : dirname(fileURLToPath(context.parentURL));
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
