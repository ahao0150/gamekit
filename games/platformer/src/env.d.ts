/**
 * `.ui` 模块的类型声明（产物形状见 `@mg/ui-plugin` 的 compile.ts / 规范 §7）。
 *
 * 为什么手写而不是插件自动生成：类型要参与 `tsc` 检查，而插件跑在 Vite 里。
 * 产物就是纯数据（name / spec / components / source / lines），照抄一份即可。
 */
declare module '*.ui' {
  import type { LayoutSpec } from '../../../packages/runtime/src/core/ui/layout';

  const ui: {
    readonly name: string;
    /** 可直接喂给 `layout()`（T3）。 */
    readonly spec: LayoutSpec;
    /** 用到的组件名（首次出现顺序）。 */
    readonly components: readonly string[];
    /** 源文件相对路径（报错定位用）。 */
    readonly source: string;
    /** 组件名 → 首次出现的源行号。 */
    readonly lines: Readonly<Record<string, number>>;
  };
  export default ui;
}
