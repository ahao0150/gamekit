#!/usr/bin/env node
/**
 * `mg` 命令的可执行入口。
 *
 * 仓库还没有 dist 构建产物（tsc 是 noEmit），所以这里用 Node 的类型剥离直接加载
 * TS 源码，并用 ts-resolve-loader 补上「无扩展名相对导入」的解析。
 *
 * 验收口径：零构建产物下 `node packages/cli/bin/mg.mjs --help` 与 `doctor` 必须能跑。
 */
import { register } from 'node:module';

register(new URL('./ts-resolve-loader.mjs', import.meta.url));

const { main } = await import('../src/index.ts');
process.exitCode = await main();
