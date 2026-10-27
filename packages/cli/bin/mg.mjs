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

/**
 * 压掉 Vite 8 的 `configLoader: 'native'` 预检警告。
 *
 * 它列的是「未来 native 成为默认时」会不支持的语法 —— 整棵 vite.config.ts 依赖树里的
 * 无扩展名相对导入，本仓库共 **1676 处 / 464 个文件**（引擎 + 全部游戏）。
 * 当前 `configLoader` 默认就是 `bundle`，功能与产物**完全不受影响**，只是每次
 * dev/build 会刷 200+ 行警告。
 *
 * 实测过两条看似更「正」的路都不行：
 * - `--configLoader bundle` 显式声明 → 警告照旧 246 条（预检不看这个参数）
 * - 给 1676 处导入补 `.ts` → 要连 tsconfig 的 `allowImportingTsExtensions` 一起改，
 *   波及引擎与每个游戏，为一个前瞻提醒引入的巨大 diff 不划算
 *
 * 所以用 Vite 官方在警告末行自己给的开关。等 Vite 真把 native 设为默认（那是 major
 * 版本），再按当时的迁移路径成批补扩展名。想看原警告时：`MG_KEEP_VITE_CONFIG_WARNING=1`。
 */
if (process.env.MG_KEEP_VITE_CONFIG_WARNING !== '1') {
  process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING ??= 'true';
}

register(new URL('./ts-resolve-loader.mjs', import.meta.url));

const { main } = await import('../src/index.ts');
process.exitCode = await main();
