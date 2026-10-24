/**
 * Vite 注入的编译期常量类型声明。
 *
 * 为什么需要自己声明：仓库没有装 `vite/client`（框架侧不改依赖树），
 * 但 debug 模块要靠 `import.meta.env.DEV` 做「构建期剔除」的条件判断 ——
 * 这是唯一能让调试代码在生产包里零残留的机制，所以类型必须补上。
 *
 * 注意：只能写 `import.meta.env.DEV` 这个**完整成员表达式**。Vite 的 define
 * 替换按 AST 精确匹配，写成 `(import.meta as X).env.DEV` 就不会被替换，
 * debug 代码会原封不动留在生产包里。
 */

interface ImportMetaEnv {
  /** Vite dev server 为 true，任何 build 为 false */
  readonly DEV: boolean;
  /** 构建模式为 true，dev server 为 false */
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
