/**
 * `@mg/runtime` barrel 的**对外导出**契约测试。
 *
 * 为什么要单测这个：core 内部的测试全部用相对路径 import（`./core/net/index`），
 * **不经过 barrel**。于是 `packages/runtime/src/index.ts` 少导出一个公开 API 时，
 * 68 条测试照样全绿、typecheck 也照过 —— 只有真正按包名用的调用方才会撞
 * `TS2305: Module has no exported member`。
 *
 * 真实事故（2026-10-27）：`createCancel` 在 `core/net/index.ts` 里导出了，
 * 却没进 `src/index.ts` 的 barrel。所有测试走包内路径，谁都没发现；
 * 最后是写文档的 Bot 拿包名跑 tsc 才抓出来。
 *
 * 所以这里断言的是「**业务代码从包名拿得到**」，不是「core 里有实现」。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as runtime from './index';

describe('@mg/runtime barrel 对外导出', () => {
  it('网络能力：三个入口都从包名可见', () => {
    // createCancel 是取消能力的唯一入口；漏了它 = 游戏里没法取消请求
    expect(typeof runtime.createCancel).toBe('function');
    expect(typeof runtime.request).toBe('function');
    expect(typeof runtime.openSocket).toBe('function');
  });

  it('网络常量与默认值可见', () => {
    expect(runtime.NET_DEFAULTS).toBeDefined();
    expect(runtime.NO_RETRY).toBeDefined();
    expect(typeof runtime.SOCKET_QUEUE_LIMIT).toBe('number');
  });

  it('createCancel 造出来的对象形状可用（不是只导出一个空壳）', () => {
    const cancel = runtime.createCancel();
    expect(cancel.signal.aborted).toBe(false);
    expect(typeof cancel.signal.onAbort).toBe('function');
    expect(typeof cancel.abort).toBe('function');
    cancel.abort();
    expect(cancel.signal.aborted).toBe(true);
  });

  it('其余既有能力未被这次改动碰坏（抽样）', () => {
    expect(typeof runtime.createLoop).toBe('function');
    expect(typeof runtime.createSave).toBe('function');
    expect(typeof runtime.resolvePlatform).toBe('function');
    expect(typeof runtime.createDefaultUiRegistry).toBe('function');
  });
});

/**
 * `package.json` 的 `exports` 是**对外的第二张脸**，和 barrel 一样没有测试守着。
 *
 * 为什么不用「按包名 import 一下」来测：仓库内的测试**解析不了** `@mg/runtime/platform`
 * 这类 subpath（实测 3 个 `Cannot find package`，只有 `/mock` 因为 vitest alias 能过）。
 * 能按包名用它们的只有 `games/**`（workspace link）。所以这里改测**静态一致性**：
 * 声明出来的每个入口都指向真实存在的文件。游戏侧「真能 import」由各游戏的 tsc 兜住。
 */
describe('package.json exports 契约', () => {
  const pkgDir = new URL('..', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    exports: Record<string, string>;
  };

  it('五个公开入口齐全（少一个 = 游戏侧 import 直接炸）', () => {
    expect(Object.keys(pkg.exports).sort()).toEqual([
      '.',
      './extension',
      './mock',
      './platform',
      './platform/adapters',
    ]);
  });

  it('每个入口都指向真实存在的文件', () => {
    const missing: string[] = [];
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      if (!existsSync(new URL(target, pkgDir))) missing.push(`${subpath} → ${target}`);
    }
    expect(missing).toEqual([]);
  });
});
