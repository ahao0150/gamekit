#!/usr/bin/env node
/**
 * `mg-debug-mcp` 可执行入口。
 *
 * 与 `packages/cli/bin/mg.mjs` 同一种做法：仓库用 `tsc --noEmit`（不产出 JS），
 * 所以用 Node 的类型剥离直接加载 TS 源码，再用 resolve 钩子补上「无扩展名相对导入」。
 * 差别只在这里不接 CLI 参数解析，只认 `--port`。
 */
import { register } from 'node:module';

register(new URL('./ts-resolve-loader.mjs', import.meta.url));

const { main } = await import('../src/index.ts');
process.exitCode = await main();
