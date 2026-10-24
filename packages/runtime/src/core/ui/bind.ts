/**
 * 把组件注册表绑到布局 spec 上（T7）。
 *
 * `parse()` 出来的 spec 只写了组件名，`layout()` 的 `auto` 需要 `measure`。
 * 绑定这一步做三件事：
 * 1. 给每个已注册组件注入 `measure`（闭包里带 `MeasureEnv` 与 props）；
 * 2. **校验 style 值**（键在 `parse()` 已校验，值只有注册表知道合法范围）；
 * 3. 报告未注册组件（中文，列出已注册的名字）。
 *
 * 纯函数：不碰 canvas、不改入参（返回新 spec）。
 */

import type { Rect } from './contract';
import type { ComponentDef, ComponentRegistry, MeasureEnv } from './components';
import { checkPropValue, unknownComponentMessage } from './components';
import type { LayoutSpec, NodeSpec, RegionSpec, StyleProps } from './layout';

export interface BindOptions {
  readonly registry: ComponentRegistry;
  readonly env: MeasureEnv;
}

export interface BoundUi {
  /** 注入 measure 后的 spec，可直接喂 `layout()`。 */
  readonly spec: LayoutSpec;
  /** 绑定期问题（未注册组件 / 参数值非法）；为空表示干净。 */
  readonly errors: readonly string[];
  /** 节点名 → 组件定义（绘制期按名字取）。 */
  readonly components: Readonly<Record<string, ComponentDef>>;
  /** 节点名 → 参数（与 spec 里一致，draw 时原样传）。 */
  readonly props: Readonly<Record<string, StyleProps>>;
}

/** 校验参数值：键不合法 / 值类型不符都进 errors（中文，带组件名）。 */
const validateProps = (
  name: string,
  def: ComponentDef,
  props: StyleProps,
  errors: string[],
): void => {
  const decls = def.props ?? {};
  for (const [key, value] of Object.entries(props)) {
    const type = decls[key];
    if (type === undefined) {
      const usable = Object.keys(decls);
      errors.push(`组件 '${name}' 没有参数 '${key}'（可用：${usable.length > 0 ? usable.join(' / ') : '无'}）`);
      continue;
    }
    const issue = checkPropValue(type, value);
    if (issue !== null) errors.push(`组件 '${name}' 的参数 '${key}' ${issue}`);
  }
};

/** 深度绑定一个节点（含 stack 子节点）。 */
const bindNode = (
  node: NodeSpec,
  registry: ComponentRegistry,
  env: MeasureEnv,
  out: { components: Record<string, ComponentDef>; props: Record<string, StyleProps>; errors: string[] },
): NodeSpec => {
  let bound: NodeSpec = node;
  if (node.name !== undefined) {
    const def = registry.get(node.name);
    if (def === null) {
      out.errors.push(unknownComponentMessage(node.name, registry));
    } else {
      const props: StyleProps = node.props ?? {};
      out.components[node.name] = def;
      out.props[node.name] = props;
      validateProps(node.name, def, props, out.errors);
      // auto 时布局引擎会调它；box 是父容器可用框（layout.ts 负责传）
      bound = { ...bound, measure: (box: Rect) => def.measure(env, box, props) };
    }
  }
  if (bound.stack !== undefined) {
    bound = {
      ...bound,
      stack: { ...bound.stack, children: bound.stack.children.map((child) => bindNode(child, registry, env, out)) },
    };
  }
  return bound;
};

/**
 * 绑定：`bindComponents(parsed.spec, { registry, env }) → BoundUi`。
 *
 * 未注册组件不会抛错 —— 收集进 `errors`，布局仍能跑（尺寸按 0 走），
 * 这样一次能把整份 `.ui` 的问题看全。
 */
export const bindComponents = (spec: LayoutSpec, options: BindOptions): BoundUi => {
  const out = { components: {} as Record<string, ComponentDef>, props: {} as Record<string, StyleProps>, errors: [] as string[] };
  const regions: RegionSpec[] = spec.regions.map((region) => {
    if (region.node === undefined) return region;
    return { ...region, node: bindNode(region.node, options.registry, options.env, out) };
  });
  return {
    spec: { ...spec, regions },
    errors: out.errors,
    components: out.components,
    props: out.props,
  };
};

/**
 * 布局完成后跑组件静态断言：`assertComponents(bound, rects) → 中文问题列表`。
 *
 * 和 `layout()` 的 `errors` 分开放：布局错误是「几何装不下」，组件断言是
 * 「装得下但画出来不好看」（文字溢出、卡片压扁）。两者都要报，但归因不同。
 */
export const assertComponents = (
  bound: BoundUi,
  rects: Readonly<Record<string, Rect>>,
): readonly string[] => {
  const issues: string[] = [];
  for (const [name, def] of Object.entries(bound.components)) {
    const rect = rects[name];
    if (rect === undefined || def.assert === undefined) continue;
    for (const issue of def.assert(rect, bound.props[name] ?? {})) {
      issues.push(`${name}: ${issue}`);
    }
  }
  return issues;
};
