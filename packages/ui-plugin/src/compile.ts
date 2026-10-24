/**
 * `.ui` → 数据模块 的编译函数。
 *
 * **dev 与 build 必须走同一个函数** —— 这是图集插件踩过的坑：两条路径各写一份，
 * dev 看着没问题、build 出来的东西不一样。所以 Vite 插件里只做「拦 id + 调这里 +
 * 报错」，不写任何自己的解析逻辑。
 *
 * 产物是一个纯数据模块（`export default {name, spec, components, source, lines}`），
 * 运行时不需要解析器；`spec` 可以直接喂 `layout()`。
 */

import { parse } from '../../runtime/src/core/ui/parse';
import type { LayoutSpec } from '../../runtime/src/core/ui/layout';

export interface CompileOptions {
  readonly knownComponents?: readonly string[];
  readonly componentProps?: Readonly<Record<string, readonly string[]>>;
}

/** 编译产物（规范 §7）。 */
export interface UiModule {
  readonly name: string;
  readonly spec: LayoutSpec;
  readonly components: readonly string[];
  readonly source: string;
  readonly lines: Readonly<Record<string, number>>;
}

export interface CompileResult {
  /** 成功时的 TS 模块源码；失败时为空串 */
  readonly code: string;
  /** 规范 §6 格式的错误（`<file>:<line>: <说明>`），一次报全 */
  readonly errors: readonly string[];
  /** 解析出的数据（失败时是解析到的部分，方便测试断言） */
  readonly module: UiModule | null;
}

export const compileUi = (source: string, fileName: string, options: CompileOptions = {}): CompileResult => {
  const parsed = parse(source, { ...options, fileName });
  const uiModule: UiModule = {
    name: parsed.name,
    spec: parsed.spec,
    components: parsed.components,
    source: parsed.source,
    lines: parsed.lines,
  };
  if (parsed.errors.length > 0) return { code: '', errors: parsed.errors, module: uiModule };
  // 产物是纯数据：JSON.stringify 之后就确定没有函数混进来（spec 只含数字/字符串/对象）
  const code = `// 由 @mg/ui-plugin 从 ${parsed.source} 编译，不要手改\nexport default ${JSON.stringify(uiModule)};\n`;
  return { code, errors: [], module: uiModule };
};
