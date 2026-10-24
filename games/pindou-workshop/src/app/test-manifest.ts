/**
 * 测试替身：`virtual:mg-manifest` 由 `@mg/vite` 在构建时注入（扫描 `assets/` 生成），
 * Node 测试里没有构建步骤，所以 `vitest.config.ts` 把它 alias 到这里。
 *
 * 空清单 = 「一张图都加载不到」——正好是缺图回退分支的测试环境。
 */

export const manifest: Readonly<Record<string, readonly string[]>> = {};
export default manifest;
